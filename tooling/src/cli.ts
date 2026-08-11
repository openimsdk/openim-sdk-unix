import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compilePlatform, type CompilePlatform, verifyToolchain } from './compile.js'
import { generate } from './generate.js'
import { importNativeABI } from './native-abi.js'
import { verifyCompatibilityLedger, verifyReleaseNativeArtifacts, verifyUTSPolicy, type ReleaseEdition } from './policy.js'
import { verifyGenerated, verifySurfaceSnapshot, readAndValidateContract } from './verify-contract.js'
import { verifyDriverInvariants } from './verify-driver.js'
import { bootstrapEnterpriseDrivers, verifyEnterpriseDelta } from './enterprise-contract.js'
import { monomorphizeHarmonyFacade } from './harmony-monomorphize.js'
import { buildPrivatePlatform } from './local-build.js'
import { verifyPrivateNativeArtifacts, type MobileBuildPlatform } from './private-native.js'
import { buildStableIDRegistry, writePublicStableIDRegistry } from './contract-integrity.js'
import { writeGeneratedManifest } from './generated-manifest.js'
import {
  applyPublicContractImport,
  migrationPreviewSummary,
  previewPublicContractImport,
  readMigrationApproval,
} from './public-contract-import.js'
import { withLocalNativeProfile } from './native-profile.js'
import { verifyEventControlConsumerCompile } from './consumer-compile.js'
import { buildEnterpriseStableIDRegistry, writeEnterpriseStableIDRegistry } from './enterprise-integrity.js'
import {
  applyEnterpriseMigration,
  previewEnterpriseImport,
  readEnterpriseMigrationApproval,
} from './enterprise-migration.js'
import {
  extractEnterpriseComposerAuthority,
  generateEnterpriseAppleAndroid,
  generateEnterprise,
  writeEnterpriseComposerAuthority,
} from './enterprise-compose.js'
import {
  assertEnterpriseGeneratedManifestCurrent,
  verifyEnterpriseDeletionRegeneration,
  writeEnterpriseAppleAndroidGeneratedManifest,
  writeEnterpriseGeneratedManifest,
} from './enterprise-generated-manifest.js'
import {
  verifyEnterpriseAutomationSummaryStructure,
  verifyPublicAutomationSummaryStructure,
} from './automation-summary.js'
import { verifyReleaseIntegrity } from './release-integrity.js'
import { verifyRuntimeEvidenceSet, type RuntimePlatform } from './runtime-evidence.js'

const toolingDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const root = resolve(toolingDirectory, '..')
const command = process.argv[2] ?? 'verify'

function repositoryEdition(): ReleaseEdition {
  return existsSync(resolve(root, 'contracts/enterprise/delta.json')) ? 'enterprise' : 'public'
}

function requestedPlatforms(): CompilePlatform[] {
  const index = process.argv.indexOf('--platform')
  const value = index >= 0 ? process.argv[index + 1] : 'all'
  if (value === 'all') return ['android', 'ios']
  if (value === 'android' || value === 'ios' || value === 'harmony') return [value]
  throw new Error(`Unknown compile platform: ${value ?? 'missing'}`)
}

function requestedPrivatePlatforms(): CompilePlatform[] {
  const index = process.argv.indexOf('--platform')
  const value = index >= 0 ? process.argv[index + 1] : 'all'
  if (value === 'all') return ['android', 'ios', 'harmony']
  if (value === 'android' || value === 'ios' || value === 'harmony') return [value]
  throw new Error(`Unknown private compile platform: ${value ?? 'missing'}`)
}

function requestedEnterpriseGenerationScope(): 'full' | 'apple-android' {
  const index = process.argv.indexOf('--platform')
  const value = index >= 0 ? process.argv[index + 1] : 'full'
  if (value === 'full' || value === 'all') return 'full'
  if (value === 'apple-android') return value
  throw new Error(`Unknown Enterprise generation platform: ${value ?? 'missing'}`)
}

