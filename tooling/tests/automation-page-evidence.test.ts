import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(resolve(root, 'pages/index/index.uvue'), 'utf8')
const pageTest = readFileSync(resolve(root, 'pages/index/index.test.js'), 'utf8')
const automationRunner = readFileSync(resolve(root, 'scripts/run-openim-automation.mjs'), 'utf8')

function functionSource(name: string): string {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`).exec(page)
  assert.notEqual(declaration, null, `${name} must exist in the automation page`)
  const start = declaration!.index
  const remainder = page.slice(start + declaration![0].length)
  const nextFunction = remainder.search(/\n\t+(?:async\s+)?function\s+[A-Za-z]/)
  return nextFunction < 0
    ? page.slice(start)
    : page.slice(start, start + declaration![0].length + nextFunction)
}

function functionIndex(name: string): number {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`).exec(page)
  assert.notEqual(declaration, null, `${name} must exist in the automation page`)
  return declaration!.index
}

test('Jest failure narrative reads the report status field emitted by the UTS page', () => {
  assert.match(pageTest, /item\.status === 'failed'/)
  assert.doesNotMatch(pageTest, /item\.ok === false/)
  assert.match(pageTest, /public peer \$\{name\} command failed \(\$\{safeCode\}\)/)
  assert.doesNotMatch(pageTest, /response\.error\?\.message/)
})

