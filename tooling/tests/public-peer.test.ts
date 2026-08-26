import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const peerRoot = resolve(root, 'tooling/public-peer')

function source(name: string): string {
  const file = resolve(peerRoot, name)
  assert.equal(existsSync(file), true, `missing Public peer source: ${name}`)
  return readFileSync(file, 'utf8')
}

test('Public automation peer is a public-Core-only command surface', () => {
  const combined = ['go.mod', 'main.go', 'peer.go', 'protocol.go']
    .map(source)
    .join('\n')

  for (const command of [
    'login',
    'logout_session',
    'login_session',
    'event_cursor',
    'wait_event',
    'send_text',
    'change_input_states',
    'get_input_states',
    'shutdown',
  ]) {
    assert.match(combined, new RegExp(`"${command}"`))
  }

  for (const forbidden of [
    'Licensed-Core',
    'open-im-sdk-core-licensed',
    'open-im-sdk-core-enterprise',
    'livekit',
    'signaling',
    'join_room',
    'send_custom',
    'conversation_group',
    'app-harmony',
  ]) {
    assert.doesNotMatch(combined.toLowerCase(), new RegExp(forbidden.toLowerCase().replace(/[-/]/g, '[-/]')))
  }
})

test('Public page and Jest runner require the independent peer for cross-account evidence', () => {
  const page = readFileSync(resolve(root, 'pages/index/index.uvue'), 'utf8')
  const jest = readFileSync(resolve(root, 'pages/index/index.test.js'), 'utf8')
  const runner = readFileSync(resolve(root, 'scripts/run-openim-automation.mjs'), 'utf8')

  assert.match(page, /peerBridgeEnabled\s*:\s*boolean/)
  assert.match(page, /runAutomationPeerCommand/)
  assert.match(page, /captureAutomationPeerCursor/)
  assert.match(page, /waitAutomationPeerOperationEvent/)
  assert.match(jest, /tooling\/public-peer/)
  assert.match(jest, /startPublicPeerBridge/)
  assert.match(jest, /Promise\.all/)
  assert.match(runner, /stagePublicPeerCoreAuthority\(coreAuthority\.root\)/)
  assert.match(runner, /fixture\._publicPeerCoreRoot = realpathSync\(coreRoot\)/)
  assert.match(jest, /delete pageConfigBase\._publicPeerCoreRoot/)
  assert.doesNotMatch(page, /_publicPeerCoreRoot/)
  assert.match(source('peer.go'), /return map\[string\]any\{"message": message\}/)
  assert.match(page, /observedIdentity != expectedIdentity\) \{ continue \}/)
  assert.match(page, /waitAutomationGroupOwner/)
  assert.doesNotMatch(page, /recordAutomationSideEffect\('message-storage', 'insertSingleMessageToLocalStorageReadback'/)
})
