#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const project = resolve(required('OPENIM_LOCAL_PROJECT_ROOT'))
const host = resolve(required('OPENIM_LOCAL_NATIVE_HOST'))
const exported = join(project, 'unpackage/resources')
const appID = required('OPENIM_LOCAL_DCLOUD_APP_ID')
const applicationID = required('OPENIM_LOCAL_APPLICATION_ID')
const descriptor = JSON.parse(readFileSync(required('OPENIM_LOCAL_PRODUCT_DESCRIPTOR'), 'utf8'))
const minSdk = Number(descriptor.androidHost?.minSdk ?? 21)
if (!Number.isInteger(minSdk) || minSdk < 21) throw new Error(`Invalid classic Android minSdk: ${descriptor.androidHost?.minSdk}`)
const appKey = process.env.OPENIM_DCLOUD_APP_KEY_ANDROID || 'LOCAL_BUILD_REQUIRES_RUNTIME_APP_KEY'

const escapeSingle = (value) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
const pluginDocuments = new Map(descriptor.plugins.map((plugin) => [plugin.id, plugin]))
const exportedPluginsRoot = join(exported, 'uni_modules')
const pluginIDs = existsSync(exportedPluginsRoot)
  ? readdirSync(exportedPluginsRoot).filter((id) => existsSync(join(exportedPluginsRoot, id, 'utssdk/app-android/src')))
  : []
if (pluginIDs.length === 0) throw new Error('HBuilderX exported no Android UTS plugin modules')

writeFileSync(join(host, 'settings.gradle'), ["include ':app'", ...pluginIDs.map((id) => `include ':${id}'`), ''].join('\n'))

for (const id of pluginIDs) {
  const source = join(exportedPluginsRoot, id, 'utssdk/app-android')
  const target = join(host, id)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(target, 'src/main/java'), { recursive: true })
  mkdirSync(join(target, 'src/main/res'), { recursive: true })
  mkdirSync(join(target, 'libs'), { recursive: true })
  cpSync(join(source, 'src'), join(target, 'src/main/java'), { recursive: true })
  if (existsSync(join(source, 'res'))) cpSync(join(source, 'res'), join(target, 'src/main/res'), { recursive: true })
  if (existsSync(join(source, 'libs'))) cpSync(join(source, 'libs'), join(target, 'libs'), { recursive: true })
  const pluginManifestPath = join(target, 'src/main/AndroidManifest.xml')
  if (existsSync(join(source, 'AndroidManifest.xml'))) {
    const pluginManifest = readFileSync(join(source, 'AndroidManifest.xml'), 'utf8')
      .replace(/\s+package=(["'])[^"']*\1/, '')
    writeFileSync(pluginManifestPath, pluginManifest)
  } else writeFileSync(pluginManifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n')
  writeFileSync(join(target, 'proguard-rules.pro'), '')
  const pluginDocument = pluginDocuments.get(id)
  const dependencies = pluginDocument?.dependencies ?? []
  const projectDependencies = dependencies.filter((dependency) => pluginIDs.includes(dependency)).map((dependency) => `    implementation project(':${escapeSingle(dependency)}')`)
  const namespace = pluginDocument?.androidNamespace ?? `io.openim.local.generated.${id.replaceAll('-', '')}`
  writeFileSync(join(target, 'build.gradle'), `plugins {
    id 'com.android.library'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace '${escapeSingle(namespace)}'
    compileSdkVersion 35
    defaultConfig { minSdkVersion ${minSdk} }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = '1.8' }
}

dependencies {
    compileOnly fileTree(dir: '../app/libs', include: ['*.aar', '*.jar'])
    implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])
${projectDependencies.join('\n')}
    compileOnly 'com.alibaba:fastjson:1.2.83'
    compileOnly 'androidx.core:core-ktx:1.6.0'
    compileOnly 'org.jetbrains.kotlin:kotlin-stdlib:2.2.0'
    compileOnly 'org.jetbrains.kotlin:kotlin-reflect:2.2.0'
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.6.4'
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.6.4'
    compileOnly 'com.github.getActivity:XXPermissions:18.63'
}
`)
}

const appGradlePath = join(host, 'app/build.gradle')
let appGradle = readFileSync(appGradlePath, 'utf8')
appGradle = appGradle
  .replace("namespace 'com.android.UniPlugin'", `namespace '${escapeSingle(applicationID)}'`)
  .replace('applicationId "com.android.UniPlugin"', `applicationId '${escapeSingle(applicationID)}'`)
  .replace(/minSdkVersion\s+\d+/, `minSdkVersion ${minSdk}`)
  .replace(/\n\s*implementation project\(':[^']+'\)/g, '')
  .replace(/\n}\s*$/, `\n${pluginIDs.map((id) => `    implementation project(':${escapeSingle(id)}')`).join('\n')}\n}\n`)
writeFileSync(appGradlePath, appGradle)

const manifestPath = join(host, 'app/src/main/AndroidManifest.xml')
let manifest = readFileSync(manifestPath, 'utf8')
manifest = manifest.replace('开发者需登录https://dev.dcloud.net.cn/申请签名', appKey)
writeFileSync(manifestPath, manifest)

const appsRoot = join(host, 'app/src/main/assets/apps')
rmSync(appsRoot, { recursive: true, force: true })
mkdirSync(join(appsRoot, appID), { recursive: true })
cpSync(join(exported, appID), join(appsRoot, appID), { recursive: true })
writeFileSync(join(host, 'app/src/main/assets/data/dcloud_control.xml'), `<hbuilder><apps><app appid="${appID}" appver=""/></apps></hbuilder>\n`)
writeFileSync(join(host, 'app/src/main/assets/dcloud_uniplugins.json'), '{"nativePlugins":[]}\n')