test('runtime cases carry explicit contract evidence instead of deriving validation from Promise success', () => {
  for (const field of [
    'invoked',
    'resolved',
    'responseEvidence',
    'structureValidated',
    'semanticValidated',
    'sideEffectValidated',
    'eventCorrelated',
    'cleanupValidated',
  ]) {
    assert.match(page, new RegExp(`${field} : boolean`))
  }
  assert.doesNotMatch(page, /status == 'passed'\)\s*\{\s*markAutomationAPIValidated/)
  assert.doesNotMatch(functionSource('recordAutomationStep'), /markAutomationAPIValidated/)
  assert.match(page, /function recordAutomation(?:EvidenceStep|ValidatedStep)\(/)
  assert.match(functionSource('recordAutomationStep'), /recordAutomationCase\([^\n]+, null, null\)/)
  assert.match(functionSource('recordAutomationCleanupEvidence'), /recordAutomationCase\([^\n]+, null, null\)/)
  assert.match(functionSource('recordAutomationSkip'), /recordAutomationCase\([^\n]+, null, null\)/)
})

test('callable semantic and side-effect evidence carries generated profile assertions', () => {
  for (const field of [
    'path : string',
    'axis : string',
    'profile : string',
    'rule : string',
    'expected : string',
    'actual : string',
    'ok : boolean',
    'assertions : Array<OpenIMAutomationAssertionResult>',
  ]) {
    assert.match(page, new RegExp(field))
  }
  assert.match(page, /from '\.\/openim-automation-profiles\.uts'/)
  assert.match(functionSource('requireAutomationProfile'), /openIMAutomationContractEdition == 'public'/)
  assert.match(functionSource('createAutomationProfileAssertion'), /path: '\$'/)
  const response = functionSource('responseAutomationEvidence')
  assert.match(response, /requireAutomationSemanticProfile\(apiName\)/)
  assert.match(response, /createAutomationProfileAssertion\('semantic', semanticProfile, rule/)
  const mutation = functionSource('mutationAutomationEvidence')
  assert.match(mutation, /requireAutomationSemanticProfile\(apiName\)/)
  assert.match(mutation, /requireAutomationSideEffectProbe\(apiName\)/)
  assert.match(mutation, /createAutomationProfileAssertion\('semantic', semanticProfile, semanticRule/)
  assert.match(mutation, /createAutomationProfileAssertion\('side-effect', sideEffectProbe, sideEffectRule/)
  const serverAcknowledged = functionSource('serverAcknowledgedMutationAutomationEvidence')
  assert.match(serverAcknowledged, /requireAutomationSemanticProfile\(apiName\)/)
  assert.match(serverAcknowledged, /requireAutomationSideEffectProbe\(apiName\)/)
  assert.match(serverAcknowledged, /'server-acknowledged-mutation'/)
  const subscription = functionSource('subscriptionAutomationEvidence')
  assert.match(subscription, /requireAutomationSemanticProfile\(eventName\)/)
  assert.match(subscription, /requireAutomationSideEffectProbe\(eventName\)/)
  assert.doesNotMatch(subscription, /'subscription-lifecycle'/)
  assert.doesNotMatch(subscription, /'registry-observation'/)
  assert.doesNotMatch(page, /function (?:automationNameContainsAny|automationNameStartsWithAny|readAutomationSemanticProfile|readAutomationSideEffectProbe)\(/)
  assert.match(functionSource('recordAutomationCase'), /assertions: checked\.assertions/)
})

test('cleanup evidence is explicit, action-bound, and recorded only at executed cleanup sites', () => {
  assert.match(page, /cleanupAction : string/)
  const evidence = functionSource('cleanupAutomationEvidence')
  assert.match(evidence, /createAutomationProfileAssertion\('cleanup', cleanupAction, rule/)
  assert.match(evidence, /cleanupValidated: ok/)
  assert.match(evidence, /cleanupAction: cleanupAction/)

  const recorder = functionSource('recordAutomationCleanupEvidence')
  assert.match(recorder, /cleanupAutomationEvidence\(cleanupAction, rule, expected, actual, ok\)/)
  assert.match(functionSource('recordAutomationCase'), /cleanupValidated: checked\.cleanupValidated/)
  assert.match(functionSource('recordAutomationCase'), /cleanupAction: checked\.cleanupAction/)

  const cleanup = functionSource('runAutomationCleanupBeforeSummary')
  for (const exactRecord of [
    "'off', 'none'",
    "'offAll', 'none'",
    "'logout', 'none'",
    "'login', 'logout()'",
    "'unInitSDK', 'none'",
    "'initSDK', 'unInitSDK()'",
    "'onConnecting', 'off(subscription)'",
  ]) {
    assert.match(cleanup, new RegExp(`recordAutomationCleanupEvidence\\('cleanup', ${exactRecord.replace(/[()]/g, '\\$&')}`))
  }
  assert.doesNotMatch(page, /cleanupValidated:\s*true/)
})

test('write-only app mutations are required and carry server acknowledgement evidence', () => {
  const suite = functionSource('runAutomationAppSuite')
  for (const apiName of ['setAppBackgroundStatus', 'setAppBadge', 'updateFcmToken']) {
    assert.match(
      suite,
      new RegExp(`runAutomationStep<string>\\('app', '${apiName}'[^\\n]+serverAcknowledgedMutationAutomationEvidence\\('${apiName}'\\)`),
    )
  }
  assert.doesNotMatch(page, /runAutomationStepWithEvidence/)
  assert.doesNotMatch(suite, /runAutomationOptionalStep<string>\('app', 'updateFcmToken'/)
})

test('runtime response evidence carries the resolved wire value separately from narratives', () => {
  for (const field of ['responseEncoding : string', 'responseDetail : string']) {
    assert.match(page, new RegExp(field))
  }
  const recorder = functionSource('recordAutomationCase')
  assert.match(recorder, /responseDetail : string \| null = null/)
  assert.match(recorder, /responseEvidence: responseDetail != null/)
  assert.match(recorder, /responseEncoding: responseDetail != null \? automationResponseEncoding\(contractAPIName\) : ''/)
  assert.match(recorder, /responseDetail: responseDetail != null \? responseDetail as string : ''/)

  const runner = functionSource('runAutomationStepWithTimeout')
  assert.match(runner, /recordAutomationCase\([^\n]+resolvedValueText, null\)/)
  assert.doesNotMatch(functionSource('recordAutomationStep'), /detail, detail\)/)
})

test('automation fixtures use the guaranteed user-data root without creating a virtual subdirectory', () => {
  const prepare = functionSource('prepareAutomationLocalFiles')
  assert.match(prepare, /const fileSystemBasePath = uni\.env\.USER_DATA_PATH/)
  assert.match(prepare, /automationAssetDirFileSystemPath = fileSystemBasePath/)
  assert.match(prepare, /automationAssetDirFullPath = fileSystemBasePath/)
  assert.match(prepare, /automationFixedImageFullPath = imageFileSystemPath/)
  assert.match(prepare, /automationFixedSoundFullPath = soundFileSystemPath/)
  assert.match(prepare, /automationFixedVideoFullPath = videoFileSystemPath/)
  assert.match(prepare, /automationFixedVideoSnapshotFullPath = videoSnapshotFileSystemPath/)
  assert.match(prepare, /automationFixedFileFullPath = fileFileSystemPath/)
  assert.match(prepare, /openim-automation-image\.jpg/)
  assert.match(prepare, /openim-automation-sound\.wav/)
  assert.match(prepare, /openim-automation-video\.mp4/)
  assert.doesNotMatch(prepare, /ensureAutomationDirectory/)
  assert.doesNotMatch(prepare, /openim-automation-assets/)
})

test('automation errors retain a non-empty native fallback when Error.message is blank', () => {
  const stringify = functionSource('stringifyAPIValue')
  assert.match(stringify, /const errorMessage = value\.message/)
  assert.match(stringify, /if \(errorMessage\.length > 0\)/)
  assert.match(stringify, /const errorFallback = value\.toString\(\)/)
  assert.match(stringify, /return errorFallback\.length > 0 \? errorFallback : 'Error'/)
})

test('event subscriptions prove handle semantics and registry side effects separately', () => {
  const recorder = functionSource('recordAutomationEventSubscriptionCoverage')
  assert.match(recorder, /const handleMatched = subscription\.id\.length > 0/)
  assert.match(recorder, /const registryObserved = automationStringArrayContains\(sdkEventSubscriptionNames, eventName\)/)
  assert.match(recorder, /subscriptionAutomationEvidence\(eventName, handleMatched, registryObserved\)/)
  assert.doesNotMatch(recorder, /mutationAutomationEvidence/)
})

test('lifecycle and event-control scenarios run cleanup and registry probes without skip allowlists', () => {
  assert.match(page, /const automationAllowedSkipCaseKeys : Array<string> = \[\]/)
  assert.match(page, /const automationAllowedValidatedMissingNames : Array<string> = \[\]/)
  assert.doesNotMatch(page, /recordAutomationSkip\('cleanup', 'unInitSDK'/)
  assert.match(page, /forged-openim-subscription/)
  assert.match(page, /off\(selfRemoving as OpenIMSDKEventSubscription\)/)
  assert.match(page, /(?:survivor|second)Count/)
  assert.match(page, /offAll\('[A-Za-z]+/)
  assert.match(page, /registry\/native epoch rebind delivered/)
})

test('event-control assertions wait for an independent connection-complete witness', () => {
  const scenario = functionSource('runAutomationEventControlScenario')
  assert.match(scenario, /const connectionCompleted = onConnectSuccess/)
  assert.match(scenario, /connectionCompletedCount = connectionCompletedCount \+ 1/)
  assert.match(scenario, /while \(\(connectionCompletedCount <= completedBefore/)
  assert.match(scenario, /await sleepAutomation\(250\)/)
  assert.match(scenario, /off\(connectionCompleted\)/)
})

test('setup normalizes a native login session retained across HBuilder hot reloads', () => {
  const normalize = functionSource('normalizeAutomationExistingSession')
  assert.match(normalize, /getLoginStatus\('uvue_auto_existing_login_status'\)/)
  assert.match(normalize, /if \(status == 3\)/)
  assert.match(normalize, /getLoginUserID\(\)/)
  assert.match(normalize, /logout\('uvue_auto_existing_logout'\)/)
  assert.match(normalize, /automationLoggedIn = false/)
  assert.match(functionSource('runAutomationSetupSuite'), /await normalizeAutomationExistingSession\(\)/)
})

test('event reports distinguish typed delivery from semantic, ordering, and epoch proof', () => {
	for (const field of ['payloadEvidence : boolean', 'payloadEncoding : string', 'payloadDetail : string', 'payloadDetails : Array<string>', 'payloadEncodings : Array<string>']) {
    assert.match(page, new RegExp(field))
  }
  assert.match(page, /record\.deliveryValidated = true/)
  assert.match(page, /record\.structureValidated = true/)
  assert.match(page, /record\.payloadEvidence = true/)
	assert.match(page, /record\.payloadEncoding = payloadEncoding/)
	assert.match(page, /recordSDKEventDelivery\(mappedEventName, payloadTextValue as string, 'openim-core-json-v1'\)/)
  assert.match(page, /record\.payloadDetail = payloadText/)
	assert.match(page, /record\.payloadDetails\.push\(payloadText\)/)
	assert.match(page, /record\.payloadEncodings\.push\(payloadEncoding\)/)
  assert.match(functionSource('showSDKErrorEvent'), /recordSDKEventDelivery\(eventName, '\[' \+ errCode\.toString\(\)/)
  assert.doesNotMatch(page, /record\.(?:semanticValidated|orderingValidated|epochValidated) = true/)
})

test('callable event correlations retain operation order, epoch, and payload match evidence', () => {
  for (const field of [
    'eventCorrelations : Array<OpenIMAutomationEventCorrelation>',
    'operationApiName : string',
    'eventName : string',
    'operationSequence : number',
    'eventSequence : number',
    'operationEpoch : number',
    'eventEpoch : number',
    'payloadMatched : boolean',
    'correlationKind : string',
    'operationTerminalSequence : number',
    'exclusiveOperation : boolean',
    'payloadIdentity : string',
    'eventPayloadDetail : string',
  ]) {
    assert.match(page, new RegExp(field))
  }
  assert.match(page, /type OpenIMAutomationEventOccurrence =/)
  assert.match(page, /automationEventOccurrences\.push\(occurrence\)/)
  assert.match(functionSource('beginAutomationOperation'), /automationEvidenceSequenceCounter = automationEvidenceSequenceCounter \+ 1/)
  assert.match(functionSource('beginAutomationOperation'), /operationSequence: readAutomationEventSequence\(\)/)
  assert.match(functionSource('beginAutomationOperation'), /operationEpoch: automationCurrentLifecycleEpoch/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /findAutomationEventOccurrence/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /eventSequence: occurrence\.sequence/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /eventEpoch: occurrence\.epoch/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /correlationKind: correlationKind/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /payloadIdentity: payloadIdentity/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /eventPayloadDetail: occurrence\.payloadText/)
  assert.match(functionSource('readAutomationEventPayloadIdentity'), /parsed\['clientMsgID'\]/)
  assert.doesNotMatch(functionSource('buildAutomationEventCorrelations'), /payloadText\.indexOf/)
  assert.match(functionSource('completeAutomationOperation'), /resultIdentity/)
  assert.match(functionSource('completeAutomationOperation'), /terminalSequence/)
  assert.match(functionSource('recordSDKEventDelivery'), /sequence: automationEvidenceSequenceCounter/)
  assert.match(functionSource('recordAutomationCase'), /eventCorrelations: eventCorrelations == null \? \[\]/)
})

test('public producer plan binds remaining deterministic events to concrete operations', () => {
  const recorder = functionSource('recordAutomationRequiredEventCorrelation')
  assert.match(recorder, /readAutomationEventCount\(eventName\) > previousCount/)
  assert.match(recorder, /buildAutomationEventCorrelations\(apiName, \[eventName\]\)/)
  assert.match(recorder, /recordAutomationCase\('event-delivery', apiName/)

  const expectedOperationEvents: Array<[string, string]> = [
    ['setConversation', 'onConversationChanged'],
    ['revokeMessage', 'onNewRecvMessageRevoked'],
    ['deleteMessage', 'onMsgDeleted'],
    ['updateFriends', 'onFriendInfoChanged'],
    ['deleteFriend', 'onFriendDeleted'],
    ['removeBlack', 'onBlackDeleted'],
    ['setGroupInfo', 'onGroupInfoChanged'],
    ['setGroupMemberInfo', 'onGroupMemberInfoChanged'],
    ['kickGroupMember', 'onGroupMemberDeleted'],
    ['setSelfInfo', 'onSelfInfoUpdated'],
  ]
  for (const [apiName, eventName] of expectedOperationEvents) {
    assert.match(page, new RegExp(`beginAutomationOperation\\('${apiName}'`))
    assert.match(page, new RegExp(`recordAutomationRequiredEventCorrelation\\('${apiName}', '${eventName}'`))
  }

  const eventDelivery = functionSource('runAutomationEventDeliverySuite')
  assert.match(eventDelivery, /runAutomationBatchedMessageEventProbe\(config\)/)
  assert.match(eventDelivery, /runAutomationOfflineMessageEventProbe\(config\)/)
  assert.match(functionSource('runAutomationSetupSuite'), /runAutomationConnectFailureProbe\(config\)/)

  const friendSuite = functionSource('runAutomationFriendSuite')
  assert.match(friendSuite, /recordAutomationRequiredEventCorrelation\('acceptFriendApplication', 'onFriendAdded'/)
  assert.match(friendSuite, /recordAutomationCallableEventCorrelations\('acceptFriendApplication', \['onFriendAdded', 'onFriendApplicationAccepted'\]\)/)
  assert.doesNotMatch(friendSuite, /acceptFriendApplication applicant delivery/)

  const groupSuite = functionSource('runAutomationGroupSuite')
  assert.match(groupSuite, /recordAutomationRequiredEventCorrelation\('kickGroupMember', 'onGroupMemberDeleted'/)
  assert.match(groupSuite, /recordAutomationCallableEventCorrelations\('kickGroupMember', \['onGroupMemberDeleted'\]\)/)
  assert.match(groupSuite, /recordAutomationCallableEventCorrelations\('acceptGroupApplication', \['onGroupApplicationAccepted', 'onGroupMemberAdded'\]\)/)
  assert.doesNotMatch(groupSuite, /kickGroupMember affected-member delivery/)
})

test('peer producer payloads retain their raw Core encoding for narrow schema normalization', () => {
  assert.match(page, /payloadEncodings : Array<string>/)
  assert.match(page, /recordSDKEventDelivery\(mappedEventName, payloadTextValue as string, 'openim-core-json-v1'\)/)
  assert.match(functionSource('readAutomationPeerMessage'), /result\['message'\]/)
  assert.match(functionSource('runAutomationBatchedMessageEventProbe'), /readAutomationPeerMessage\(peerResult/)
  assert.match(functionSource('runAutomationOfflineMessageEventProbe'), /readAutomationPeerMessage\(peerResult/)
})

test('peer message text normalization never returns nullable Core content', () => {
  const reader = functionSource('readAutomationMessageText')
  assert.match(reader, /const content = \(message\.textElem as OpenIMTextElem\)\.content/)
  assert.match(reader, /return content == null \? '' : content as string/)
})

test('Android-generated local functions declare helpers before their first consumers', () => {
  for (const [helper, consumer] of [
    ['automationJSONString', 'stringifyQuoteMessage'],
    ['automationJSONField', 'stringifyQuoteMessage'],
    ['parseAutomationInsertedMessageJSON', 'validateAutomationResponse'],
    ['emptyAutomationEvidence', 'mergeAutomationValidationEvidence'],
    ['createAutomationProfileAssertion', 'mergeAutomationValidationEvidence'],
    ['requireAutomationSemanticProfile', 'mergeAutomationValidationEvidence'],
    ['readAutomationPeerMessage', 'sendAutomationPeerUnreadMessageToPrimary'],
    ['recordAutomationCallableEventCorrelations', 'runAutomationFriendSuite'],
  ] as Array<[string, string]>) {
    assert.ok(functionIndex(helper) < functionIndex(consumer), `${helper} must be declared before ${consumer}`)
  }
  assert.match(functionSource('validateAutomationResponse'), /const content = message\.textElem == null \? null/)
  assert.match(functionSource('validateAutomationResponse'), /if \(content == null \|\| content\.length == 0\)/)
})

test('producer correlations carry one complete mutation witness and disconnect before the offline send', () => {
  const correlations = functionSource('recordAutomationCallableEventCorrelations')
  assert.match(correlations, /mutationAutomationEvidence\(apiName, 'operation-event-identity', 'cross-account-event-observed', allMatched\)/)
  assert.match(correlations, /evidence\.eventCorrelated = allMatched/)

  const offline = functionSource('runAutomationOfflineMessageEventProbe')
  const disconnect = offline.indexOf("networkStatusChanged('uvue_auto_offline_event_network_changed')")
  const peerSend = offline.indexOf("runAutomationPeerCommand('send_text'")
  assert.ok(disconnect >= 0 && disconnect < peerSend, 'offline producer must disconnect before the peer sends')
})

test('quote producers use a deterministic message writer instead of typed JSON stringify', () => {
  const writer = functionSource('stringifyQuoteMessage')
  assert.doesNotMatch(writer, /JSON\.stringify\(message\)/)
  assert.match(writer, /stringifyAutomationNativeMessagePayload\(message\)/)
})

test('runtime evidence uses explicit writers for iOS messages and conversation event arrays', () => {
  const response = functionSource('stringifyAutomationResponseValue')
  assert.match(response, /isAutomationMessageEvidenceName\(name\)/)
  assert.match(response, /stringifyAutomationMessageEvidencePayload\(value\)/)

  const event = functionSource('stringifyAutomationEventValue')
  assert.match(event, /onRecvNewMessages/)
  assert.match(event, /stringifyAutomationMessageEvidencePayload\(result\.messages\)/)
  assert.match(event, /stringifyAutomationConversationList/)

  const conversation = functionSource('stringifyAutomationConversationItem')
  assert.doesNotMatch(conversation, /JSON\.stringify/)
  for (const field of ['conversationID', 'conversationType', 'recvMsgOpt', 'unreadCount', 'isPinned', 'minSeq', 'maxSeq']) {
    assert.match(conversation, new RegExp(`'${field}'`))
  }

  const recorder = functionSource('recordAutomationCase')
  assert.match(recorder, /automationResponseEncoding\(contractAPIName\)/)
  assert.match(page, /function stringifyAutomationMessageEvidencePayload\(value : any \| null\) : string/)
})

test('login correlation selects an operation window containing the complete lifecycle', () => {
  const selector = functionSource('findAutomationLoginLifecycleWindow')
  assert.match(selector, /automationOperationWindows\.length - 1/)
  assert.match(selector, /findAutomationEventOccurrence\(expectedEvents\[eventIndex\]/)
  assert.match(functionSource('buildAutomationEventCorrelations'), /findAutomationLoginLifecycleWindow\(expectedEvents\)/)
  assert.match(functionSource('switchAutomationAccount'), /completeAutomationOperation\('login'/)
})

test('sendMessageNotOss delivery does not require a progress event', () => {
  const suite = functionSource('runAutomationEventDeliverySuite')
  assert.match(suite, /recordAutomationCallableEventCorrelations\('sendMessageNotOss', \['onRecvNewMessage'\]\)/)
  assert.doesNotMatch(suite, /recordAutomationCallableEventCorrelations\('sendMessageNotOss', \[[^\]]*onSendMessageProgress/)
  assert.match(suite, /recordAutomationCallableEventCorrelations\('sendMessage', \['onSendMessageProgress', 'onRecvNewMessage'\]\)/)
})

test('message event correlations preserve stage identity and correlation ownership', () => {
  const correlations = functionSource('buildAutomationEventCorrelations')
  assert.match(
    correlations,
    /eventName == 'onRecvNewMessage' \? 'cross-account-payload-identity' : 'operation-payload-identity'/,
  )
  assert.match(
    correlations,
    /eventName == 'onRecvNewMessage' \? window\.resultIdentity : window\.payloadNeedle/,
  )
})

test('identity correlations skip unrelated same-event noise inside the operation window', () => {
  const finder = functionSource('findAutomationEventOccurrenceByPayloadIdentity')
  assert.match(finder, /occurrence\.sequence > afterSequence/)
  assert.match(finder, /readAutomationEventPayloadIdentity\(eventName, occurrence\.payloadText\) == payloadIdentity/)

  const correlations = functionSource('buildAutomationEventCorrelations')
  assert.match(correlations, /findAutomationEventOccurrenceByPayloadIdentity\(eventName, occurrenceEpoch, afterSequence, payloadIdentity\)/)
  assert.match(correlations, /correlationKind == 'operation-payload-identity'/)
  assert.match(correlations, /correlationKind == 'cross-account-payload-identity'/)
  assert.ok(
    functionIndex('findAutomationEventOccurrenceByPayloadIdentity') > functionIndex('readAutomationEventPayloadIdentity'),
    'Kotlin generation requires the local identity reader before its caller',
  )
})

test('quitGroup waits until the secondary account can observe membership', () => {
  const suite = functionSource('runAutomationGroupSuite')
  const created = suite.indexOf("createGroup(quitGroupParams, 'uvue_auto_quit_group_create')")
  const precondition = suite.indexOf('waitAutomationGroupMembership(quitGroupID, config.secondaryUserID')
  const transfer = suite.indexOf("transferGroupOwner({ groupID: quitGroupID, newOwnerUserID: config.secondaryUserID }, 'uvue_auto_transfer_quit_group')")
  assert.ok(created >= 0)
  assert.ok(precondition > created, 'secondary membership must be observed after group creation')
  assert.ok(transfer > precondition, 'ownership transfer must wait for the peer membership precondition')
  assert.match(functionSource('waitAutomationGroupMembership'), /getSpecifiedGroupsInfo/)
  assert.match(functionSource('waitAutomationGroupMembership'), /getGroupMemberList/)
})

test('conversation and draft mutations are read back and restore the original state', () => {
  const suite = functionSource('runAutomationConversationSuite')
  assert.match(suite, /const originalConversation = await runAutomationStep<OpenIMConversationItem \| null>/)
  assert.match(suite, /setConversation\(setConversationParams, 'uvue_auto_set_conversation'\)/)
  assert.match(suite, /setConversationDraft\(draftParams, 'uvue_auto_set_draft'\)/)
  const setConversationReadback = suite.indexOf("waitAutomationConversationMutation(conversationParams, setConversationParams.isPinned as boolean, setConversationParams.ex as string, originalConversationDraft")
  const setConversationEvidence = suite.indexOf("recordAutomationEvidenceStep('conversation', 'setConversation'")
  const setDraftCall = suite.indexOf("setConversationDraft(draftParams, 'uvue_auto_set_draft')")
  const setDraftReadback = suite.indexOf("waitAutomationConversationMutation(conversationParams, setConversationParams.isPinned as boolean, setConversationParams.ex as string, draftParams.draftText")
  assert.ok(setConversationReadback >= 0, 'setConversation must be read back without relying on the draft mutation')
  assert.ok(setConversationEvidence > setConversationReadback, 'setConversation evidence must follow its own readback')
  assert.ok(setDraftCall > setConversationEvidence, 'setConversationDraft must run after setConversation is independently proven')
  assert.ok(setDraftReadback > setDraftCall, 'setConversationDraft must have its own readback')
  assert.match(suite, /setConversation\(restoreConversationParams, 'uvue_auto_restore_conversation'\)/)
  assert.match(suite, /setConversationDraft\(restoreDraftParams, 'uvue_auto_restore_draft'\)/)
  assert.match(suite, /waitAutomationConversationMutation\(conversationParams, originalConversation\.isPinned, originalConversationEx, originalConversationDraft/)
  assert.match(suite, /try \{[\s\S]+\} finally \{[\s\S]+restoreConversationParams/)
  assert.match(suite, /recordAutomationCleanupEvidence\('conversation', 'setConversation', 'restore-via-read-before-write'/)
  assert.match(suite, /recordAutomationCleanupEvidence\('conversation', 'setConversationDraft', 'restore-via-read-before-write'/)
  const wait = functionSource('waitAutomationConversationMutation')
  assert.match(wait, /const remainingMilliseconds = automationSideEffectTimeoutMilliseconds - \(Date\.now\(\) - startedAt\)/)
  assert.match(wait, /withAutomationTimeout<OpenIMConversationItem \| null>\(getOneConversation\(params, operationID \+ '_' \+ attempt\.toString\(\)\), 'conversation\/getOneConversation', attemptTimeoutMilliseconds\)/)
  assert.doesNotMatch(wait, /withAutomationTimeout<[^>]+>\('conversation', 'getOneConversation'/)
})

test('successful public calls emit semantic evidence only after response validation', () => {
	assert.match(page, /OpenIMLoginStatusLogged,/)
  const runner = functionSource('runAutomationStepWithTimeout')
  const callback = runner.indexOf('onSuccess(value)')
  const validation = runner.indexOf('validateAutomationResponse(name, value)')
  const merge = runner.indexOf('mergeAutomationValidationEvidence(name, validation, evidence)')
  const record = runner.indexOf("recordAutomationCase(group, name, 'passed'")
  assert.ok(callback >= 0)
  assert.ok(validation > callback, 'scenario callback checks must finish before evidence validation')
  assert.ok(merge > validation, 'validated response must be merged into contract evidence')
  assert.ok(record > merge, 'a passing case must be recorded only after evidence is built')

  const responseValidation = functionSource('validateAutomationResponse')
  assert.match(responseValidation, /validateAutomationCreatedMessage\(name, value\)/)
  assert.match(responseValidation, /getUsersInfo did not contain both automation accounts/)
	assert.match(responseValidation, /const expectedStatus = automationLoggedIn \? OpenIMLoginStatusLogged : 1/)
  assert.match(responseValidation, /did not contain the active scenario conversationID/)
  assert.match(responseValidation, /totalCount below its observed message count/)
  assert.match(responseValidation, /uploadFile returned neither url nor uri/)
	assert.match(responseValidation, /semanticValidated: found/)
  assert.doesNotMatch(responseValidation, /return \{ structureValidated: true, semanticValidated: true \}\s*$/)

  const mergeEvidence = functionSource('mergeAutomationValidationEvidence')
  assert.match(mergeEvidence, /if \(validation\.semanticValidated && !evidence\.semanticValidated\)/)
  assert.match(mergeEvidence, /requireAutomationSemanticProfile\(apiName\)/)
  assert.match(mergeEvidence, /'scenario-semantics'/)

	const messageSend = functionSource('runAutomationMessageSendSuite')
	assert.match(messageSend, /while \(Date\.now\(\) - historyStartedAt < automationSideEffectTimeoutMilliseconds/)
	assert.match(messageSend, /sendMessagePeerReadback/)
	assert.match(messageSend, /sendMessageNotOssPeerReadback/)
	assert.match(functionSource('waitAutomationSubscribedStatus'), /automationSideEffectTimeoutMilliseconds/)
})

test('suiteFilter runs one public automation suite without applying full-run coverage gates', () => {
  assert.match(page, /suiteFilter : string/)
  assert.match(functionSource('normalizeAutomationConfig'), /suiteFilter: readAutomationString\(value, 'suiteFilter'\)/)
  assert.match(page, /let automationQuerySuiteFilter = ''/)
  const applyFilter = functionSource('applyConfiguredAutomationSuiteFilter')
  assert.match(applyFilter, /automationSuiteFilter = automationQuerySuiteFilter/)
  assert.match(applyFilter, /automationSuiteFilter = config == null \? '' : config\.suiteFilter\.trim\(\)/)
  assert.match(functionSource('resetAutomationCache'), /automationSuiteFilter = ''/)

  const guardedSuites = functionSource('runAutomationGuardedSuites')
  assert.match(guardedSuites, /if \(automationSuiteFilter\.length > 0\)/)
  assert.match(guardedSuites, /Unknown automation suite filter/)
  assert.match(guardedSuites, /automationSuitePrerequisites\(automationSuiteFilter\)/)
  assert.match(guardedSuites, /await runAutomationGuardedSuite\(prerequisites\[index\], config\)/)
  assert.match(guardedSuites, /await runAutomationGuardedSuite\(automationSuiteFilter, config\)/)
  const prerequisites = functionSource('automationSuitePrerequisites')
  assert.match(prerequisites, /suite == 'conversation'/)
  assert.match(prerequisites, /return \['message-send'\]/)
  assert.match(prerequisites, /suite == 'event-delivery'/)
  assert.match(prerequisites, /return \['message-create', 'message-send', 'upload'\]/)

  const localFiles = functionSource('automationSuiteRequiresLocalFiles')
  assert.match(localFiles, /automationSuiteFilter\.length == 0/)
  assert.match(localFiles, /automationSuiteFilter == 'message-create'/)
  assert.match(localFiles, /automationSuiteFilter == 'upload'/)
  assert.match(localFiles, /automationSuiteFilter == 'event-delivery'/)
  assert.match(functionSource('runAutomationSetupSuite'), /if \(automationSuiteRequiresLocalFiles\(\)\)/)

  const summary = functionSource('buildAutomationSummary')
  assert.match(summary, /const fullAutomationRun = automationSuiteFilter\.length == 0/)
  assert.match(summary, /const coverageMissing = fullAutomationRun \? collectAutomationCoverageMissing\(\) : \[\]/)
  assert.match(summary, /const validatedMissing = fullAutomationRun \? collectAutomationValidatedMissing\(\) : \[\]/)
  assert.match(summary, /const coverageTotal = automationPublicAPINames\.length/)
  assert.match(summary, /const coverageRecorded = automationCoveredAPINames\.length/)
  assert.match(summary, /const validatedRecorded = automationValidatedAPINames\.length/)
  assert.match(summary, /suiteFilter: automationSuiteFilter/)
  assert.match(summary, /executedSuites: buildAutomationExecutedSuites\(\)/)

  assert.match(page, /const suiteFilter = options\["suiteFilter"\] \?\? ""/)
  assert.match(page, /if \(suiteFilter\.length > 0\) \{\s*automationQuerySuiteFilter = suiteFilter\.trim\(\)/)
  assert.match(functionSource('handleRunAutomation'), /if \(automationSuiteFilter\.length == 0\) \{\s*runAutomationCoverageSuite\(\)/)

  assert.match(pageTest, /const requestedSuiteFilter = String\(config\.suiteFilter \|\| ''\)\.trim\(\)/)
  assert.match(pageTest, /suiteFilter: requestedSuiteFilter/)
  assert.match(pageTest, /validateReportAgainstContract\(summary, requestedSuiteFilter\.length === 0\)/)
  assert.match(pageTest, /\.filter\(\(item\) => item && item\.status === 'failed'\)/)
  assert.match(pageTest, /if \(requestedSuiteFilter\.length === 0 && !summary\.contractEvidence\.passed\)/)
  assert.match(pageTest, /expect\(summary\.contractEvidence\.checkedCallables\)\.toBeGreaterThan\(0\)/)
  assert.match(automationRunner, /const requestedSuiteFilter = String\(process\.env\.OPENIM_AUTOMATION_SUITE \|\| ''\)\.trim\(\)/)
  assert.match(automationRunner, /fixture\.suiteFilter = requestedSuiteFilter/)
  assert.match(
    automationRunner,
    /process\.on\('exit', \(\) => \{[\s\S]*restoreAutomationFixture\(\)[\s\S]*\}\)/,
  )
  assert.match(automationRunner, /const fullRun = requestedSuiteFilter\.length === 0/)
  assert.match(automationRunner, /if \(fullRun && \(!evidence\.contractEvidence\.passed/)
  assert.match(automationRunner, /evidence\.contractEvidence\.strictPassed !== true/)
  assert.match(automationRunner, /evidence\.contractEvidence\.knownIssueWaivers/)
})
