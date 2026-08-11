import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type MobileBuildPlatform = 'android' | 'ios'

interface PrivateNativeInventory {
  android: {
    artifactPath: string
    artifactSha256: string
    minimumApi: number
    architectures: string[]
  }
  ios: {
    artifactPath: string
    linkage: string
    installName: string
    deploymentTarget: string
    device: {
      architectures: string[]
      binarySha256: string
    }
    simulator: {
      architectures: string[]
      binarySha256: string
    }
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sorted(values: string[]): string[] {
  return [...values].sort()
}

function command(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function deploymentTargetParts(value: string): number[] {
  assert(/^\d+(?:\.\d+)*$/.test(value), `Invalid iOS deployment target: ${value}`)
  return value.split('.').map(Number)
}

export function isNativeDeploymentTargetCompatible(nativeTarget: string, pluginTarget: string): boolean {
  const native = deploymentTargetParts(nativeTarget)
  const plugin = deploymentTargetParts(pluginTarget)
  const count = Math.max(native.length, plugin.length)
  for (let index = 0; index < count; index += 1) {
    const nativePart = native[index] ?? 0
    const pluginPart = plugin[index] ?? 0
    if (nativePart < pluginPart) return true
    if (nativePart > pluginPart) return false
  }
  return true
}

export function verifyPrivateNativeArtifacts(
  privateRoot: string,
  platform: MobileBuildPlatform,
): void {
  const inventory = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/native-abi/apple-android.json'), 'utf8'),
  ) as PrivateNativeInventory

  if (platform === 'android') {
    const artifact = join(privateRoot, inventory.android.artifactPath)
    assert(sha256File(artifact) === inventory.android.artifactSha256, 'Private Android AAR hash mismatch')
    const config = JSON.parse(
      readFileSync(join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/config.json'), 'utf8'),
    ) as { abis: string[]; minSdkVersion: number }
    assert(config.minSdkVersion === inventory.android.minimumApi, 'Private Android minSdkVersion mismatch')
    assert(
      JSON.stringify(sorted(config.abis)) === JSON.stringify(sorted(inventory.android.architectures)),
      'Private Android ABI configuration mismatch',
    )
    const archiveEntries = command('unzip', ['-Z1', artifact]).split('\n')
    for (const architecture of inventory.android.architectures) {
      assert(
        archiveEntries.includes(`jni/${architecture}/libgojni.so`),
        `Private Android AAR is missing ${architecture}/libgojni.so`,
      )
    }
    return
  }

  const xcframework = join(privateRoot, inventory.ios.artifactPath)
  const deviceBinary = join(xcframework, 'ios-arm64/OpenIMCore.framework/OpenIMCore')
  const simulatorBinary = join(
    xcframework,
    'ios-arm64_x86_64-simulator/OpenIMCore.framework/OpenIMCore',
  )
  assert(sha256File(deviceBinary) === inventory.ios.device.binarySha256, 'Private iOS device binary hash mismatch')
  assert(
    sha256File(simulatorBinary) === inventory.ios.simulator.binarySha256,
    'Private iOS simulator binary hash mismatch',
  )
  assert(inventory.ios.linkage === 'dynamic', 'Private iOS inventory must require dynamic linkage')
  assert(command('file', [deviceBinary]).includes('dynamically linked shared library arm64'), 'Private iOS device binary is not dynamic arm64')
  assert(command('file', [simulatorBinary]).includes('dynamically linked shared library'), 'Private iOS simulator binary is not dynamic')
  assert(
    JSON.stringify(sorted(command('lipo', ['-archs', deviceBinary]).split(/\s+/))) ===
      JSON.stringify(sorted(inventory.ios.device.architectures)),
    'Private iOS device architectures mismatch',
  )
  assert(
    JSON.stringify(sorted(command('lipo', ['-archs', simulatorBinary]).split(/\s+/))) ===
      JSON.stringify(sorted(inventory.ios.simulator.architectures)),
    'Private iOS simulator architectures mismatch',
  )
  assert(command('otool', ['-D', simulatorBinary]).includes(inventory.ios.installName), 'Private iOS install name mismatch')
  const config = JSON.parse(
    readFileSync(join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/config.json'), 'utf8'),
  ) as { deploymentTarget: string }
  assert(
    isNativeDeploymentTargetCompatible(inventory.ios.deploymentTarget, config.deploymentTarget),
    'Private iOS native deployment target exceeds the plugin minimum',
  )
}
