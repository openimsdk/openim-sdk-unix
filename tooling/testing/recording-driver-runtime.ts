export type DriverLifecycleState = 'idle' | 'starting' | 'active' | 'stopping'

export type DriverTicket = {
  taskID: number
  epoch: number
}

export type DriverRecord =
  | { kind: 'resolve'; taskID: number; data: string }
  | { kind: 'reject'; taskID: number; errCode: number; errMsg: string }
  | { kind: 'progress'; taskID: number; value: number }
  | { kind: 'event'; epoch: number; name: string }

type Pending = {
  ticket: DriverTicket
  terminalScheduled: boolean
  cancellationKey?: string
}

export class DeterministicScheduler {
  readonly #queue: Array<() => void> = []

  schedule(task: () => void): void {
    this.#queue.push(task)
  }

  runNext(): boolean {
    const task = this.#queue.shift()
    if (task == null) return false
    task()
    return true
  }

  runAll(): void {
    while (this.runNext()) {
      // Tasks are deliberately drained in FIFO order.
    }
  }

  get size(): number {
    return this.#queue.length
  }
}

/**
 * Test-only behavioral model for the native DriverRuntime contract.
 *
 * It is intentionally outside generated and production inventories. Native
 * implementations are verified against the same state names and transition
 * points, while this model makes duplicate callbacks and queue races fully
 * deterministic in Node tests.
 */
export class RecordingDriverRuntime {
  readonly records: DriverRecord[] = []
  #epoch = 0
  #nextTaskID = 1
  #state: DriverLifecycleState = 'idle'
  readonly #pending = new Map<number, Pending>()

  constructor(
    private readonly serial: DeterministicScheduler,
    private readonly main: DeterministicScheduler,
  ) {}

  get state(): DriverLifecycleState {
    return this.#state
  }

  get epoch(): number {
    return this.#epoch
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  startSession(): number {
    this.#invalidateEpoch('starting')
    return this.#epoch
  }

  completeStart(sessionEpoch: number, initialized: boolean): void {
    if (sessionEpoch !== this.#epoch || this.#state !== 'starting') return
    this.#state = initialized ? 'active' : 'idle'
  }

  shutdown(): number {
    this.#invalidateEpoch('stopping')
    return this.#epoch
  }

  finishShutdown(stoppingEpoch: number): void {
    if (stoppingEpoch === this.#epoch && this.#state === 'stopping') {
      this.#state = 'idle'
    }
  }

  register(): DriverTicket {
    const ticket = { taskID: this.#nextTaskID, epoch: this.#epoch }
    this.#nextTaskID += 1
    this.#pending.set(ticket.taskID, { ticket, terminalScheduled: false })
    return ticket
  }

  registerCancellable(cancellationKey: string, ticket: DriverTicket): void {
    if (cancellationKey.length === 0) return
    const callback = this.#pending.get(ticket.taskID)
    if (this.#isCurrent(callback, ticket) && !callback.terminalScheduled) {
      callback.cancellationKey = cancellationKey
    }
  }

  cancelCancellable(cancellationKey: string, errCode: number, errMsg: string): void {
    if (cancellationKey.length === 0) return
    this.serial.schedule(() => {
      const matches = [...this.#pending.values()].filter((callback) => (
        callback.cancellationKey === cancellationKey
        && this.#isCurrent(callback, callback.ticket)
        && !callback.terminalScheduled
      ))
      for (const callback of matches) {
        callback.terminalScheduled = true
        this.main.schedule(() => {
          const winner = this.#pending.get(callback.ticket.taskID)
          if (!this.#isCurrent(winner, callback.ticket) || !winner.terminalScheduled) return
          this.#pending.delete(callback.ticket.taskID)
          this.records.push({
            kind: 'reject',
            taskID: callback.ticket.taskID,
            errCode,
            errMsg,
          })
        })
      }
    })
  }

  resolve(ticket: DriverTicket, data: string): void {
    this.#scheduleTerminal(ticket, () => {
      this.records.push({ kind: 'resolve', taskID: ticket.taskID, data })
    })
  }

  reject(ticket: DriverTicket, errCode: number, errMsg: string): void {
    this.#scheduleTerminal(ticket, () => {
      this.records.push({ kind: 'reject', taskID: ticket.taskID, errCode, errMsg })
    })
  }

  progress(ticket: DriverTicket, value: number): void {
    this.serial.schedule(() => {
      const callback = this.#pending.get(ticket.taskID)
      if (!this.#isCurrent(callback, ticket) || callback.terminalScheduled) return
      this.main.schedule(() => {
        if (ticket.epoch === this.#epoch && this.#state !== 'stopping' && this.#state !== 'idle') {
          this.records.push({ kind: 'progress', taskID: ticket.taskID, value })
        }
      })
    })
  }

  emitEvent(sessionEpoch: number, name: string, allowWhileStarting = false): void {
    this.serial.schedule(() => {
      if (!this.#canEmit(sessionEpoch, allowWhileStarting)) return
      this.main.schedule(() => {
        if (this.#canEmit(sessionEpoch, allowWhileStarting)) {
          this.records.push({ kind: 'event', epoch: sessionEpoch, name })
        }
      })
    })
  }

  #invalidateEpoch(nextState: DriverLifecycleState): void {
    this.#epoch += 1
    this.#state = nextState
    const cancelled = [...this.#pending.values()]
    this.#pending.clear()
    for (const callback of cancelled) {
      this.main.schedule(() => {
        this.records.push({
          kind: 'reject',
          taskID: callback.ticket.taskID,
          errCode: -1,
          errMsg: 'OpenIM SDK was uninitialized',
        })
      })
    }
  }

  #scheduleTerminal(ticket: DriverTicket, delivery: () => void): void {
    this.serial.schedule(() => {
      const callback = this.#pending.get(ticket.taskID)
      if (!this.#isCurrent(callback, ticket) || callback.terminalScheduled) return
      callback.terminalScheduled = true
      this.main.schedule(() => {
        const winner = this.#pending.get(ticket.taskID)
        if (!this.#isCurrent(winner, ticket) || !winner.terminalScheduled) return
        this.#pending.delete(ticket.taskID)
        delivery()
      })
    })
  }

  #isCurrent(callback: Pending | undefined, ticket: DriverTicket): callback is Pending {
    return callback != null && callback.ticket.epoch === ticket.epoch && ticket.epoch === this.#epoch
  }

  #canEmit(sessionEpoch: number, allowWhileStarting: boolean): boolean {
    return sessionEpoch === this.#epoch && (this.#state === 'active' || (allowWhileStarting && this.#state === 'starting'))
  }
}
