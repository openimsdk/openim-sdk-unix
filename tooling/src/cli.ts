import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compilePlatform, type CompilePlatform, verifyToolchain } from './compile.js'
import { generate } from './generate.js'
import { importPublicContract } from './import-contract.js'
import { importNativeABI } from './native-abi.js'
import { verifyUTSPolicy } from './policy.js'
import { verifyGenerated, verifySurfaceSnapshot, readAndValidateContract } from './verify-contract.js'
import { verifyDriverInvariants } from './verify-driver.js'
import { bootstrapEnterpriseDrivers, importEnterpriseDelta, verifyEnterpriseDelta } from './enterprise-contract.js'
import { monomorphizeHarmonyFacade } from './harmony-monomorphize.js'

const toolingDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const root = resolve(toolingDirectory, '..')
const command = process.argv[2] ?? 'verify'

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

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (value == null || value === '') throw new Error(`Missing required argument ${name}`)
  return resolve(value)
}

switch (command) {
  case 'contract:import': {
    importPublicContract(root)
    generate(root)
    console.log('Imported and generated the frozen public contract.')
    break
  }
  case 'generate': {
    const outputs = generate(root)
    console.log(`Generated ${outputs.length} public artifact files.`)
    break
  }
  case 'verify:surface': {
    verifySurfaceSnapshot(root)
    console.log('Public surface snapshot verified.')
    break
  }
  case 'verify:policy': {
    verifyUTSPolicy(root)
    console.log('Stable UTS policy verified.')
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
    const delta = importEnterpriseDelta(root, privateRoot)
    console.log(`Imported enterprise delta: ${delta.types.length} types, ${delta.callables.length} callables, ${delta.events.length} events.`)
    break
  }
  case 'enterprise:verify': {
    const privateRoot = requiredArgument('--private-root')
    verifyEnterpriseDelta(root, privateRoot)
    console.log('Enterprise add-only delta and Harmony ABI verified.')
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
    verifyEnterpriseDelta(root, privateRoot)
    for (const platform of requestedPrivatePlatforms()) await compilePlatform(privateRoot, platform, root)
    break
  }
  case 'compile': {
    for (const platform of requestedPlatforms()) await compilePlatform(root, platform)
    break
  }
  case 'verify': {
    readAndValidateContract(root)
    verifyGenerated(root)
    verifySurfaceSnapshot(root)
    verifyUTSPolicy(root)
    verifyToolchain(root)
    verifyDriverInvariants(root)
    console.log('Contract, generation, UTS policy, and toolchain lock verified.')
    break
  }
  default:
    throw new Error(`Unknown tooling command: ${command}`)
}
