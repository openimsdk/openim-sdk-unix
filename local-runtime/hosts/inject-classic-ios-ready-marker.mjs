#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [sourceArgument, product, surface, appID] = process.argv.slice(2)
if (!sourceArgument || !product || !surface || !appID) {
  throw new Error('Usage: inject-classic-ios-ready-marker.mjs <AppDelegate.m> <product> <surface> <dcloud-app-id>')
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(product)) throw new Error('Invalid local runtime product marker')
if (!['uniapp-vue2', 'uniapp-vue3'].includes(surface)) throw new Error('Classic iOS readiness requires a traditional uni-app surface')
if (!/^__UNI__[A-Z0-9]+$/.test(appID)) throw new Error('Invalid DCloud application ID')

const sourcePath = resolve(sourceArgument)
const marker = `OPENIM_LOCAL_RUNTIME_READY:v1:${product}:${surface}`
const registrationBegin = '    // OPENIM_LOCAL_RUNTIME_NATIVE_READY_REGISTRATION_BEGIN'
const registrationEnd = '    // OPENIM_LOCAL_RUNTIME_NATIVE_READY_REGISTRATION_END'
const methodBegin = '// OPENIM_LOCAL_RUNTIME_NATIVE_READY_METHOD_BEGIN'
const methodEnd = '// OPENIM_LOCAL_RUNTIME_NATIVE_READY_METHOD_END'
const registrationPattern = /\n[ \t]*\/\/ OPENIM_LOCAL_RUNTIME_NATIVE_READY_REGISTRATION_BEGIN\r?\n[\s\S]*?[ \t]*\/\/ OPENIM_LOCAL_RUNTIME_NATIVE_READY_REGISTRATION_END\r?\n/g
const methodPattern = /\n\/\/ OPENIM_LOCAL_RUNTIME_NATIVE_READY_METHOD_BEGIN\r?\n[\s\S]*?\/\/ OPENIM_LOCAL_RUNTIME_NATIVE_READY_METHOD_END\r?\n/g

let source = readFileSync(sourcePath, 'utf8')
  .replace(registrationPattern, '\n')
  .replace(methodPattern, '\n')

const launchMethod = /(- \(BOOL\)application:\(UIApplication \*\)application didFinishLaunchingWithOptions:\(NSDictionary \*\)launchOptions\r?\n\{)/
if (!launchMethod.test(source)) throw new Error('Classic iOS AppDelegate launch seam is missing')
const registration = `${registrationBegin}
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(openimLocalRuntimeExpectedAppDidLoad:)
                                                 name:PDRCoreAppDidLoadNotificationKey
                                               object:nil];
${registrationEnd}`
source = source.replace(launchMethod, `$1\n${registration}`)

const appDelegateImplementation = source.indexOf('@implementation AppDelegate')
const appDelegateEnd = appDelegateImplementation < 0 ? -1 : source.indexOf('\n@end', appDelegateImplementation)
if (appDelegateEnd < 0) throw new Error('Classic iOS AppDelegate implementation terminator is missing')
const method = `${methodBegin}
- (void)openimLocalRuntimeExpectedAppDidLoad:(NSNotification *)notification
{
    (void)notification;
    fprintf(stderr, "%s\\n", "${marker}");
    fflush(stderr);
}
${methodEnd}`
source = `${source.slice(0, appDelegateEnd)}\n${method}\n${source.slice(appDelegateEnd)}`
writeFileSync(sourcePath, source)
process.stdout.write(`classic iOS native readiness marker injected for ${product}/${surface}\n`)
