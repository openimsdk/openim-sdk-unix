import type { ContractCallable } from './model.js'

export type CallableTestProfile = ContractCallable['testProfile']

const lifecycleCallables = new Set(['initSDK', 'login', 'logout', 'unInitSDK', 'getLoginStatus', 'getLoginUserID'])
const lifecycleMutationCallables = new Set(['initSDK', 'login', 'logout', 'unInitSDK'])
const messageDeliveryCallables = new Set(['sendMessage', 'sendMessageNotOss'])
const uploadCallables = new Set(['uploadFile', 'uploadLogs', 'cancelUpload'])

/**
 * Import-time default for a callable that has never appeared in Contract IR.
 * Generation never calls this function: once imported, the explicit IR value
 * is authoritative and must be reviewed like any other semantic field.
 */
export function inferCallableTestProfile(
  callable: Pick<ContractCallable, 'name' | 'role'>,
): CallableTestProfile {
  let semanticProfile: string
  if (callable.role !== 'operation') semanticProfile = 'subscription-lifecycle'
  else if (lifecycleCallables.has(callable.name)) semanticProfile = 'lifecycle-state'
  else if (messageDeliveryCallables.has(callable.name)) semanticProfile = 'message-delivery-correlation'
  else if (/^create.*Message/.test(callable.name)) semanticProfile = 'message-content-correlation'
  else if (uploadCallables.has(callable.name)) semanticProfile = 'progress-terminal-correlation'
  else if (callable.name.startsWith('signaling')) semanticProfile = 'signaling-correlation'
  else if (/History|List|Search|Split|Page|Find/.test(callable.name)) semanticProfile = 'pagination-integrity'
  else if (/^(?:set|update|mark|delete|remove|add|accept|refuse|create|join|quit|dismiss|change|pin|revoke|typing|kick|invite)/.test(callable.name)) semanticProfile = 'mutation-observation'
  else semanticProfile = 'response-identity'

  let sideEffectProbe: string
  if (callable.role !== 'operation') sideEffectProbe = 'registry-observation'
  else if (lifecycleMutationCallables.has(callable.name)) sideEffectProbe = 'state-transition'
  else if (messageDeliveryCallables.has(callable.name) || callable.name.startsWith('signaling')) sideEffectProbe = 'cross-account-event-observation'
  else if (uploadCallables.has(callable.name)) sideEffectProbe = 'progress-and-result-observation'
  else if (/^(?:set|update|mark|delete|remove|pin|revoke|change)/.test(callable.name)) sideEffectProbe = 'read-after-write'
  else if (/^(?:add|accept|refuse|createGroup|joinGroup|quitGroup|dismissGroup|kickGroupMember|inviteUserToGroup)/.test(callable.name)) sideEffectProbe = 'cross-account-event-observation'
  else sideEffectProbe = 'none'

  return { semanticProfile, sideEffectProbe }
}

export function requireCallableTestProfile(callable: ContractCallable): CallableTestProfile {
  const profile = callable.testProfile
  if (profile == null || typeof profile.semanticProfile !== 'string' || profile.semanticProfile.length === 0) {
    throw new Error(`Callable ${callable.name} is missing testProfile.semanticProfile`)
  }
  if (typeof profile.sideEffectProbe !== 'string' || profile.sideEffectProbe.length === 0) {
    throw new Error(`Callable ${callable.name} is missing testProfile.sideEffectProbe`)
  }
  return profile
}
