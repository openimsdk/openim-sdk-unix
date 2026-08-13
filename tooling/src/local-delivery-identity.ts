import { createHash } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface DeliveryIdentityInput {
  manifestPath: string
  checksumsPath: string
  pluginRoot: string
  baselineJsonPointer: string
}

export interface DeliveryIdentityEvidence {
  manifestSha256: string
  checksumsSha256: string
  baseline: string
  pluginTreeSha256: string
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(path: string): string {
  const digest = createHash('sha256')
  const descriptor = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      digest.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
  return digest.digest('hex')
}

function pathInside(root: string, target: string): boolean {
  const child = relative(resolve(root), resolve(target))
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}

function checksumEntries(path: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (line === '') continue
    const match = /^([0-9a-fA-F]{64})  (.+)$/.exec(line)
    invariant(match != null, `Invalid SHA256SUMS line ${index + 1}`)
    const name = match[2]!
    invariant(!isAbsolute(name) && !name.split(/[\\/]/).includes('..'), `Unsafe SHA256SUMS path: ${name}`)
    invariant(!entries.has(name), `Duplicate SHA256SUMS path: ${name}`)
    entries.set(name, match[1]!.toLowerCase())
  }
  invariant(entries.size > 0, 'SHA256SUMS is empty')
  return entries
}

function verifyChecksums(path: string): Map<string, string> {
  invariant(!lstatSync(path).isSymbolicLink(), 'SHA256SUMS must not be a symbolic link')
  const root = dirname(resolve(path))
  const canonicalRoot = realpathSync(root)
  const entries = checksumEntries(path)
  for (const [name, expected] of entries) {
    const target = resolve(root, name)
    invariant(pathInside(root, target), `SHA256SUMS target escapes delivery root: ${name}`)
    invariant(pathInside(canonicalRoot, realpathSync(target)), `SHA256SUMS target escapes delivery root through a symbolic link: ${name}`)
    invariant(!lstatSync(target).isSymbolicLink(), `SHA256SUMS target must not be a symbolic link: ${name}`)
    invariant(statSync(target).isFile(), `SHA256SUMS target is not a file: ${name}`)
    invariant(sha256(target) === expected, `SHA256 mismatch: ${name}`)
  }
  return entries
}

function decodeJsonPointerToken(token: string): string {
  invariant(!/~(?:[^01]|$)/.test(token), `Invalid JSON Pointer token: ${token}`)
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

function stringAtJsonPointer(document: unknown, pointer: string): string {
  invariant(pointer.startsWith('/'), 'baselineJsonPointer must start with /')
  let value = document
  for (const token of pointer.slice(1).split('/').map(decodeJsonPointerToken)) {
    invariant(value != null && typeof value === 'object' && Object.hasOwn(value, token), `Missing baseline JSON Pointer: ${pointer}`)
    value = (value as Record<string, unknown>)[token]
  }
  invariant(typeof value === 'string' && value.length > 0, `Baseline JSON Pointer must resolve to a non-empty string: ${pointer}`)
  return value
}

function filesBelow(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      invariant(!lstatSync(path).isSymbolicLink(), `Plugin tree entry must not be a symbolic link: ${relative(root, path)}`)
      const stat = statSync(path)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) files.push(path)
      else throw new Error(`Unsupported plugin tree entry: ${relative(root, path)}`)
    }
  }
  visit(root)
  return files
}

function pluginTreeSha256(root: string): string {
  const digest = createHash('sha256')
  for (const path of filesBelow(root)) {
    const name = relative(root, path).split(sep).join('/')
    digest.update(`${name}\0${sha256(path)}\0`)
  }
  return digest.digest('hex')
}

export function verifyDeliveryIdentity(input: DeliveryIdentityInput): DeliveryIdentityEvidence {
  const manifestPath = resolve(input.manifestPath)
  const checksumsPath = resolve(input.checksumsPath)
  const pluginRoot = resolve(input.pluginRoot)
  const deliveryRoot = dirname(checksumsPath)
  invariant(pathInside(deliveryRoot, manifestPath), 'Delivery manifest must be inside the SHA256SUMS root')
  invariant(pathInside(deliveryRoot, pluginRoot), 'Plugin root must be inside the SHA256SUMS root')
  invariant(!lstatSync(manifestPath).isSymbolicLink(), 'Delivery manifest must not be a symbolic link')
  invariant(!lstatSync(pluginRoot).isSymbolicLink(), 'Plugin root must not be a symbolic link')
  invariant(statSync(pluginRoot).isDirectory(), 'Plugin root must be a directory')

  const entries = verifyChecksums(checksumsPath)
  const manifestName = relative(deliveryRoot, manifestPath).split(sep).join('/')
  const manifestSha256 = sha256(manifestPath)
  invariant(entries.get(manifestName) === manifestSha256, 'Delivery manifest is not bound by SHA256SUMS')
  for (const path of filesBelow(pluginRoot)) {
    const name = relative(deliveryRoot, path).split(sep).join('/')
    invariant(entries.get(name) === sha256(path), `Plugin file is not bound by SHA256SUMS: ${name}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  return {
    manifestSha256,
    checksumsSha256: sha256(checksumsPath),
    baseline: stringAtJsonPointer(manifest, input.baselineJsonPointer),
    pluginTreeSha256: pluginTreeSha256(pluginRoot),
  }
}
