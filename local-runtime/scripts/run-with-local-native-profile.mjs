#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const localRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(localRuntimeRoot, '..')

export function localNativeConfig(platform, releaseConfig) {
  const local = structuredClone(releaseConfig)
  if (platform === 'android') delete local.dependencies
  else {
    delete local['dependencies-pods']
    delete local['dependencies-pod-sources']
  }
  return local
}

export function localSourceManifest(releaseManifest) {
  const local = structuredClone(releaseManifest)
  const uniAppX = local['uni-app-x']
  if (uniAppX != null && typeof uniAppX === 'object') {
    uniAppX.vapor = false
    delete uniAppX['vapor-render-target']
  }
  return local
}

export function runWithLocalNativeProfile({ root, platform, command, args, environment = process.env }) {
  if (platform !== 'android' && platform !== 'ios') throw new Error('platform must be android or ios')
  if (!command) throw new Error('command is required')

  const configPath = resolve(root, `uni_modules/unix-openim-sdk/utssdk/app-${platform}/config.json`)
  const manifestPath = resolve(root, 'manifest.json')
  const stateRoot = resolve(root, 'unpackage/local-runtime/native-profile')
  const backupPath = resolve(stateRoot, `${platform}-config.backup`)
  const manifestBackupPath = resolve(stateRoot, `${platform}-manifest.backup`)
  const lockPath = resolve(stateRoot, `${platform}.lock`)
  mkdirSync(stateRoot, { recursive: true })

  if (existsSync(backupPath)) {
    writeFileSync(configPath, readFileSync(backupPath))
    unlinkSync(backupPath)
  }
  if (existsSync(manifestBackupPath)) {
    writeFileSync(manifestPath, readFileSync(manifestBackupPath))
    unlinkSync(manifestBackupPath)
  }
  let lockDescriptor
  try {
    lockDescriptor = openSync(lockPath, 'wx')
    writeFileSync(lockDescriptor, String(process.pid))
  } catch {
    throw new Error(`Another local native profile command is active for ${platform}: ${lockPath}`)
  }

  try {
    const releaseBytes = readFileSync(configPath)
    const manifestBytes = readFileSync(manifestPath)
    writeFileSync(backupPath, releaseBytes)
    writeFileSync(manifestBackupPath, manifestBytes)
    const localConfig = localNativeConfig(platform, JSON.parse(releaseBytes.toString('utf8')))
    const localManifest = localSourceManifest(JSON.parse(manifestBytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`)
    writeFileSync(manifestPath, `${JSON.stringify(localManifest, null, 2)}\n`)

    const result = spawnSync(command, args, {
      cwd: root,
      env: Object.fromEntries(
        Object.entries(environment).filter(([name]) => name !== 'UNI_APP_X_VAPOR_RENDER_TARGET'),
      ),
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Local ${platform} command failed with exit code ${String(result.status)}`)
    }
  } finally {
    if (existsSync(backupPath)) {
      writeFileSync(configPath, readFileSync(backupPath))
      unlinkSync(backupPath)
    }
    if (existsSync(manifestBackupPath)) {
      writeFileSync(manifestPath, readFileSync(manifestBackupPath))
      unlinkSync(manifestBackupPath)
    }
    if (lockDescriptor != null) closeSync(lockDescriptor)
    if (existsSync(lockPath)) unlinkSync(lockPath)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2]
  const separator = process.argv.indexOf('--')
  if (separator < 0 || separator === process.argv.length - 1) {
    throw new Error('Usage: run-with-local-native-profile.mjs <android|ios> -- <command> [args...]')
  }
  runWithLocalNativeProfile({
    root: projectRoot,
    platform,
    command: process.argv[separator + 1],
    args: process.argv.slice(separator + 2),
  })
}
