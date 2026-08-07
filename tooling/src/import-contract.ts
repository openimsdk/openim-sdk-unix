import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import type {
  CompletionMode,
  ContractCallable,
  ContractConstant,
  ContractDocument,
  ContractEvent,
  ContractType,
  NativeBinding,
  SourceByPlatform,
} from './model.js'
import {
  extractExportedTypes,
  extractExportedValues,
  extractStringUnion,
  findExportedFunction,
  findMatchingCallArguments,
  getParameterType,
  normalizeContractText,
  parseSource,
  sha256,
  type ExportedValue,
  type ParsedSource,
} from './source.js'

const EXPECTED_PUBLIC = { constants: 109, types: 160, callables: 161, events: 48 } as const
const INDEX_MARKERS = {
  constants: '// <openim-generated:constants>',
  eventCallables: '// <openim-generated:event-callables>',
  operations: '// <openim-generated:operations>',
} as const

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`)
}

export function declarationParts(value: ExportedValue, parsed: ParsedSource): { type: string; initializer: string } {
  if (!ts.isVariableStatement(value.node)) throw new Error(`${value.name} is not a constant declaration`)
  const declaration = value.node.declarationList.declarations.find(
    (item) => ts.isIdentifier(item.name) && item.name.text === value.name,
  )
  if (!declaration) throw new Error(`Cannot read declaration for ${value.name}`)
  return {
    type: normalizeContractText(declaration.type?.getText(parsed.sourceFile) ?? 'unknown'),
    initializer: normalizeContractText(declaration.initializer?.getText(parsed.sourceFile) ?? ''),
  }
}

export function completionMode(returnType: string): CompletionMode {
  if (returnType === 'void') return 'void'
  if (returnType.startsWith('Promise<')) return 'promise'
  return 'sync'
}

export function codecFor(returnType: string): string {
  if (returnType === 'void') return 'void'
  if (returnType === 'string' || returnType === 'Promise<string>') return 'raw-string'
  if (returnType === 'Promise<boolean>' || returnType === 'boolean') return 'boolean'
  if (returnType.includes('number')) return 'number'
  const promise = /^Promise<(.+)>$/.exec(returnType)
  return `typed:${promise?.[1] ?? returnType}`
}

export function bindingFor(declaration: string, eventNames: Set<string>, name: string): NativeBinding {
  if (eventNames.has(name)) return { kind: 'event', symbol: name }
  if (name === 'off' || name === 'offEvent') return { kind: 'event', symbol: name }
  const native = /NativeOpenIMSDK\.([A-Za-z_$][\w$]*)/.exec(declaration)
  if (native?.[1]) return { kind: 'native', symbol: native[1] }
  const alias = /\breturn\s+([A-Za-z_$][\w$]*)\s*\(/.exec(declaration)
  if (alias?.[1]) return { kind: 'facade-alias', symbol: alias[1] }
  return { kind: 'none', symbol: '' }
}

export function dispatchArguments(eventFunctionText: string, generatedEventsSource?: string, eventName?: string): string {
  if (eventFunctionText.includes('onVoidEvent(')) return ''
  if (eventFunctionText.includes('onErrorEvent(')) return 'errCode, errMsg'
  if (eventFunctionText.includes('onMessageEvent(')) return 'parseNativeMessage(payload)'
  if (eventFunctionText.includes('onMessageListEvent(')) return 'parseNativeMessageEventList(payload)'
  if (eventFunctionText.includes('onConversationListEvent(')) return 'parseNativeConversationEventList(payload)'
  if (eventFunctionText.includes('onBooleanEvent(')) return "payload == 'true'"
  if (eventFunctionText.includes('onNumberEvent(')) return 'parseFloat(payload)'
  if (eventFunctionText.includes('onStringEvent(')) return 'payload'
  const argumentsText = findMatchingCallArguments(eventFunctionText, 'handler')
  const generatedArguments = generatedEventsSource != null && eventName != null
    ? findMatchingCallArguments(generatedEventsSource, `${eventName}DispatchHandler`)
    : undefined
  const inferredArguments = argumentsText ?? generatedArguments
  if (inferredArguments === undefined) throw new Error(`Cannot infer event projection from: ${eventFunctionText}`)
  return inferredArguments
    .replaceAll('event.payload', 'payload')
    .replaceAll('event.errCode', 'errCode')
    .replaceAll('event.errMsg', 'errMsg')
    .trim()
}

function makeIndexTemplate(
  parsed: ParsedSource,
  constants: Set<string>,
  eventCallables: Set<string>,
  operations: Set<string>,
): string {
  type Replacement = { start: number; end: number; value: string }
  const replacements: Replacement[] = []
  const inserted = { constants: false, eventCallables: false, operations: false }
  const exported = extractExportedValues(parsed)
  for (const value of exported) {
    let category: keyof typeof inserted | undefined
    if (constants.has(value.name)) category = 'constants'
    else if (eventCallables.has(value.name)) category = 'eventCallables'
    else if (operations.has(value.name)) category = 'operations'
    if (!category) continue
    const marker = inserted[category] ? '' : INDEX_MARKERS[category]
    inserted[category] = true
    replacements.push({
      start: value.node.getStart(parsed.sourceFile),
      end: value.node.end,
      value: marker,
    })
  }
  let output = parsed.text
  replacements.sort((left, right) => right.start - left.start)
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  for (const [category, present] of Object.entries(inserted)) {
    if (!present) throw new Error(`Failed to create index template marker ${category}`)
  }
  return output.replace(/\n{4,}/g, '\n\n\n')
}

function makeEventPrelude(parsed: ParsedSource): string {
  const helperNames = new Set([
    'readBooleanPayload',
    'readNumberPayload',
    'readJSONStringField',
    'readJSONNumberField',
    'parseSendMessageProgress',
  ])
  const statements: string[] = []
  for (const statement of parsed.sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      statements.push(statement.getText(parsed.sourceFile))
      continue
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && helperNames.has(statement.name.text)) {
      statements.push(statement.getText(parsed.sourceFile))
    }
  }
  return statements.join('\n')
}

export function pairValues(android: ExportedValue[], ios: ExportedValue[]): Array<[ExportedValue, ExportedValue]> {
  const iosByName = new Map(ios.map((value) => [value.name, value]))
  const result: Array<[ExportedValue, ExportedValue]> = []
  for (const androidValue of android) {
    const iosValue = iosByName.get(androidValue.name)
    if (!iosValue) throw new Error(`iOS façade is missing export ${androidValue.name}`)
    result.push([androidValue, iosValue])
    iosByName.delete(androidValue.name)
  }
  if (iosByName.size > 0) throw new Error(`Android façade is missing exports: ${[...iosByName.keys()].join(', ')}`)
  return result
}

export function importPublicContract(root: string): ContractDocument {
  const plugin = join(root, 'uni_modules/unix-openim-sdk/utssdk')
  const interfacePath = join(plugin, 'interface.uts')
  const androidIndexPath = join(plugin, 'app-android/index.uts')
  const iosIndexPath = join(plugin, 'app-ios/index.uts')
  const androidEventsPath = join(plugin, 'app-android/events.uts')
  const iosEventsPath = join(plugin, 'app-ios/events.uts')
  const interfaceSource = parseSource(interfacePath)
  const androidIndex = parseSource(androidIndexPath)
  const iosIndex = parseSource(iosIndexPath)
  const androidEvents = parseSource(androidEventsPath)
  const iosEvents = parseSource(iosEventsPath)

  const exportedTypes = extractExportedTypes(interfaceSource)
  const types: ContractType[] = exportedTypes.map((value, index) => ({
    id: 1001 + index,
    name: value.name,
    declaration: value.declaration,
    signatureHash: sha256(normalizeContractText(value.declaration)),
  }))

  const pairs = pairValues(extractExportedValues(androidIndex), extractExportedValues(iosIndex))
  const constants: ContractConstant[] = []
  const callablePairs: Array<[ExportedValue, ExportedValue]> = []
  for (const pair of pairs) {
    if (pair[0].isCallable) callablePairs.push(pair)
    else {
      const androidParts = declarationParts(pair[0], androidIndex)
      const iosParts = declarationParts(pair[1], iosIndex)
      if (androidParts.type !== iosParts.type || androidParts.initializer !== iosParts.initializer) {
        throw new Error(`Constant ${pair[0].name} differs between Android and iOS`)
      }
      constants.push({
        id: constants.length + 1,
        name: pair[0].name,
        type: androidParts.type,
        value: androidParts.initializer,
        declaration: { android: pair[0].declaration, ios: pair[1].declaration },
        signatureHash: sha256(`${pair[0].name}:${androidParts.type}=${androidParts.initializer}`),
      })
    }
  }

  const eventNames = extractStringUnion(interfaceSource, 'OpenIMSDKEventName')
  const eventNameSet = new Set(eventNames)
  const eventCallableNames = new Set([...eventNames, 'off', 'offEvent'])
  const callables: ContractCallable[] = callablePairs.map(([android, ios], index) => {
    if (android.signature !== ios.signature) {
      throw new Error(`Callable ${android.name} differs by platform:\n${android.signature}\n${ios.signature}`)
    }
    const isEvent = eventNameSet.has(android.name)
    const role = isEvent ? 'event-subscription' : android.name === 'off' || android.name === 'offEvent' ? 'event-control' : 'operation'
    return {
      id: 2001 + index,
      name: android.name,
      signature: android.signature,
      completion: completionMode(android.returnType),
      responseCodec: isEvent ? 'event-handler' : codecFor(android.returnType),
      errorPolicy: android.returnType.startsWith('Promise<') ? 'frozen-native-rejection' : 'none',
      rawString: android.returnType === 'string' || android.returnType === 'Promise<string>',
      role,
      declaration: { android: android.declaration, ios: ios.declaration },
      binding: {
        android: bindingFor(android.declaration, eventNameSet, android.name),
        ios: bindingFor(ios.declaration, eventNameSet, ios.name),
        harmony: undefined,
      },
      signatureHash: sha256(android.signature),
    }
  })

  const events: ContractEvent[] = eventNames.map((name, index) => {
    const eventCallable = callables.find((callable) => callable.name === name)
    if (!eventCallable) throw new Error(`Missing public subscription callable ${name}`)
    const internalName = `${name}Event`
    const androidFunction = findExportedFunction(androidEvents, internalName)
    const iosFunction = findExportedFunction(iosEvents, internalName)
    if (!androidFunction || !iosFunction) throw new Error(`Missing event adapter ${internalName}`)
    const androidHandler = getParameterType(androidFunction, 0, androidEvents.sourceFile)
    const iosHandler = getParameterType(iosFunction, 0, iosEvents.sourceFile)
    if (normalizeContractText(androidHandler) !== normalizeContractText(iosHandler)) {
      throw new Error(`Event handler ${name} differs by platform`)
    }
    const event: ContractEvent = {
      id: 3001 + index,
      name,
      callable: name,
      handlerType: normalizeContractText(androidHandler),
      dispatchArguments: {
        android: dispatchArguments(androidFunction.getText(androidEvents.sourceFile), androidEvents.text, name),
        ios: dispatchArguments(iosFunction.getText(iosEvents.sourceFile), iosEvents.text, name),
      },
      rawPayload: androidHandler === 'OpenIMStringEventHandler',
      binding: {
        android: 'bound',
        ios: 'bound',
        harmony: 'not-in-edition',
      },
      signatureHash: sha256(`${name}:${normalizeContractText(androidHandler)}`),
    }
    return event
  })

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const contract: ContractDocument = {
    schemaVersion: 1,
    edition: 'public',
    generatedFrom: {
      repository: 'https://github.com/openimsdk/openim-sdk-unix',
      revision,
      interfacePath: relative(root, interfacePath),
      facadePaths: {
        android: relative(root, androidIndexPath),
        ios: relative(root, iosIndexPath),
      },
    },
    expected: { ...EXPECTED_PUBLIC },
    constants,
    types,
    callables,
    events,
  }

  const actual = {
    constants: constants.length,
    types: types.length,
    callables: callables.length,
    events: events.length,
  }
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_PUBLIC)) {
    throw new Error(`Public surface count mismatch: expected ${JSON.stringify(EXPECTED_PUBLIC)}, got ${JSON.stringify(actual)}`)
  }

  const contractsPath = join(root, 'contracts/base/contract.json')
  writeText(contractsPath, JSON.stringify(contract, null, 2))
  const constantsSet = new Set(constants.map((value) => value.name))
  const operationSet = new Set(callables.filter((value) => value.role === 'operation').map((value) => value.name))
  writeText(
    join(root, 'sdk-src/uts/app-android/index.template.uts'),
    makeIndexTemplate(androidIndex, constantsSet, eventCallableNames, operationSet),
  )
  writeText(
    join(root, 'sdk-src/uts/app-ios/index.template.uts'),
    makeIndexTemplate(iosIndex, constantsSet, eventCallableNames, operationSet),
  )
  writeText(join(root, 'sdk-src/uts/app-android/events.prelude.uts'), makeEventPrelude(androidEvents))
  writeText(join(root, 'sdk-src/uts/app-ios/events.prelude.uts'), makeEventPrelude(iosEvents))
  return contract
}

export { INDEX_MARKERS }
