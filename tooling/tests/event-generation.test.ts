import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateEvents } from '../src/generate.js'
import type { ContractDocument } from '../src/model.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

test('mobile batch message delivery preserves the public single-message callbacks', () => {
  for (const platform of ['android', 'ios'] as const) {
    const events = generateEvents(root, contract, platform)
    assert.match(events, /case 'onRecvNewMessages':[\s\S]*onRecvNewMessagesSingleDispatchPayload[\s\S]*onRecvNewMessageDispatchHandlerFromBatch/)
    assert.match(events, /case 'onRecvOfflineNewMessages':[\s\S]*onRecvOfflineNewMessagesSingleDispatchPayload[\s\S]*onRecvOfflineNewMessageDispatchHandlerFromBatch/)
  }
})
