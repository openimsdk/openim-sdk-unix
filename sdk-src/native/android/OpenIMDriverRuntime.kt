package uts.sdk.modules.unixOpenimSdk

import android.os.Handler
import android.os.Looper
import java.util.LinkedHashMap
import java.util.concurrent.Callable
import java.util.concurrent.Executors

internal const val OPENIM_SHUTDOWN_ERROR_CODE = -1
internal const val OPENIM_SHUTDOWN_ERROR_MESSAGE = "OpenIM SDK was uninitialized"

internal val openIMMainHandler = Handler(Looper.getMainLooper())

internal fun dispatchOpenIMMain(block: () -> Unit) {
  if (Looper.myLooper() == Looper.getMainLooper()) {
    block()
  } else {
    openIMMainHandler.post { block() }
  }
}

internal data class OpenIMDriverTicket(
  val taskID: Long,
  val epoch: Long
)

internal enum class OpenIMDriverState {
  IDLE,
  STARTING,
  ACTIVE,
  STOPPING
}

private class OpenIMPendingCallback(
  val ticket: OpenIMDriverTicket,
  val resolve: OpenIMResolveString,
  val reject: OpenIMReject,
  var terminalScheduled: Boolean = false
)

/**
 * The deep lifecycle/callback module behind the generated UTS façade.
 *
 * Native callbacks may arrive synchronously, on arbitrary threads, more than once,
 * or after Core teardown. All state changes pass through one serial executor. Only
 * the winning terminal callback is delivered, and delivery is always on main.
 */
internal object OpenIMDriverRuntime {
  private val serial = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "openim-uts-driver").apply { isDaemon = true }
  }
  private var epoch: Long = 0
  private var nextTaskID: Long = 1
  private var state: OpenIMDriverState = OpenIMDriverState.IDLE
  private val pending = LinkedHashMap<Long, OpenIMPendingCallback>()

  private fun <T> readSerial(block: () -> T): T {
    return serial.submit(Callable<T> { block() }).get()
  }

  private fun invalidateEpoch(nextState: OpenIMDriverState): Pair<Long, List<OpenIMPendingCallback>> {
    return readSerial {
      epoch += 1
      state = nextState
      val cancelled = pending.values.toList()
      pending.clear()
      Pair(epoch, cancelled)
    }
  }

  private fun rejectCancelled(callbacks: List<OpenIMPendingCallback>) {
    if (callbacks.isEmpty()) return
    dispatchOpenIMMain {
      for (callback in callbacks) {
        callback.reject(OPENIM_SHUTDOWN_ERROR_CODE, OPENIM_SHUTDOWN_ERROR_MESSAGE)
      }
    }
  }

  fun startSession(): Long {
    val transition = invalidateEpoch(OpenIMDriverState.STARTING)
    rejectCancelled(transition.second)
    return transition.first
  }

  fun markInitialized(sessionEpoch: Long, value: Boolean) {
    readSerial {
      if (epoch == sessionEpoch && state == OpenIMDriverState.STARTING) {
        state = if (value) OpenIMDriverState.ACTIVE else OpenIMDriverState.IDLE
      }
    }
  }

  fun shutdown(): Long {
    val transition = invalidateEpoch(OpenIMDriverState.STOPPING)
    rejectCancelled(transition.second)
    return transition.first
  }

  fun finishShutdown(stoppingEpoch: Long) {
    readSerial {
      if (epoch == stoppingEpoch && state == OpenIMDriverState.STOPPING) {
        state = OpenIMDriverState.IDLE
      }
    }
  }

  fun register(resolve: OpenIMResolveString, reject: OpenIMReject): OpenIMDriverTicket {
    return readSerial {
      val ticket = OpenIMDriverTicket(nextTaskID, epoch)
      nextTaskID += 1
      pending[ticket.taskID] = OpenIMPendingCallback(ticket, resolve, reject)
      ticket
    }
  }

  private fun consumeTerminal(ticket: OpenIMDriverTicket): OpenIMPendingCallback? {
    return readSerial {
      val callback = pending[ticket.taskID]
      if (callback == null || callback.ticket.epoch != ticket.epoch || epoch != ticket.epoch || !callback.terminalScheduled) {
        null
      } else {
        pending.remove(ticket.taskID)
      }
    }
  }

  private fun scheduleTerminal(ticket: OpenIMDriverTicket, delivery: (OpenIMPendingCallback) -> Unit) {
    serial.execute {
      val callback = pending[ticket.taskID]
      if (callback == null || callback.ticket.epoch != ticket.epoch || epoch != ticket.epoch || callback.terminalScheduled) {
        return@execute
      }
      callback.terminalScheduled = true
      dispatchOpenIMMain {
        val winner = consumeTerminal(ticket)
        if (winner != null) delivery(winner)
      }
    }
  }

  fun resolve(ticket: OpenIMDriverTicket, data: String) {
    scheduleTerminal(ticket) { callback -> callback.resolve(data) }
  }

  fun reject(ticket: OpenIMDriverTicket, errCode: Number, errMsg: String) {
    scheduleTerminal(ticket) { callback -> callback.reject(errCode, errMsg) }
  }

  fun progress(ticket: OpenIMDriverTicket, delivery: () -> Unit) {
    serial.execute {
      val callback = pending[ticket.taskID]
      if (callback == null || callback.ticket.epoch != ticket.epoch || epoch != ticket.epoch || callback.terminalScheduled) {
        return@execute
      }
      dispatchOpenIMMain {
        val active = readSerial { epoch == ticket.epoch && state == OpenIMDriverState.ACTIVE }
        if (active) delivery()
      }
    }
  }

  private fun canEmitEvent(sessionEpoch: Long, allowWhileStarting: Boolean): Boolean {
    return epoch == sessionEpoch && (
      state == OpenIMDriverState.ACTIVE ||
        (allowWhileStarting && state == OpenIMDriverState.STARTING)
      )
  }

  fun emitEvent(sessionEpoch: Long, allowWhileStarting: Boolean = false, delivery: () -> Unit) {
    serial.execute {
      if (!canEmitEvent(sessionEpoch, allowWhileStarting)) return@execute
      dispatchOpenIMMain {
        val active = readSerial { canEmitEvent(sessionEpoch, allowWhileStarting) }
        if (active) delivery()
      }
    }
  }

  internal fun pendingCountForTests(): Int = readSerial { pending.size }
  internal fun epochForTests(): Long = readSerial { epoch }
  internal fun stateForTests(): OpenIMDriverState = readSerial { state }
}
