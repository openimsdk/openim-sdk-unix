import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ContractDocument } from '../src/model.js'
import { buildPublicResponseSchemas, buildPublicTestDisposition, validateContractValue } from '../src/test-contract.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

test('classifies every public callable and event without gaps', () => {
  const schemas = buildPublicResponseSchemas(contract)
  const disposition = buildPublicTestDisposition(contract)
  assert.equal(schemas.counts.callables, contract.expected.callables)
  assert.equal(schemas.counts.events, contract.expected.events)
  assert.equal(disposition.callables.length, contract.expected.callables)
  assert.equal(disposition.events.length, contract.expected.events)
  assert.equal(new Set(disposition.callables.map((item) => item.apiName)).size, contract.expected.callables)
  assert.equal(new Set(disposition.events.map((item) => item.eventName)).size, contract.expected.events)
  assert.equal(disposition.callables.some((item) => item.disposition == null), false)
  assert.equal(disposition.events.some((item) => item.deliveryDisposition == null || item.payloadProfile == null), false)
})

test('rejects missing and wrongly typed advanced history fields', () => {
  const document = buildPublicResponseSchemas(contract)
  const rootSchema = document.callables.getAdvancedHistoryMessageList?.schema
  assert.ok(rootSchema)
  const valid = { messageList: [], lastMinSeq: 0, isEnd: true, errCode: 0, errMsg: '' }
  assert.deepEqual(validateContractValue(document, rootSchema, valid).filter((issue) => issue.severity === 'error'), [])

  const { lastMinSeq: _omitted, ...missingLastMinSeq } = valid
  assert.ok(validateContractValue(document, rootSchema, missingLastMinSeq).some((issue) => issue.path === '$.lastMinSeq' && issue.rule === 'required'))
  assert.ok(validateContractValue(document, rootSchema, { ...valid, isEnd: 'true' }).some((issue) => issue.path === '$.isEnd' && issue.rule === 'type'))
})

test('requires message isRead to remain a boolean', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMMessageItem
  assert.ok(schema)
  const message = {
    clientMsgID: 'client-1', serverMsgID: 'server-1', createTime: 1, sendTime: 2,
    sessionType: 1, sendID: 'user-a', recvID: 'user-b', msgFrom: 100,
    contentType: 101, senderPlatformID: 2, senderNickname: 'A', senderFaceUrl: '',
    groupID: '', content: 'hello', seq: 1, isRead: false, status: 2,
    attachedInfo: '', ex: '', localEx: '',
  }
  assert.deepEqual(validateContractValue(document, schema, message).filter((issue) => issue.severity === 'error'), [])
  assert.ok(validateContractValue(document, schema, { ...message, isRead: 0 }).some((issue) => issue.path === '$.isRead' && issue.rule === 'type'))
})

test('reports additive response fields as contract drift instead of structural failure', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMAdvancedHistoryMessageListResult
  assert.ok(schema)
  const issues = validateContractValue(document, schema, { messageList: [], lastMinSeq: 0, isEnd: true, errCode: 0, errMsg: '', futureField: 'value' })
  assert.equal(issues.some((issue) => issue.severity === 'error'), false)
  assert.ok(issues.some((issue) => issue.path === '$.futureField' && issue.severity === 'contract-drift'))
})
