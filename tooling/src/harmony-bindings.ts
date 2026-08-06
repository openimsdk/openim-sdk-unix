import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const IMPORT_START = '// <openim-generated-harmony-imports>'
const IMPORT_END = '// </openim-generated-harmony-imports>'
const OPERATIONS_START = '  // <openim-generated-harmony-operations>'
const OPERATIONS_END = '  // </openim-generated-harmony-operations>'

export type HarmonyTypedMethod = {
  code: number
  name: string
  requestType: string | null
  responseType: string
  declaration: string
}

export type HarmonyNativeEvent = {
  name: string
  value: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function harDeclaration(privateRoot: string): string {
  const harPath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs/imsdk.har')
  return execFileSync('tar', ['-xOzf', harPath, 'package/src/main/ets/sdk-types.d.ets'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

export function harmonyTypedMethods(privateRoot: string): HarmonyTypedMethod[] {
  const declaration = harDeclaration(privateRoot)
  const sdkBody = /export interface OpenIMSDK\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const methods: HarmonyTypedMethod[] = []
  for (const match of sdkBody.matchAll(/^\s*([A-Za-z_$][\w$]*)\((.*?)\): Promise<([^;]+)>;/gm)) {
    const name = match[1] ?? ''
    const parameters = match[2] ?? ''
    const responseType = match[3] ?? ''
    const noRequest = parameters === 'operationID?: string'
    const requestMatch = /^params: ([A-Za-z_$][\w$]*), operationID\?: string$/.exec(parameters)
    assert(noRequest || requestMatch != null, `Unsupported Harmony typed method signature: ${match[0]}`)
    methods.push({
      code: 400001 + methods.length,
      name,
      requestType: noRequest ? null : requestMatch?.[1] ?? null,
      responseType,
      declaration: match[0].trim(),
    })
  }
  assert(methods.length === 142, `Expected 142 typed Harmony Promise methods, got ${methods.length}`)
  return methods
}

export function harmonyNativeEvents(privateRoot: string): HarmonyNativeEvent[] {
  const declaration = harDeclaration(privateRoot)
  const enumBody = /export declare enum OpenIMSDKEvent\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const events = [...enumBody.matchAll(/\b(Event[A-Za-z0-9_]+)\s*=\s*(-?\d+)/g)].map((match) => ({
    name: match[1] ?? '',
    value: Number(match[2]),
  }))
  assert(events.length === 69, `Expected 69 Harmony native events, got ${events.length}`)
  return events
}

function replaceRegion(source: string, start: string, end: string, content: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  assert(startIndex >= 0 && endIndex > startIndex, `Missing generated region ${start}`)
  const contentStart = startIndex + start.length
  return `${source.slice(0, contentStart)}\n${content}${source.slice(endIndex)}`
}

function manualHarImports(source: string): Set<string> {
  const withoutGenerated = replaceRegion(source, IMPORT_START, IMPORT_END, '')
  const body = /import harmonySDK,\s*\{([\s\S]*?)\}\s*from '@openimsdk\/imsdk'/.exec(withoutGenerated)?.[1] ?? ''
  return new Set(body.split(',').map((value) => value.trim()).filter((value) => value !== ''))
}

function methodName(name: string): string {
  return `callBinding${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
}

function renderMethod(method: HarmonyTypedMethod): string {
  const call = method.requestType == null
    ? `harmonySDK.${method.name}(operationID)`
    : `harmonySDK.${method.name}(request, operationID)`
  const request = method.requestType == null
    ? ''
    : `    const request: ${method.requestType} = JSON.parse(requestJSON) as ${method.requestType}\n`
  const response = method.responseType === 'OpenIMSDKEmptyPayload'
    ? `    const nativePromise: Promise<string> = ${call}.then((_response: OpenIMSDKEmptyPayload): string => {\n      return ''\n    })`
    : `    const nativePromise: Promise<string> = ${call}.then((response: ${method.responseType}): string => {\n      return OpenIMHarmonyDriver.encodeObjectResponse(response)\n    })`
  return [
    `  private static ${methodName(method.name)}(requestJSON: string, operationID: string): Promise<string> {`,
    request.trimEnd(),
    response,
    '    return OpenIMHarmonyDriver.trackStringPromise(nativePromise)',
    '  }',
  ].filter((line) => line !== '').join('\n')
}

function renderOperations(methods: HarmonyTypedMethod[]): string {
  const functions = methods.map(renderMethod).join('\n\n')
  const cases = methods.map((method) => [
    `      case ${method.code}:`,
    `        return OpenIMHarmonyDriver.${methodName(method.name)}(requestJSON, operationID)`,
  ].join('\n')).join('\n')
  return `${functions}\n\n  static callAsync(operationCode: number, operationID: string, requestJSON: string): Promise<string> {\n    switch (operationCode) {\n${cases}\n      default:\n        return Promise.reject(new Error('Unsupported Harmony operation code: ' + String(operationCode)))\n    }\n  }\n`
}

export function renderHarmonyDriverBindings(privateRoot: string): string {
  const driverPath = join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets')
  const source = readFileSync(driverPath, 'utf8')
  const methods = harmonyTypedMethods(privateRoot)
  const manualImports = manualHarImports(source)
  const generatedImports = new Set<string>()
  for (const method of methods) {
    if (method.requestType != null && !manualImports.has(method.requestType)) generatedImports.add(method.requestType)
    if (!manualImports.has(method.responseType)) generatedImports.add(method.responseType)
  }
  const importNames = [...generatedImports].sort()
  const importBlock = importNames.length === 0
    ? ''
    : `import {\n${importNames.map((name) => `  ${name}`).join(',\n')}\n} from '@openimsdk/imsdk'\n`
  const withImports = replaceRegion(source, IMPORT_START, IMPORT_END, importBlock)
  return replaceRegion(withImports, OPERATIONS_START, OPERATIONS_END, renderOperations(methods))
}

export function renderHarmonyOperationCodes(privateRoot: string): string {
  const methods = harmonyTypedMethods(privateRoot)
  const mappings = methods.map((method) => [
    `  if (method == '${method.name}') {`,
    `    return ${method.code}`,
    '  }',
  ].join('\n')).join('\n')
  const events = harmonyNativeEvents(privateRoot)
  const eventMappings = events.map((event) => [
    `  if (eventName == '${event.name}') {`,
    `    return ${event.value}`,
    '  }',
  ].join('\n')).join('\n')
  return `// Generated from the locked Harmony HAR ABI. Do not edit.\nexport function harmonyOperationCode(method : string) : number {\n${mappings}\n  return -1\n}\n\nexport function harmonyEventCode(eventName : string) : number {\n${eventMappings}\n  return -1\n}\n`
}
