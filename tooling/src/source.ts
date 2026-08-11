import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

export interface ParsedSource {
  fileName: string
  text: string
  sourceFile: ts.SourceFile
}

export interface ExportedType {
  node: ts.TypeAliasDeclaration
  name: string
  declaration: string
}

export interface ExportedValue {
  node: ts.Statement
  name: string
  declaration: string
  signature: string
  returnType: string
  initializer: string
  isCallable: boolean
}

export function parseSource(fileName: string): ParsedSource {
  const text = readFileSync(fileName, 'utf8')
  return {
    fileName,
    text,
    sourceFile: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeContractText(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,:;?(){}|=<>])\s*/g, '$1')
    .trim()
}

export function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export)
}

export function extractExportedTypes(parsed: ParsedSource): ExportedType[] {
  const result: ExportedType[] = []
  for (const statement of parsed.sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      result.push({
        node: statement,
        name: statement.name.text,
        declaration: statement.getText(parsed.sourceFile),
      })
    }
  }
  return result
}

function callableSignature(
  name: string,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  type: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): { signature: string; returnType: string } {
  const parameterText = parameters.map((parameter) => parameter.getText(sourceFile)).join(',')
  const returnType = type?.getText(sourceFile) ?? 'void'
  return {
    signature: normalizeContractText(`${name}(${parameterText}):${returnType}`),
    returnType: normalizeContractText(returnType),
  }
}

export function extractExportedValues(parsed: ParsedSource): ExportedValue[] {
  const result: ExportedValue[] = []
  for (const statement of parsed.sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const initializer = declaration.initializer
        const isCallable = Boolean(initializer && (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)))
        const callable = isCallable
          ? callableSignature(
              declaration.name.text,
              (initializer as ts.FunctionExpression | ts.ArrowFunction).parameters,
              (initializer as ts.FunctionExpression | ts.ArrowFunction).type,
              parsed.sourceFile,
            )
          : { signature: '', returnType: '' }
        result.push({
          node: statement,
          name: declaration.name.text,
          declaration: statement.getText(parsed.sourceFile),
          signature: callable.signature,
          returnType: callable.returnType,
          initializer: initializer?.getText(parsed.sourceFile) ?? '',
          isCallable,
        })
      }
      continue
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(statement)) {
      const callable = callableSignature(statement.name.text, statement.parameters, statement.type, parsed.sourceFile)
      result.push({
        node: statement,
        name: statement.name.text,
        declaration: statement.getText(parsed.sourceFile),
        signature: callable.signature,
        returnType: callable.returnType,
        initializer: statement.body?.getText(parsed.sourceFile) ?? '',
        isCallable: true,
      })
    }
  }
  return result
}

export function extractStringUnion(parsed: ParsedSource, typeName: string): string[] {
  for (const statement of parsed.sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== typeName) continue
    const nodes = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    return nodes.flatMap((node) => {
      if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) return []
      return [node.literal.text]
    })
  }
  throw new Error(`Missing string union ${typeName} in ${parsed.fileName}`)
}

export function findExportedFunction(parsed: ParsedSource, name: string): ts.FunctionDeclaration | undefined {
  return parsed.sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name && hasExportModifier(statement),
  )
}

export function getParameterType(node: ts.FunctionDeclaration, index: number, sourceFile: ts.SourceFile): string {
  const parameter = node.parameters[index]
  return parameter?.type?.getText(sourceFile) ?? 'unknown'
}

export function findMatchingCallArguments(bodyText: string, callee: string): string | undefined {
  const marker = `${callee}(`
  const start = bodyText.indexOf(marker)
  if (start < 0) return undefined
  let depth = 1
  let quote = ''
  let escaped = false
  const valueStart = start + marker.length
  for (let index = valueStart; index < bodyText.length; index += 1) {
    const character = bodyText[index] ?? ''
    if (quote.length > 0) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = ''
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth === 0) return bodyText.slice(valueStart, index)
  }
  return undefined
}
