import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

type ContractConstant = { name: string; type: string; value: string }
type ContractType = { name: string; declaration: string }
type Contract = { constants: ContractConstant[]; types: ContractType[] }

const root = resolve(import.meta.dirname, '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as Contract

const enumDomains: Record<string, Record<string, string>> = {
  OpenIMMessageReceiveOption: {
    OpenIMMessageReceiveOptionReceive: '0',
    OpenIMMessageReceiveOptionDoNotReceive: '1',
    OpenIMMessageReceiveOptionReceiveWithoutNotification: '2',
  },
  OpenIMGroupAllowType: {
    OpenIMGroupAllowTypeAllowed: '0',
    OpenIMGroupAllowTypeNotAllowed: '1',
  },
  OpenIMGroupType: {
    OpenIMGroupTypeWorkingGroup: '2',
  },
  OpenIMGroupJoinSource: {
    OpenIMGroupJoinSourceAdmin: '1',
    OpenIMGroupJoinSourceInvitation: '2',
    OpenIMGroupJoinSourceSearch: '3',
    OpenIMGroupJoinSourceQRCode: '4',
  },
  OpenIMGroupMemberRole: {
    OpenIMGroupMemberRoleNormal: '20',
    OpenIMGroupMemberRoleAdmin: '60',
    OpenIMGroupMemberRoleOwner: '100',
  },
  OpenIMGroupVerificationType: {
    OpenIMGroupVerificationTypeApplyNeedInviteNot: '0',
    OpenIMGroupVerificationTypeAllNeed: '1',
    OpenIMGroupVerificationTypeAllNot: '2',
  },
  OpenIMApplicationHandleResult: {
    OpenIMApplicationHandleResultRejected: '-1',
    OpenIMApplicationHandleResultUnprocessed: '0',
    OpenIMApplicationHandleResultAccepted: '1',
  },
  OpenIMGroupStatus: {
    OpenIMGroupStatusNormal: '0',
    OpenIMGroupStatusBanned: '1',
    OpenIMGroupStatusDismissed: '2',
    OpenIMGroupStatusMuted: '3',
  },
  OpenIMGroupMentionType: {
    OpenIMGroupMentionTypeNormal: '0',
    OpenIMGroupMentionTypeMentionedMe: '1',
    OpenIMGroupMentionTypeMentionedAll: '2',
    OpenIMGroupMentionTypeMentionedAllAndMe: '3',
    OpenIMGroupMentionTypeGroupNotice: '4',
  },
  OpenIMGroupMemberFilter: {
    OpenIMGroupMemberFilterAll: '0',
    OpenIMGroupMemberFilterOwner: '1',
    OpenIMGroupMemberFilterAdmin: '2',
    OpenIMGroupMemberFilterNormal: '3',
    OpenIMGroupMemberFilterAdminAndNormal: '4',
    OpenIMGroupMemberFilterAdminAndOwner: '5',
  },
  OpenIMOnlineState: {
    OpenIMOnlineStateOffline: '0',
    OpenIMOnlineStateOnline: '1',
  },
}

test('public enum domains expose a complete named constant set', () => {
  const actual = new Map(contract.constants.map((constant) => [constant.name, constant]))
  for (const [type, constants] of Object.entries(enumDomains)) {
    for (const [name, value] of Object.entries(constants)) {
      assert.deepEqual(actual.get(name), { name, type, value, ...actual.get(name) })
      assert.equal(actual.get(name)?.type, type)
      assert.equal(actual.get(name)?.value, value)
    }
  }
})

test('message constants cover retained UserCommand content types without restoring events', () => {
  const constants = new Map(contract.constants.map((constant) => [constant.name, constant.value]))
  assert.equal(constants.get('OpenIMMessageTypeUserCommandAdded'), '1305')
  assert.equal(constants.get('OpenIMMessageTypeUserCommandDeleted'), '1306')
  assert.equal(constants.get('OpenIMMessageTypeUserCommandUpdated'), '1307')
})

test('public enum-bearing fields use canonical named types', () => {
  const declarations = new Map(contract.types.map((type) => [type.name, type.declaration]))
  const expectedFields: Record<string, string[]> = {
    OpenIMSetConversationParams: ['recvMsgOpt ?: OpenIMMessageReceiveOption | null', 'groupAtType ?: OpenIMGroupMentionType | null'],
    OpenIMSetSelfInfoParams: ['globalRecvMsgOpt ?: OpenIMMessageReceiveOption | null'],
    OpenIMCreateGroupInfo: ['groupType : OpenIMGroupType'],
    OpenIMSetGroupInfoParams: [
      'needVerification ?: OpenIMGroupVerificationType | null',
      'lookMemberInfo ?: OpenIMGroupAllowType | null',
      'applyMemberFriend ?: OpenIMGroupAllowType | null',
    ],
    OpenIMSetGroupMemberInfoParams: ['roleLevel ?: OpenIMGroupMemberRole | null'],
    OpenIMJoinGroupParams: ['joinSource : OpenIMGroupJoinSource'],
    OpenIMConversationItem: ['recvMsgOpt : OpenIMMessageReceiveOption', 'groupAtType : OpenIMGroupMentionType'],
    OpenIMUserStatusItem: ['status : OpenIMOnlineState', 'platformIDs : Array<OpenIMPlatform>'],
    OpenIMUserInfo: ['globalRecvMsgOpt ?: OpenIMMessageReceiveOption | null'],
    OpenIMGroupItem: [
      'status : OpenIMGroupStatus',
      'groupType : OpenIMGroupType',
      'needVerification : OpenIMGroupVerificationType',
      'lookMemberInfo : OpenIMGroupAllowType',
      'applyMemberFriend : OpenIMGroupAllowType',
    ],
    OpenIMGroupMemberItem: ['roleLevel : OpenIMGroupMemberRole', 'joinSource : OpenIMGroupJoinSource'],
    OpenIMFriendApplicationItem: ['handleResult : OpenIMApplicationHandleResult'],
    OpenIMGroupApplicationItem: [
      'status : OpenIMGroupStatus',
      'groupType ?: OpenIMGroupType | null',
      'handleResult : OpenIMApplicationHandleResult',
      'joinSource : OpenIMGroupJoinSource',
    ],
    OpenIMConversationInputStatusItem: ['platformIDs : Array<OpenIMPlatform>'],
    OpenIMGetGroupMemberListParams: ['filter : OpenIMGroupMemberFilter'],
  }
  for (const [typeName, fields] of Object.entries(expectedFields)) {
    const declaration = declarations.get(typeName)
    assert.ok(declaration, `Missing type ${typeName}`)
    for (const field of fields) assert.match(declaration, new RegExp(field.replace(/[?()[\]|]/g, '\\$&')))
  }
})

test('legacy public enum type names remain aliases', () => {
  const declarations = new Map(contract.types.map((type) => [type.name, type.declaration]))
  assert.equal(declarations.get('OpenIMSetSelfInfoRecvMsgOpt'), 'export type OpenIMSetSelfInfoRecvMsgOpt = OpenIMMessageReceiveOption')
  assert.equal(declarations.get('OpenIMGroupNeedVerification'), 'export type OpenIMGroupNeedVerification = OpenIMGroupVerificationType')
  assert.equal(declarations.get('OpenIMGroupOption'), 'export type OpenIMGroupOption = OpenIMGroupAllowType')
  assert.equal(declarations.get('OpenIMGroupMemberRoleLevel'), 'export type OpenIMGroupMemberRoleLevel = OpenIMGroupMemberRole')
})

test('platform templates import every constant type introduced by the contract', () => {
  const requiredTypes = new Set(contract.constants.map((constant) => constant.type))
  for (const platform of ['android', 'ios']) {
    const template = readFileSync(resolve(root, `sdk-src/uts/app-${platform}/index.template.uts`), 'utf8')
    for (const type of requiredTypes) assert.match(template, new RegExp(`\\b${type},`), `${platform} does not import ${type}`)
  }
})
