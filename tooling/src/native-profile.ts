import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CompilePlatform } from './compile.js'

type NativeConfig = Record<string, unknown>

function configPath(root: string, platform: 'android' | 'ios'): string {
  return join(root, `uni_modules/unix-openim-sdk/utssdk/app-${platform}/config.json`)
}

export function localNativeConfig(platform: 'android' | 'ios', releaseConfig: NativeConfig): NativeConfig {
  const local = structuredClone(releaseConfig)
  if (platform === 'android') {
    delete local.dependencies
  } else {
    delete local['dependencies-pods']
    delete local['dependencies-pod-sources']
  }
  return local
}

/**
 * Local native artifacts are a non-release compile profile. The committed
 * config remains Maven/Pod based and is restored byte-for-byte even on error.
 */
export async function withLocalNativeProfile<T>(
  root: string,
  platform: CompilePlatform,
  action: () => Promise<T>,
): Promise<T> {
  if (platform === 'harmony') return action()
  const path = configPath(root, platform)
  const releaseBytes = readFileSync(path)
  const releaseConfig = JSON.parse(releaseBytes.toString('utf8')) as NativeConfig
  const localConfig = localNativeConfig(platform, releaseConfig)
  writeFileSync(path, `${JSON.stringify(localConfig, null, 2)}\n`)
  try {
    return await action()
  } finally {
    writeFileSync(path, releaseBytes)
  }
}
