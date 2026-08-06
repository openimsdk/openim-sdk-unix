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
    private var initialized = false
    private var pending: [Int64: OpenIMPendingCallback] = [:]

    private init() {}

    private func invalidateEpoch() -> (Int64, [OpenIMPendingCallback]) {
        return serial.sync {
            epoch += 1
            initialized = false
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
        let transition = invalidateEpoch()
        rejectCancelled(transition.1)
        return transition.0
    }

    func markInitialized(_ sessionEpoch: Int64, _ value: Bool) {
        serial.sync {
            if epoch == sessionEpoch { initialized = value }
        }
    }

    @discardableResult
    func shutdown() -> Int64 {
        let transition = invalidateEpoch()
        rejectCancelled(transition.1)
        return transition.0
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
                let active = self.serial.sync { self.epoch == ticket.epoch }
                if active { delivery() }
            }
        }
    }

    func emitEvent(_ sessionEpoch: Int64, _ delivery: @escaping () -> Void) {
        serial.async {
            guard self.epoch == sessionEpoch, self.initialized else { return }
            dispatchOpenIMMain {
                let active = self.serial.sync { self.epoch == sessionEpoch && self.initialized }
                if active { delivery() }
            }
        }
    }

    func pendingCountForTests() -> Int { return serial.sync { pending.count } }
    func epochForTests() -> Int64 { return serial.sync { epoch } }
}
