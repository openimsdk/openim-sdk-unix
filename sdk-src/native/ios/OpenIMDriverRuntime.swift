import Foundation

let OPENIM_SHUTDOWN_ERROR_CODE = NSNumber(value: -1)
let OPENIM_SHUTDOWN_ERROR_MESSAGE = "OpenIM SDK was uninitialized"

func dispatchOpenIMMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
        block()
    } else {
        DispatchQueue.main.async(execute: block)
    }
}

final class OpenIMDriverTicket {
    let taskID: Int64
    let epoch: Int64

    init(taskID: Int64, epoch: Int64) {
        self.taskID = taskID
        self.epoch = epoch
    }
}

enum OpenIMDriverState {
    case idle
    case starting
    case active
    case stopping
}

private final class OpenIMPendingCallback {
    let ticket: OpenIMDriverTicket
    let resolve: OpenIMResolveString
    let reject: OpenIMReject
    var terminalScheduled = false

    init(ticket: OpenIMDriverTicket, resolve: @escaping OpenIMResolveString, reject: @escaping OpenIMReject) {
        self.ticket = ticket
        self.resolve = resolve
        self.reject = reject
    }
}

/// The deep lifecycle/callback module behind the generated UTS façade.
/// All native callback state changes are serialized, exactly one terminal result
/// reaches UTS, and stale callbacks/events are rejected by their session epoch.
final class OpenIMDriverRuntime {
    static let shared = OpenIMDriverRuntime()

    private let serial = DispatchQueue(label: "org.openim.uts.driver")
    private var epoch: Int64 = 0
    private var nextTaskID: Int64 = 1
    private var state: OpenIMDriverState = .idle
    private var pending: [Int64: OpenIMPendingCallback] = [:]

    private init() {}

    private func invalidateEpoch(_ nextState: OpenIMDriverState) -> (Int64, [OpenIMPendingCallback]) {
        return serial.sync {
            epoch += 1
            state = nextState
            let cancelled = Array(pending.values)
            pending.removeAll()
            return (epoch, cancelled)
        }
    }

    private func rejectCancelled(_ callbacks: [OpenIMPendingCallback]) {
        if callbacks.isEmpty { return }
        dispatchOpenIMMain {
            for callback in callbacks {
                callback.reject(OPENIM_SHUTDOWN_ERROR_CODE, OPENIM_SHUTDOWN_ERROR_MESSAGE)
            }
        }
    }

    func startSession() -> Int64 {
        let transition = invalidateEpoch(.starting)
        rejectCancelled(transition.1)
        return transition.0
    }

    func markInitialized(_ sessionEpoch: Int64, _ value: Bool) {
        serial.sync {
            if epoch == sessionEpoch && state == .starting {
                state = value ? .active : .idle
            }
        }
    }

    @discardableResult
    func shutdown() -> Int64 {
        let transition = invalidateEpoch(.stopping)
        rejectCancelled(transition.1)
        return transition.0
    }

    func finishShutdown(_ stoppingEpoch: Int64) {
        serial.sync {
            if epoch == stoppingEpoch && state == .stopping {
                state = .idle
            }
        }
    }

    func register(resolve: @escaping OpenIMResolveString, reject: @escaping OpenIMReject) -> OpenIMDriverTicket {
        return serial.sync {
            let ticket = OpenIMDriverTicket(taskID: nextTaskID, epoch: epoch)
            nextTaskID += 1
            pending[ticket.taskID] = OpenIMPendingCallback(ticket: ticket, resolve: resolve, reject: reject)
            return ticket
        }
    }

    private func consumeTerminal(_ ticket: OpenIMDriverTicket) -> OpenIMPendingCallback? {
        return serial.sync {
            guard let callback = pending[ticket.taskID],
                  callback.ticket.epoch == ticket.epoch,
                  epoch == ticket.epoch,
                  callback.terminalScheduled else { return nil }
            pending.removeValue(forKey: ticket.taskID)
            return callback
        }
    }

    private func scheduleTerminal(_ ticket: OpenIMDriverTicket, _ delivery: @escaping (OpenIMPendingCallback) -> Void) {
        serial.async {
            guard let callback = self.pending[ticket.taskID],
                  callback.ticket.epoch == ticket.epoch,
                  self.epoch == ticket.epoch,
                  !callback.terminalScheduled else { return }
            callback.terminalScheduled = true
            dispatchOpenIMMain {
                guard let winner = self.consumeTerminal(ticket) else { return }
                delivery(winner)
            }
        }
    }

    func resolve(_ ticket: OpenIMDriverTicket, _ data: String) {
        scheduleTerminal(ticket) { callback in callback.resolve(data) }
    }

    func resolvePrepared(_ ticket: OpenIMDriverTicket, _ prepare: @escaping () throws -> String) {
        scheduleTerminal(ticket) { callback in
            do {
                let data = try prepare()
                callback.resolve(data)
            } catch {
                callback.reject(NSNumber(value: -1), error.localizedDescription)
            }
        }
    }

    func reject(_ ticket: OpenIMDriverTicket, _ errCode: NSNumber, _ errMsg: String) {
        scheduleTerminal(ticket) { callback in callback.reject(errCode, errMsg) }
    }

    func progress(_ ticket: OpenIMDriverTicket, _ delivery: @escaping () -> Void) {
        serial.async {
            guard let callback = self.pending[ticket.taskID],
                  callback.ticket.epoch == ticket.epoch,
                  self.epoch == ticket.epoch,
                  !callback.terminalScheduled else { return }
            dispatchOpenIMMain {
                let active = self.serial.sync { self.epoch == ticket.epoch && self.state == .active }
                if active { delivery() }
            }
        }
    }

    private func canEmitEvent(_ sessionEpoch: Int64, _ allowWhileStarting: Bool) -> Bool {
        return epoch == sessionEpoch && (state == .active || (allowWhileStarting && state == .starting))
    }

    func emitEvent(_ sessionEpoch: Int64, _ allowWhileStarting: Bool = false, _ delivery: @escaping () -> Void) {
        serial.async {
            guard self.canEmitEvent(sessionEpoch, allowWhileStarting) else { return }
            dispatchOpenIMMain {
                let active = self.serial.sync { self.canEmitEvent(sessionEpoch, allowWhileStarting) }
                if active { delivery() }
            }
        }
    }

    func pendingCountForTests() -> Int { return serial.sync { pending.count } }
    func epochForTests() -> Int64 { return serial.sync { epoch } }
    func stateForTests() -> OpenIMDriverState { return serial.sync { state } }
}
