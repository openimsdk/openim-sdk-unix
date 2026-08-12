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
const sdkRoot = resolve(required('OPENIM_LOCAL_UNIAPP_IOS_SDK'))
const descriptor = JSON.parse(readFileSync(required('OPENIM_LOCAL_PRODUCT_DESCRIPTOR'), 'utf8'))
const appID = required('OPENIM_LOCAL_DCLOUD_APP_ID')
const exported = join(project, 'unpackage/resources')
const pluginRoot = join(host, 'UTSPlugins')
rmSync(pluginRoot, { recursive: true, force: true })
mkdirSync(pluginRoot, { recursive: true })

const camelize = (name) => name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
for (const plugin of descriptor.plugins) {
  const appIOS = join(exported, 'uni_modules', plugin.id, 'utssdk/app-ios')
  if (!existsSync(join(appIOS, 'src'))) continue
  const target = join(pluginRoot, plugin.id, 'utssdk/app-ios')
  mkdirSync(join(target, '..'), { recursive: true })
  cpSync(appIOS, target, { recursive: true })
  const configPath = join(target, 'config.json')
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  config.openimLocalPluginDependencies = (plugin.dependencies ?? []).map((dependency) => `unimodule${camelize(dependency)}`)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

const apps = join(host, 'HBuilder-Hello/Pandora/apps')
rmSync(apps, { recursive: true, force: true })
mkdirSync(apps, { recursive: true })
cpSync(join(exported, appID), join(apps, appID), { recursive: true })
writeFileSync(join(host, 'HBuilder-Hello/control.xml'), `<HBuilder debug="true" version="1.9.9.81702"><apps><app appid="${appID}" appver="1.0.0"/></apps></HBuilder>\n`)

const podfilePath = join(host, 'Podfile')
let podfile = readFileSync(podfilePath, 'utf8')
podfile = podfile
  .replace("platform :ios, '13.0'", "platform :ios, '14.0'")
  .replace("pod 'uniapp', :path => '..', :subspecs => uniapp_subspecs", `pod 'uniapp', :path => '${sdkRoot.replaceAll("'", "\\'")}', :subspecs => uniapp_subspecs`)
if (process.env.OPENIM_LOCAL_CLASSIC_VIDEO === '1') podfile = podfile.replace("#   'Video',", "   'Video',")
writeFileSync(podfilePath, podfile)

const helperPath = join(host, 'scripts/uniapp_uts_plugins.rb')
let helper = readFileSync(helperPath, 'utf8')
helper = helper
  .replace('%w[src Frameworks Libs Resources]', '%w[src Frameworks Libs Resources EmbedResources]')
  .replace("frameworks = array_config(config, 'frameworks').map { |name| name.sub(/\\.framework\\z/, '') }\n    libraries = array_config(config, 'libraries')", "raw_frameworks = array_config(config, 'frameworks')\n    frameworks = raw_frameworks.reject { |name| name.end_with?('.tbd') }.map { |name| name.sub(/\\.framework\\z/, '') }\n    libraries = array_config(config, 'libraries') + raw_frameworks.select { |name| name.end_with?('.tbd') }.map { |name| name.sub(/\\Alib/, '').sub(/\\.tbd\\z/, '') }")
  .replace("s.resources = ['Resources/**/*', 'config.json', 'PrivacyInfo.xcprivacy']", "s.resources = ['Resources/**/*', 'EmbedResources/**/*', 'config.json', 'PrivacyInfo.xcprivacy']")
  .replace("s.vendored_frameworks = 'Frameworks/**/*.{framework,xcframework}'", "s.vendored_frameworks = 'Frameworks/*.{framework,xcframework}'")
  .replace("lines << \"  s.summary = 'uni-app UTS plugin #{plugin_name}.'\"", "lines << \"  s.summary = 'uni-app UTS plugin #{plugin_name}.'\"\n    lines << \"  s.homepage = 'https://www.openim.io'\"\n    lines << \"  s.license = { :type => 'Apache-2.0' }\"\n    lines << \"  s.authors = { 'OpenIM' => 'contact@openim.io' }\"")
  .replace("lines << \"  s.source = { :path => '.' }\"", "lines << \"  s.source = { :http => 'file:///dev/null' }\"")
  .replace("lines << \"  s.dependency 'uniapp/Core'\"", "lines << \"  s.dependency 'uniapp/Core'\"\n    array_config(config, 'openimLocalPluginDependencies').each { |dependency| lines << \"  s.dependency '#{dependency}'\" }")
writeFileSync(helperPath, helper)
