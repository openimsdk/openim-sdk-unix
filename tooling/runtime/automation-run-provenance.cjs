'use strict'

const { createHash } = require('node:crypto')

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function stableJSONStringify(value) {
  return JSON.stringify(canonicalize(value))
}

function releaseProvenanceDigest(data) {
  return createHash('sha256').update(stableJSONStringify(data)).digest('hex')
}

function buildAutomationRunProvenance(manifest) {
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('automation evidence requires a run manifest object')
  }
  const runId = String(manifest.runId || '')
  const platform = String(manifest.platform || '')
  if (runId.length === 0 || !['android', 'ios', 'harmony'].includes(platform)) {
    throw new Error('automation evidence run manifest identity is invalid')
  }
  const data = {
    runId,
    platform,
    edition: String(manifest.edition || (platform === 'harmony' ? 'private' : 'public')),
    sdk: {
      revision: String(manifest.sdk?.head || ''),
      dirty: manifest.sdk?.dirty === true,
    },
    core: {
      revision: String(manifest.core?.head || ''),
      dirty: manifest.core?.dirty === true,
    },
    artifact: platform === 'harmony'
      ? {
          kind: 'harmony-har-hap',
          harSha256: String(manifest.harmony?.harSha256 || ''),
          lockedHarSha256: String(manifest.harmony?.lockedHarSha256 || ''),
          nativeABIContractSha256: String(manifest.harmony?.nativeABIContractSha256 || ''),
          hapSha256: String(manifest.harmony?.hapSha256 || ''),
          hapFreshForRun: manifest.harmony?.hapFreshForRun === true,
        }
      : {
          kind: 'custom-base',
          sha256: String(manifest.customBase?.sha256 || ''),
          nativeArtifactKind: String(manifest.customBase?.nativeArtifactKind || ''),
          nativeArtifactSha256: String(manifest.customBase?.nativeArtifactSha256 || ''),
        },
    toolchain: {
      hbuilderxVersion: String(manifest.hbuilderx?.version || ''),
      hbuilderxCliSha256: String(manifest.hbuilderx?.cliSha256 || ''),
      ...(String(manifest.automationPeerToolchain?.authoritySha256 || '').length > 0
        ? { automationPeerAuthoritySha256: String(manifest.automationPeerToolchain.authoritySha256) }
        : {}),
      ...(platform === 'harmony' ? { devEcoVersion: String(manifest.devEco?.version || '') } : {}),
    },
    runtime: {
      target: String(manifest.runtime?.target || ''),
      deviceID: String(manifest.runtime?.deviceID || ''),
      deviceKind: String(manifest.runtime?.deviceKind || ''),
      osVersion: String(manifest.runtime?.osVersion || ''),
      architecture: String(manifest.runtime?.architecture || ''),
      buildConfiguration: String(manifest.runtime?.buildConfiguration || ''),
    },
    series: {
      id: String(manifest.series?.id || ''),
      sequence: Number(manifest.series?.sequence || 0),
      total: Number(manifest.series?.total || 0),
    },
    vapor: manifest.vapor === true,
  }
  return {
    schemaVersion: 1,
    sha256: releaseProvenanceDigest(data),
    data,
  }
}

module.exports = {
  buildAutomationRunProvenance,
  releaseProvenanceDigest,
  stableJSONStringify,
}
