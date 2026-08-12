#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const localRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(process.env.OPENIM_LOCAL_PROJECT_ROOT || resolve(localRuntimeRoot, '..'))
const nativeRoot = resolve(process.env.OPENIM_NATIVE_ANDROID_ROOT || `${projectRoot}/unpackage/local-runtime/android-host`)
const manifestPath = resolve(projectRoot, 'manifest.json')
const descriptorPath = process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR

function parseManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
}
function gradleBuildConfigString(value) {
  return `'${JSON.stringify(JSON.stringify(value)).replaceAll("'", "\\'")}'`
}

export function configureNativeAndroid({ manifest, root, descriptor = null, environment = process.env }) {
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
  const plugins = descriptor?.plugins ?? [{ id: 'unix-openim-sdk', androidNamespace: 'uts.sdk.modules.unixOpenimSdk' }]
  const pluginIDs = new Set(plugins.map((plugin) => plugin.id))
  for (const plugin of plugins) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id)) throw new Error(`Invalid Android plugin ID: ${plugin.id}`)
    for (const dependency of plugin.dependencies ?? []) {
      if (!pluginIDs.has(dependency)) throw new Error(`${plugin.id} references missing plugin dependency ${dependency}`)
    }
  }
  const host = descriptor?.androidHost ?? {}
  const minSdk = host.minSdk ?? 21
  const abiFilters = host.abiFilters ?? ['arm64-v8a', 'x86_64']
  const pluginIncludes = plugins.map((plugin) => `include ':${plugin.id}'`).join('\n')
  const projectDependencies = plugins.map((plugin) => `    implementation project(':${plugin.id}')`).join('\n')
  const fileDependencies = plugins.map((plugin) => `    implementation fileTree(dir: '../${plugin.id}/libs', include: ['*.aar', '*.jar'])`).join('\n')
  replacements.set('__OPENIM_ANDROID_MIN_SDK__', String(minSdk))
  replacements.set('__OPENIM_ANDROID_ABI_FILTERS__', abiFilters.map((abi) => `'${abi}'`).join(', '))
  replacements.set('__OPENIM_UTS_REGISTER_COMPONENTS__', gradleBuildConfigString(host.utsRegisterComponents ?? []))
  replacements.set('__OPENIM_UTS_EASY_COM__', gradleBuildConfigString(host.utsEasyCom ?? []))
  replacements.set('// __OPENIM_PLUGIN_INCLUDES__', pluginIncludes)
  replacements.set('    // __OPENIM_PLUGIN_PROJECT_DEPENDENCIES__', projectDependencies)
  replacements.set('    // __OPENIM_PAGE_PLUGIN_PROJECT_DEPENDENCIES__', projectDependencies)
  replacements.set('    // __OPENIM_PLUGIN_FILE_DEPENDENCIES__', fileDependencies)
  for (const relativePath of [
    'app/build.gradle',
    'app/src/main/AndroidManifest.xml',
    'uniappx/build.gradle',
    'settings.gradle',
  ]) {
    const path = resolve(root, relativePath)
    let content = readFileSync(path, 'utf8')
    for (const [token, value] of replacements) content = content.split(token).join(value)
    writeFileSync(path, content)
  }
  const genericPluginTemplate = resolve(root, 'plugin/build.gradle')
  for (const plugin of plugins) {
    const target = resolve(root, plugin.id, 'build.gradle')
    mkdirSync(resolve(root, plugin.id), { recursive: true })
    copyFileSync(plugin.androidGradleTemplate ?? genericPluginTemplate, target)
    const pluginReplacements = new Map(replacements)
    pluginReplacements.set('__OPENIM_PLUGIN_NAMESPACE__', plugin.androidNamespace ?? `uts.sdk.modules.${plugin.id.replace(/-([a-z])/g, (_match, character) => character.toUpperCase())}`)
    pluginReplacements.set('// __OPENIM_PLUGIN_DEPENDENCIES__', (plugin.dependencies ?? []).map((dependency) => `    implementation project(':${dependency}')`).join('\n'))
    let content = readFileSync(target, 'utf8')
    for (const [token, value] of pluginReplacements) content = content.split(token).join(value)
    writeFileSync(target, content)
  }
  return { appID, androidPackage }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const descriptor = descriptorPath ? JSON.parse(readFileSync(resolve(descriptorPath), 'utf8')) : null
  if (descriptor != null) {
    for (const plugin of descriptor.plugins ?? []) {
      if (plugin.androidGradleTemplate != null) plugin.androidGradleTemplate = resolve(dirname(resolve(descriptorPath)), plugin.androidGradleTemplate)
    }
  }
  const result = configureNativeAndroid({ manifest: parseManifest(manifestPath), root: nativeRoot, descriptor })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