function requestedMobilePlatforms(): MobileBuildPlatform[] {
  const index = process.argv.indexOf('--platform')
  const value = index >= 0 ? process.argv[index + 1] : 'all'
  if (value === 'all') return ['android', 'ios']
  if (value === 'android' || value === 'ios') return [value]
  throw new Error(`Unknown private mobile build platform: ${value ?? 'missing'}`)
}

function requestedNativeProfile(): 'release' | 'local' {
  const index = process.argv.indexOf('--native-profile')
  const value = index >= 0 ? process.argv[index + 1] : 'release'
  if (value === 'release' || value === 'local') return value
  throw new Error(`Unknown native dependency profile: ${value ?? 'missing'}`)
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (value == null || value === '') throw new Error(`Missing required argument ${name}`)
  return resolve(value)
}

function argumentValues(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1]
      if (value == null || value === '') throw new Error(`Missing value after ${name}`)
      values.push(value)
    }
  }
  return values
}

function requiredRuntimePlatform(): RuntimePlatform {
  const index = process.argv.indexOf('--expected-platform')
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (value === 'android' || value === 'ios' || value === 'harmony') return value
  throw new Error(`Unknown or missing --expected-platform: ${value ?? 'missing'}`)
}

switch (command) {
  case 'contract:ids:init': {
    const contract = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8'))) as ReturnType<typeof readAndValidateContract>
    writePublicStableIDRegistry(root, buildStableIDRegistry(contract))
    console.log('Initialized the public stable ID registry.')
    break
  }
  case 'contract:import': {
    const preview = previewPublicContractImport(root)
    console.log(JSON.stringify(migrationPreviewSummary(preview), null, 2))
    const approvalIndex = process.argv.indexOf('--approve-migration')
    if (approvalIndex >= 0) {
      const approvalPath = process.argv[approvalIndex + 1]
      if (approvalPath == null || approvalPath === '') throw new Error('Missing approval file after --approve-migration')
      applyPublicContractImport(root, preview, readMigrationApproval(resolve(approvalPath)))
      console.log('Applied the approved public contract migration.')
    } else {
      console.log('Preview only; no files were written. Use --approve-migration <approval.json> to apply this exact fingerprint.')
    }
    break
  }
  case 'generate': {
    const outputs = generate(root)
    writeGeneratedManifest(root)
    console.log(`Generated ${outputs.length} public artifact files.`)
    break
  }
  case 'verify:surface': {
    verifySurfaceSnapshot(root)
    console.log('Public surface snapshot verified.')
    break
  }
  case 'verify:generated': {
    verifyGenerated(root)
    console.log('Public generated sources, manifest, deletion, and consumer probes verified.')
    break
  }
  case 'verify:automation-summary': {
    const summary = requiredArgument('--summary')
    const result = verifyPublicAutomationSummaryStructure(readAndValidateContract(root), summary)
    console.log(JSON.stringify(result, null, 2))
    if (result.failures.length > 0 || result.driftFailures.length > 0 || result.missingRecordedStructureValidation.length > 0) {
      throw new Error('Public automation summary failed response structure verification.')
    }
    console.log(`Public automation summary structure verified (${result.verifiedCases} callable responses checked).`)
    break
  }
  case 'verify:policy': {
    verifyUTSPolicy(root)
    verifyCompatibilityLedger(root)
    console.log('Stable UTS and compatibility policies verified.')
    break
  }
  case 'verify:release-policy': {
    const edition = repositoryEdition()
    verifyUTSPolicy(root)
    verifyCompatibilityLedger(root, true, undefined, edition)
    verifyReleaseNativeArtifacts(root, edition)
    console.log(`${edition} release compatibility and native artifact policy verified.`)
    break
  }
  case 'verify:release-integrity': {
    const edition = repositoryEdition()
    const result = verifyReleaseIntegrity(root, edition, process.argv.includes('--release'))
    console.log(`${edition} SBOM, license, and secret scan verified: ${result.reportPath}`)
    break
  }
  case 'verify:runtime-evidence': {
    const evidencePaths = argumentValues('--evidence').map((path) => resolve(path))
    if (evidencePaths.length === 0) throw new Error('At least one --evidence path is required')
    const minimumIndex = process.argv.indexOf('--minimum-runs')
    const minimumRuns = minimumIndex >= 0 ? Number(process.argv[minimumIndex + 1]) : 1
    const result = verifyRuntimeEvidenceSet(root, evidencePaths, {
      expectedPlatform: requiredRuntimePlatform(),
      release: process.argv.includes('--release'),
      minimumRuns,
      requireArm64PhysicalRelease: process.argv.includes('--require-arm64-physical-release'),
    })
    console.log(`Runtime evidence verified for ${result.platform}: ${result.runIds.join(', ')}`)
    break
  }
  case 'native:import': {
    importNativeABI(root)
    console.log('Imported the locked public native ABI inventories.')
    break
  }
  case 'native:verify': {
    verifyToolchain(root)
    console.log('Public native artifacts and local overrides verified.')
    break
  }
  case 'enterprise:import': {
    const privateRoot = requiredArgument('--private-root')
    const preview = previewEnterpriseImport(root, privateRoot)
    console.log(JSON.stringify({ ...preview, candidateOutputs: undefined, writeApproved: false }, null, 2))
    const approvalIndex = process.argv.indexOf('--approve-migration')
    if (approvalIndex >= 0) {
      const approvalPath = process.argv[approvalIndex + 1]
      if (approvalPath == null || approvalPath === '') throw new Error('Missing approval file after --approve-migration')
      applyEnterpriseMigration(privateRoot, preview, readEnterpriseMigrationApproval(approvalPath))
      console.log('Applied the approved Enterprise contract migration.')
    } else {
      console.log('Preview only; no Enterprise files were written.')
    }
    break
  }
  case 'enterprise:ids:init': {
    const privateRoot = requiredArgument('--private-root')
    const delta = JSON.parse((await import('node:fs')).readFileSync(resolve(privateRoot, 'contracts/enterprise/delta.json'), 'utf8'))
    writeEnterpriseStableIDRegistry(privateRoot, buildEnterpriseStableIDRegistry(delta))
    console.log('Initialized the Enterprise stable ID registry with retired callable 200001.')
    break
  }
  case 'enterprise:composer:extract': {
    const privateRoot = requiredArgument('--private-root')
    const approvalIndex = process.argv.indexOf('--approve-bootstrap')
    const approval = approvalIndex >= 0 ? process.argv[approvalIndex + 1] : undefined
    if (approval !== 'current-facade') {
      throw new Error('Enterprise composer authority extraction requires --approve-bootstrap current-facade')
    }
    writeEnterpriseComposerAuthority(privateRoot, extractEnterpriseComposerAuthority(root, privateRoot))
    console.log('Extracted the one-time Enterprise compiler authority from the approved current façade.')
    break
  }
  case 'enterprise:generate': {
    const privateRoot = requiredArgument('--private-root')
    if (requestedEnterpriseGenerationScope() === 'apple-android') {
      const outputs = generateEnterpriseAppleAndroid(root, privateRoot)
      writeEnterpriseAppleAndroidGeneratedManifest(root, privateRoot)
      console.log(`Generated ${outputs.length} Enterprise apple-android artifacts and the scoped manifest.`)
    } else {
      generateEnterprise(root, privateRoot)
      writeEnterpriseGeneratedManifest(root, privateRoot)
      console.log('Generated the Enterprise projection from Public base plus Enterprise authority.')
    }
    break
  }
  case 'enterprise:verify-generated': {
    const privateRoot = requiredArgument('--private-root')
    assertEnterpriseGeneratedManifestCurrent(root, privateRoot)
    const result = verifyEnterpriseDeletionRegeneration(root, privateRoot)
    console.log(`Enterprise generated projection verified (${result.outputCount} reproducible outputs).`)
    break
  }
  case 'enterprise:verify': {
    const privateRoot = requiredArgument('--private-root')
    assertEnterpriseGeneratedManifestCurrent(root, privateRoot)
    verifyEnterpriseDeletionRegeneration(root, privateRoot)
    verifyEnterpriseDelta(root, privateRoot)
    console.log('Enterprise composer outputs, add-only delta, and Harmony ABI verified.')
    break
  }
  case 'enterprise:verify-automation-summary': {
    const privateRoot = requiredArgument('--private-root')
    const summary = requiredArgument('--summary')
    const delta = JSON.parse((await import('node:fs')).readFileSync(resolve(privateRoot, 'contracts/enterprise/delta.json'), 'utf8'))
    const result = verifyEnterpriseAutomationSummaryStructure(readAndValidateContract(root), delta, summary)
    console.log(JSON.stringify(result, null, 2))
    if (result.failures.length > 0 || result.driftFailures.length > 0 || result.missingRecordedStructureValidation.length > 0) {
      throw new Error('Enterprise automation summary failed response structure verification.')
    }
    console.log(`Enterprise automation summary structure verified (${result.verifiedCases} callable responses checked).`)
    break
  }
  case 'enterprise:bootstrap': {
    const privateRoot = requiredArgument('--private-root')
    bootstrapEnterpriseDrivers(root, privateRoot)
    verifyEnterpriseDelta(root, privateRoot)
    console.log('Bootstrapped Android/iOS runtimes and the Harmony Driver into the enterprise plugin.')
    break
  }
  case 'enterprise:monomorphize-harmony': {
    const privateRoot = requiredArgument('--private-root')
    const manifest = monomorphizeHarmonyFacade(privateRoot)
    console.log(`Generated Harmony monomorphic codecs: ${manifest.wrapTypes.length} promise, ${manifest.rejectTypes.length} rejection, ${manifest.mappedTypes.length} mapped types.`)
    break
  }
  case 'compile-private': {
    const privateRoot = requiredArgument('--private-root')
    const platforms = requestedPrivatePlatforms()
    verifyEnterpriseDelta(root, privateRoot, {
      // A compile produces candidate evidence. Requiring the previous source
      // certification here makes every legitimate Harmony Driver edit
      // impossible to build. enterprise:verify remains the release gate.
      verifyHarmonyCertification: false,
    })
    for (const platform of platforms) {
      if (platform === 'android' || platform === 'ios') {
        verifyPrivateNativeArtifacts(privateRoot, platform)
      }
      await compilePlatform(privateRoot, platform, root, { verifyPublicNative: false })
    }
    break
  }
  case 'build-private': {
    const privateRoot = requiredArgument('--private-root')
    const platforms = requestedMobilePlatforms()
    verifyEnterpriseDelta(root, privateRoot, { verifyHarmonyCertification: false })
    for (const platform of platforms) await buildPrivatePlatform(privateRoot, platform, root)
    break
  }
  case 'compile': {
    const profile = requestedNativeProfile()
    for (const platform of requestedPlatforms()) {
      if (profile === 'local') {
        await withLocalNativeProfile(root, platform, () => compilePlatform(root, platform, root, { verifyPublicNative: false }))
      } else {
        await compilePlatform(root, platform)
      }
    }
    break
  }
  case 'verify:consumer': {
    const platforms = requestedPlatforms()
    for (const platform of platforms) {
      if (platform === 'harmony') throw new Error('Public consumer compile supports Android and iOS only')
      await verifyEventControlConsumerCompile(root, platform)
      console.log(`${platform} positive consumer compiled and removed export failed compilation as expected.`)
    }
    break
  }
  case 'verify': {
    readAndValidateContract(root)
    verifyGenerated(root)
    verifySurfaceSnapshot(root)
    verifyUTSPolicy(root)
    verifyCompatibilityLedger(root)
    verifyToolchain(root)
    verifyDriverInvariants(root)
    console.log('Contract, generation, UTS policy, and toolchain lock verified.')
    break
  }
  default:
    throw new Error(`Unknown tooling command: ${command}`)
}
