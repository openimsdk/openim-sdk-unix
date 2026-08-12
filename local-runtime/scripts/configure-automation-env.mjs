#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const localRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(localRuntimeRoot, '..')
const statePath = resolve(projectRoot, 'unpackage/local-runtime/automation-env.json')
const environmentPath = resolve(projectRoot, 'env.js')

function parseManifest() {
  return JSON.parse(readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
}
export function buildAutomationEnvironment({ previous = {}, platform, basePath, deviceID, appID, packageName }) {
  if (platform !== 'android' && platform !== 'ios') throw new Error('platform must be android or ios')
  const platforms = { ...(previous.platforms || {}) }
  platforms[platform] = {
    id: deviceID,
    executablePath: resolve(basePath),
    appid: appID,
    package: packageName,
  }
  return { schema: 1, platforms }
}

export function renderAutomationEnvironment(state) {
  return `module.exports = ${JSON.stringify({
    'is-custom-runtime': true,
    compile: true,
    'app-plus': {
      'uni-app-x': state.platforms,
    },
  }, null, 2)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [platform, basePath, deviceID, packageName] = process.argv.slice(2)
  if (!platform || !basePath || !deviceID || !packageName) {
    throw new Error('Usage: configure-automation-env.mjs <android|ios> <base-path> <device-id> <package>')
  }
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
  const state = buildAutomationEnvironment({
    previous,
    platform,
    basePath,
    deviceID,
    appID: parseManifest().appid,
    packageName,
  })
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(environmentPath, renderAutomationEnvironment(state), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(state.platforms[platform])}\n`)
}
