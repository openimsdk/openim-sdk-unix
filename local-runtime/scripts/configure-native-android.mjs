#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const localRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(localRuntimeRoot, '..')
const nativeRoot = resolve(process.env.OPENIM_NATIVE_ANDROID_ROOT || `${projectRoot}/unpackage/local-runtime/android-host`)
const manifestPath = resolve(projectRoot, 'manifest.json')

function parseManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
}
export function configureNativeAndroid({ manifest, root, environment = process.env }) {
  const appID = environment.OPENIM_TEST_APP_ID || manifest.appid || ''
  if (!/^__UNI__[A-Za-z0-9]+$/.test(appID) || appID.includes('REPLACE')) {
    throw new Error('manifest appid or OPENIM_TEST_APP_ID must be a real __UNI__ AppID')
  }
  const suffix = appID.replace(/^__UNI__/, '')
  const androidPackage = environment.OPENIM_ANDROID_PACKAGE || `uni.app.${suffix}.local`
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(androidPackage)) {
    throw new Error('OPENIM_ANDROID_PACKAGE is not a valid Android application ID')
  }

  const replacements = new Map([
    ['__OPENIM_UNI_APP_ID__', appID],
    ['__OPENIM_UNI_NAMESPACE__', `uni.${suffix}`],
    ['__OPENIM_ANDROID_APP_ID__', androidPackage],
  ])
  for (const relativePath of [
    'app/build.gradle',
    'app/src/main/AndroidManifest.xml',
    'uniappx/build.gradle',
  ]) {
    const path = resolve(root, relativePath)
    let content = readFileSync(path, 'utf8')
    for (const [token, value] of replacements) content = content.split(token).join(value)
    writeFileSync(path, content)
  }
  return { appID, androidPackage }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = configureNativeAndroid({ manifest: parseManifest(manifestPath), root: nativeRoot })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
