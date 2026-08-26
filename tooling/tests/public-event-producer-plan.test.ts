import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const disposition = JSON.parse(readFileSync(resolve(root, 'contracts/base/test-disposition.json'), 'utf8')) as {
  callables: Array<{ apiName: string; expectedEvents: string[] }>
}

test('generated Public callable plan owns every deterministic mutation event producer', () => {
  const expected = new Map<string, string[]>([
    ['setConversation', ['onConversationChanged']],
    ['revokeMessage', ['onNewRecvMessageRevoked']],
    ['deleteMessage', ['onMsgDeleted']],
    ['updateFriends', ['onFriendInfoChanged']],
    ['deleteFriend', ['onFriendDeleted']],
    ['removeBlack', ['onBlackDeleted']],
    ['setGroupInfo', ['onGroupInfoChanged']],
    ['setGroupMemberInfo', ['onGroupMemberInfoChanged']],
    ['kickGroupMember', ['onGroupMemberDeleted']],
    ['setSelfInfo', ['onSelfInfoUpdated']],
    ['markConversationMessageAsRead', ['onRecvC2CReadReceipt']],
  ])

  for (const [apiName, events] of expected) {
    const callable = disposition.callables.find((item) => item.apiName === apiName)
    assert.ok(callable, `missing callable ${apiName}`)
    for (const eventName of events) {
      assert.ok(callable.expectedEvents.includes(eventName), `${apiName} must own ${eventName}`)
    }
  }
})
