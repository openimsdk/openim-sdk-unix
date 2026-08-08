import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const REGION_START = '// <openim-generated-harmony-monomorphic-codecs>'
const REGION_END = '// </openim-generated-harmony-monomorphic-codecs>'

type CodecFamily = 'wrapHarmonyPromise' | 'rejectHarmonyPromise' | 'invokeHarmonyMapped'

export type HarmonyMonomorphicManifest = {
  schemaVersion: 1
  wrapTypes: string[]
  rejectTypes: string[]
  mappedTypes: string[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function facadePath(privateRoot: string): string {
  return join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/index.uts')
}

function manifestPath(privateRoot: string): string {
  return join(privateRoot, 'contracts/enterprise/harmony-monomorphic-codecs.json')
}

function parseCalls(source: string): Map<CodecFamily, Set<string>> {
  const sourceFile = ts.createSourceFile('index.uts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const families = new Map<CodecFamily, Set<string>>([
    ['wrapHarmonyPromise', new Set<string>()],
    ['rejectHarmonyPromise', new Set<string>()],
    ['invokeHarmonyMapped', new Set<string>()],
  ])
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.typeArguments?.length === 1) {
      const name = node.expression.text as CodecFamily
      const family = families.get(name)
      if (family != null) family.add(node.typeArguments[0]?.getText(sourceFile) ?? '')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return families
}

function functionName(prefix: string, type: string): string {
  const readable = type.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 72)
  const hash = createHash('sha256').update(type).digest('hex').slice(0, 8)
  return `${prefix}__${readable}_${hash}`
}

function wrapName(type: string): string {
  return functionName('wrapHarmonyPromise', type)
}

function rejectName(type: string): string {
  return functionName('rejectHarmonyPromise', type)
}

function mappedName(type: string): string {
  return functionName('invokeHarmonyMapped', type)
}

function renderWrap(type: string): string {
  const name = wrapName(type)
  return `function ${name}(promise : Promise<${type}>, method : string) : Promise<${type}> {\n  return new Promise<${type}>((resolve, reject) => {\n    promise.then((value : ${type}) => {\n      resolve(value)\n    }).catch((reason : ESObject | null) => {\n      rejectNativeError(reject, -1, readErrorMessage(reason, method))\n    })\n  })\n}`
}

function renderReject(type: string): string {
  const name = rejectName(type)
  return `function ${name}(method : string, message : string) : Promise<${type}> {\n  return new Promise<${type}>((_resolve, reject) => {\n    rejectNativeError(reject, -1, method + ' ' + message)\n  })\n}`
}

function renderMapped(type: string): string {
  const name = mappedName(type)
  return `function ${name}(callableID : number, method : string, params : ESObject, mapper : (payload : ESObject) => ${type}, operationID ?: string | null) : Promise<${type}> {\n  return ${wrapName(type)}(callHarmonyDriverAsync(callableID, normalizeOperationID(operationID), stringifyESObject(params)).then((payloadJSON : string) : ${type} => {\n    return mapper(parseHarmonyResponseObject(payloadJSON, method))\n  }), method)\n}`
}

function replaceRegion(source: string, content: string): string {
  const startIndex = source.indexOf(REGION_START)
  const endIndex = source.indexOf(REGION_END)
  assert(startIndex >= 0 && endIndex > startIndex, 'Harmony monomorphic codec region is missing')
  const contentStart = startIndex + REGION_START.length
  return `${source.slice(0, contentStart)}\n${content}${source.slice(endIndex)}`
}

function readManifest(privateRoot: string): HarmonyMonomorphicManifest {
  return JSON.parse(readFileSync(manifestPath(privateRoot), 'utf8')) as HarmonyMonomorphicManifest
}

function renderHelpers(manifest: HarmonyMonomorphicManifest): string {
  return [
    ...manifest.wrapTypes.map(renderWrap),
    ...manifest.rejectTypes.map(renderReject),
    ...manifest.mappedTypes.map(renderMapped),
  ].join('\n\n') + '\n'
}

export function demonomorphizeHarmonyText(
  source: string,
  manifest: HarmonyMonomorphicManifest,
): string {
  let result = source
  for (const type of manifest.wrapTypes) result = result.replaceAll(wrapName(type), `wrapHarmonyPromise<${type}>`)
  for (const type of manifest.rejectTypes) result = result.replaceAll(rejectName(type), `rejectHarmonyPromise<${type}>`)
  for (const type of manifest.mappedTypes) result = result.replaceAll(mappedName(type), `invokeHarmonyMapped<${type}>`)
  return result
}

export function demonomorphizeHarmonySource(
  source: string,
  manifest: HarmonyMonomorphicManifest,
): string {
  return replaceRegion(demonomorphizeHarmonyText(source, manifest), '')
}

export function monomorphizeHarmonySource(source: string): {
  source: string
  manifest: HarmonyMonomorphicManifest
} {
  const calls = parseCalls(source)
  const mappedTypes = [...(calls.get('invokeHarmonyMapped') ?? [])].filter(Boolean).sort()
  const wrapTypes = [...new Set([...(calls.get('wrapHarmonyPromise') ?? []), ...mappedTypes])].filter(Boolean).sort()
  const rejectTypes = [...(calls.get('rejectHarmonyPromise') ?? [])].filter(Boolean).sort()
  assert(wrapTypes.length > 0 && mappedTypes.length > 0, 'No Harmony generic codec calls found to monomorphize')
  const manifest: HarmonyMonomorphicManifest = {
    schemaVersion: 1,
    wrapTypes,
    rejectTypes,
    mappedTypes,
  }
  let result = source
  for (const type of wrapTypes) result = result.replaceAll(`wrapHarmonyPromise<${type}>`, wrapName(type))
  for (const type of rejectTypes) result = result.replaceAll(`rejectHarmonyPromise<${type}>`, rejectName(type))
  for (const type of mappedTypes) result = result.replaceAll(`invokeHarmonyMapped<${type}>`, mappedName(type))
  assert(!/\b(?:wrapHarmonyPromise|rejectHarmonyPromise|invokeHarmonyMapped)\s*</.test(result), 'Harmony generic codec calls remain')
  return { source: replaceRegion(result, renderHelpers(manifest)), manifest }
}

export function renderHarmonyMonomorphicHelpers(privateRoot: string): string {
  const source = readFileSync(facadePath(privateRoot), 'utf8')
  return replaceRegion(source, renderHelpers(readManifest(privateRoot)))
}

export function monomorphizeHarmonyFacade(privateRoot: string): HarmonyMonomorphicManifest {
  const projection = monomorphizeHarmonySource(readFileSync(facadePath(privateRoot), 'utf8'))
  const { manifest, source } = projection
  const targetManifest = manifestPath(privateRoot)
  mkdirSync(dirname(targetManifest), { recursive: true })
  writeFileSync(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(facadePath(privateRoot), source.endsWith('\n') ? source : `${source}\n`)
  return manifest
}
