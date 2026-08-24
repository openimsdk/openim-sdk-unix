#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const project = resolve(required('OPENIM_LOCAL_PROJECT_ROOT'))
const hostRoot = resolve(required('OPENIM_LOCAL_NATIVE_HOST'))
const sdkRoot = resolve(required('OPENIM_LOCAL_UNIAPPX_IOS_SDK'))
const descriptor = JSON.parse(readFileSync(required('OPENIM_LOCAL_PRODUCT_DESCRIPTOR'), 'utf8'))
const appID = required('OPENIM_LOCAL_DCLOUD_APP_ID')
const exported = join(project, 'unpackage/resources/app-ios')
const demoRoot = join(hostRoot, 'UniAppXDemo')
const pluginRoot = join(demoRoot, 'OpenIMUTSPlugins')

for (const sibling of ['SDK', 'TemporarySampleFramework']) {
  const target = join(hostRoot, sibling)
  rmSync(target, { recursive: true, force: true })
  symlinkSync(join(sdkRoot, sibling), target, 'dir')
}
rmSync(join(demoRoot, 'UniAppXDemo.xcworkspace'), { recursive: true, force: true })

const viewControllerPath = join(demoRoot, 'UniAppXDemo/ViewController.m')
let viewControllerSource = readFileSync(viewControllerPath, 'utf8')
if (viewControllerSource.includes('- (void)viewDidAppear:')) {
  throw new Error('The uni-app x iOS SDK sample now owns viewDidAppear; update the local auto-start integration explicitly')
}
const implementationEnd = viewControllerSource.lastIndexOf('\n@end')
if (implementationEnd < 0) throw new Error('Unable to locate the uni-app x iOS sample ViewController implementation boundary')
const autoStart = `

- (void)openimLocalRuntimeAutoStart {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self pushWithDefaultAnimation];
    });
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    static BOOL openimLocalRuntimeStarted = NO;
    if (openimLocalRuntimeStarted) return;
    openimLocalRuntimeStarted = YES;
    [self openimLocalRuntimeAutoStart];
}
`
viewControllerSource = `${viewControllerSource.slice(0, implementationEnd)}${autoStart}${viewControllerSource.slice(implementationEnd)}`
writeFileSync(viewControllerPath, viewControllerSource)

const xcodeProjectPath = join(demoRoot, 'UniAppXDemo.xcodeproj/project.pbxproj')
let xcodeProjectSource = readFileSync(xcodeProjectPath, 'utf8')
const localLinkerFlags = 'OTHER_LDFLAGS = "-ObjC";'
const localLinkerFlagCount = xcodeProjectSource.split(localLinkerFlags).length - 1
if (localLinkerFlagCount !== 2) {
  throw new Error(`Expected two uni-app x iOS sample linker flag declarations, got ${localLinkerFlagCount}`)
}
xcodeProjectSource = xcodeProjectSource.replaceAll(localLinkerFlags, 'OTHER_LDFLAGS = "$(inherited) -ObjC";')
writeFileSync(xcodeProjectPath, xcodeProjectSource)

const apps = join(demoRoot, 'UniAppXDemo/uni-app-x/apps')
rmSync(apps, { recursive: true, force: true })
mkdirSync(apps, { recursive: true })
cpSync(join(exported, appID), join(apps, appID), { recursive: true })

rmSync(pluginRoot, { recursive: true, force: true })
mkdirSync(pluginRoot, { recursive: true })
const camelize = (name) => name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
const ruby = (value) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
const podNames = new Map()

for (const plugin of descriptor.plugins) {
  const source = join(exported, 'uni_modules', plugin.id, 'utssdk/app-ios')
  if (!existsSync(join(source, 'src'))) continue
  const podName = `unimodule${camelize(plugin.id)}`
  podNames.set(plugin.id, podName)
  const target = join(pluginRoot, podName)
  cpSync(source, target, { recursive: true })
  const configPath = join(target, 'config.json')
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  const rawFrameworks = Array.isArray(config.frameworks) ? config.frameworks : []
  const frameworks = rawFrameworks.filter((name) => !name.endsWith('.tbd')).map((name) => name.replace(/\.framework$/, ''))
  const libraries = [
    ...(Array.isArray(config.libraries) ? config.libraries : []),
    ...rawFrameworks.filter((name) => name.endsWith('.tbd')).map((name) => name.replace(/^lib/, '').replace(/\.tbd$/, '')),
  ]
  const dependencyNames = (plugin.dependencies ?? []).map((dependency) => `unimodule${camelize(dependency)}`)
  config.openimLocalPluginDependencies = dependencyNames
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const simulatorFoundation = join(sdkRoot, 'SDK/Libs/DCloudUTSFoundation.xcframework/ios-arm64_x86_64-simulator')
  const podspec = [
    'Pod::Spec.new do |s|',
    `  s.name = '${podName}'`,
    "  s.version = '1.0.0'",
    `  s.summary = 'uni-app x UTS plugin ${plugin.id}.'`,
    "  s.homepage = 'https://www.openim.io'",
    "  s.license = { :type => 'Apache-2.0' }",
    "  s.authors = { 'OpenIM' => 'contact@openim.io' }",
    "  s.platform = :ios, '14.0'",
    "  s.source = { :http => 'file:///dev/null' }",
    "  s.source_files = ['src/**/*.{h,m,mm,swift,c,cc,cpp}']",
    "  s.exclude_files = ['src/Tests/**/*']",
    "  s.resources = ['Resources/**/*', 'EmbedResources/**/*', 'config.json', 'PrivacyInfo.xcprivacy']",
    "  s.vendored_frameworks = 'Frameworks/*.{framework,xcframework}'",
    "  s.vendored_libraries = 'Libs/**/*.a'",
    `  s.frameworks = ${JSON.stringify(['DCloudUTSFoundation', ...frameworks])}`,
    `  s.libraries = ${JSON.stringify(libraries)}`,
    `  s.pod_target_xcconfig = { 'FRAMEWORK_SEARCH_PATHS' => '$(inherited) \\\"${ruby(simulatorFoundation)}\\\"', 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }`,
    ...dependencyNames.map((dependency) => `  s.dependency '${dependency}'`),
    'end',
    '',
  ].join('\n')
  writeFileSync(join(target, `${podName}.podspec`), podspec)
}

if (podNames.size === 0) throw new Error('No generated iOS UTS plugins were found in appResource output')
for (const plugin of descriptor.plugins) {
  for (const dependency of plugin.dependencies ?? []) {
    if (!podNames.has(dependency)) throw new Error(`Plugin ${plugin.id} depends on missing generated iOS plugin ${dependency}`)
  }
}

const podLines = [
  "platform :ios, '14.0'",
  'use_frameworks!',
  '',
  "target 'UniAppX' do",
  ...[...podNames.values()].map((podName) => `  pod '${podName}', :path => 'OpenIMUTSPlugins/${podName}'`),
  'end',
  '',
  'post_install do |installer|',
  '  installer.pods_project.targets.each do |target|',
  '    target.build_configurations.each do |config|',
  "      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'",
  '    end',
  '  end',
  'end',
  '',
]
writeFileSync(join(demoRoot, 'Podfile'), podLines.join('\n'))
