#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function moduleName(pluginID) {
  const suffix = pluginID
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')
  invariant(suffix !== '', `Invalid iOS plugin id: ${pluginID}`)
  return `unimodule${suffix}`
}

function defaultBinaryKind(path) {
  const output = execFileSync('file', ['-b', path], { encoding: 'utf8' })
  if (output.includes('current ar archive')) return 'static'
  if (output.includes('dynamically linked shared library')) return 'dynamic'
  return 'other'
}

function defaultBinaryIdentity(path) {
  const output = execFileSync('xcrun', ['dwarfdump', '--uuid', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const identities = output
    .split('\n')
    .map((line) => line.match(/^UUID: ([A-Fa-f0-9-]+) \(([^)]+)\)/))
    .filter(Boolean)
    .map((match) => `${match[2]}:${match[1].toUpperCase()}`)
    .sort()
  invariant(identities.length > 0, `Unable to read Mach-O UUID from ${path}`)
  return identities.join(',')
}

function defaultDefinedSymbols(path) {
  const output = execFileSync('xcrun', ['nm', '-gjU', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return new Set(output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^_[^\s:]+$/.test(line)))
}

function defaultAppBinaries(appPath) {
  const binaries = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      const parent = basename(directory)
      const frameworkBinary = parent.endsWith('.framework')
        && entry.name === parent.slice(0, -'.framework'.length)
      const rootBinary = directory === appPath
        && (entry.name.endsWith('.dylib') || (statSync(path).mode & 0o111) !== 0)
      if (frameworkBinary || rootBinary) binaries.push(path)
    }
  }
  visit(appPath)
  return binaries
}

export function verifyIOSProductPlugins({ plugins, appPath, productsRoot, inspect = {} }) {
  invariant(Array.isArray(plugins) && plugins.length > 0, 'iOS product descriptor contains no plugins')
  invariant(existsSync(appPath), `Assembled iOS app is missing: ${appPath}`)
  const binaryKind = inspect.binaryKind ?? defaultBinaryKind
  const binaryIdentity = inspect.binaryIdentity ?? defaultBinaryIdentity
  const definedSymbols = inspect.definedSymbols ?? defaultDefinedSymbols
  const appBinaries = inspect.appBinaries ?? defaultAppBinaries
  const linkedBinaries = appBinaries(appPath)
  const result = []

  for (const plugin of plugins) {
    invariant(typeof plugin?.id === 'string' && plugin.id !== '', 'iOS product descriptor contains an invalid plugin')
    const module = moduleName(plugin.id)
    const builtBinary = join(productsRoot, `${module}.framework`, module)
    invariant(existsSync(builtBinary), `Generated iOS UTS wrapper is missing for ${plugin.id}: ${builtBinary}`)
    const linkage = binaryKind(builtBinary)
    const embeddedBinary = join(appPath, 'Frameworks', `${module}.framework`, module)

    if (linkage === 'dynamic') {
      invariant(existsSync(embeddedBinary), `Dynamic iOS UTS wrapper for ${plugin.id} is absent from the assembled host`)
      invariant(binaryKind(embeddedBinary) === 'dynamic', `Embedded iOS UTS wrapper for ${plugin.id} is not dynamic`)
      invariant(binaryIdentity(embeddedBinary) === binaryIdentity(builtBinary), `Embedded iOS UTS wrapper for ${plugin.id} differs from the built product`)
    } else if (linkage === 'static') {
      const moduleToken = module.toLowerCase()
      const identifyingSymbols = [...definedSymbols(builtBinary)]
        .filter((symbol) => symbol.toLowerCase().includes(moduleToken))
      invariant(identifyingSymbols.length > 0, `Static iOS UTS wrapper for ${plugin.id} has no module-identifying symbols`)
      const linkedSymbols = new Set()
      for (const binary of linkedBinaries) {
        for (const symbol of definedSymbols(binary)) linkedSymbols.add(symbol)
      }
      invariant(
        identifyingSymbols.some((symbol) => linkedSymbols.has(symbol)),
        `Static iOS UTS wrapper for ${plugin.id} is not linked into the assembled iOS host`,
      )
    } else {
      throw new Error(`Unsupported iOS UTS wrapper binary for ${plugin.id}: ${builtBinary}`)
    }

    result.push({ id: plugin.id, module, linkage })
  }

  return { schemaVersion: 1, appPath: resolve(appPath), plugins: result }
}

const entry = process.argv[1] == null ? null : resolve(process.argv[1])
if (entry === fileURLToPath(import.meta.url)) {
  const [descriptorPath, appPath, productsRoot, receiptPath] = process.argv.slice(2)
  invariant(descriptorPath && appPath && productsRoot, 'Usage: verify-ios-product-plugins.mjs <descriptor> <app> <products-root> [receipt]')
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  const receipt = verifyIOSProductPlugins({ plugins: descriptor.plugins, appPath, productsRoot })
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`
  if (receiptPath) writeFileSync(receiptPath, rendered, { mode: 0o600 })
  else process.stdout.write(rendered)
}
