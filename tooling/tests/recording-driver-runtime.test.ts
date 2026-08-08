import assert from 'node:assert/strict'
import test from 'node:test'
import { DeterministicScheduler, RecordingDriverRuntime } from '../testing/recording-driver-runtime.js'

function activeRuntime() {
  const serial = new DeterministicScheduler()
  const main = new DeterministicScheduler()
  const runtime = new RecordingDriverRuntime(serial, main)
  const epoch = runtime.startSession()
  runtime.completeStart(epoch, true)
  return { main, runtime, serial, epoch }
}

test('lifecycle follows idle-starting-active-stopping-idle for 100 epochs', () => {
  const serial = new DeterministicScheduler()
  const main = new DeterministicScheduler()
  const runtime = new RecordingDriverRuntime(serial, main)

  for (let index = 0; index < 100; index += 1) {
    assert.equal(runtime.state, 'idle')
    const epoch = runtime.startSession()
    assert.equal(runtime.state, 'starting')
    runtime.completeStart(epoch, true)
    assert.equal(runtime.state, 'active')
    const stoppingEpoch = runtime.shutdown()
    assert.equal(runtime.state, 'stopping')
    runtime.finishShutdown(stoppingEpoch)
    assert.equal(runtime.state, 'idle')
  }
  assert.equal(runtime.epoch, 200)
})

test('duplicate and resolve-reject races deliver exactly one terminal callback', () => {
  const { main, runtime, serial } = activeRuntime()
  const ticket = runtime.register()

  runtime.resolve(ticket, 'first')
  runtime.reject(ticket, 500, 'late reject')
  runtime.resolve(ticket, 'late resolve')
  serial.runAll()
  main.runAll()

  assert.deepEqual(runtime.records, [{ kind: 'resolve', taskID: ticket.taskID, data: 'first' }])
  assert.equal(runtime.pendingCount, 0)
})

test('progress scheduled before terminal is delivered first and late progress is dropped', () => {
  const { main, runtime, serial } = activeRuntime()
  const ticket = runtime.register()

  runtime.progress(ticket, 10)
  runtime.resolve(ticket, 'done')
  runtime.progress(ticket, 90)
  serial.runAll()
  main.runAll()

  assert.deepEqual(runtime.records, [
    { kind: 'progress', taskID: ticket.taskID, value: 10 },
    { kind: 'resolve', taskID: ticket.taskID, data: 'done' },
  ])
})

test('shutdown rejects pending work and drops callbacks and events from the old epoch', () => {
  const { epoch, main, runtime, serial } = activeRuntime()
  const ticket = runtime.register()
  runtime.emitEvent(epoch, 'business-before-shutdown')
  serial.runAll()

  const stoppingEpoch = runtime.shutdown()
  runtime.resolve(ticket, 'late')
  runtime.emitEvent(epoch, 'business-after-shutdown')
  serial.runAll()
  main.runAll()

  assert.deepEqual(runtime.records, [{ kind: 'reject', taskID: ticket.taskID, errCode: -1, errMsg: 'OpenIM SDK was uninitialized' }])
  runtime.finishShutdown(stoppingEpoch)
  assert.equal(runtime.state, 'idle')
})

test('starting accepts lifecycle events but blocks business events until active', () => {
  const serial = new DeterministicScheduler()
  const main = new DeterministicScheduler()
  const runtime = new RecordingDriverRuntime(serial, main)
  const epoch = runtime.startSession()

  runtime.emitEvent(epoch, 'connecting', true)
  runtime.emitEvent(epoch, 'message', false)
  serial.runAll()
  main.runAll()
  assert.deepEqual(runtime.records, [{ kind: 'event', epoch, name: 'connecting' }])

  runtime.completeStart(epoch, true)
  runtime.emitEvent(epoch, 'message', false)
  serial.runAll()
  main.runAll()
  assert.deepEqual(runtime.records.at(-1), { kind: 'event', epoch, name: 'message' })
})
