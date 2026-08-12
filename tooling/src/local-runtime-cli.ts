#!/usr/bin/env node

import { resolve } from 'node:path'

import { cleanupLocalRun, listLocalRuns, runLocalMatrix, runLocalRuntime, type LocalCommand, type LocalMatrixTier, type LocalPlatform, type LocalSurface } from './local-runtime-matrix.js'

function parse(argv: string[]): { command: string; values: Map<string, string> } {
  const command = argv[0] ?? ''
  const values = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || !name.startsWith('--') || value == null) throw new Error(`Invalid argument near ${name ?? '<end>'}`)
    values.set(name.slice(2), value)
  }
  return { command, values }
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)
  if (value == null || value === '') throw new Error(`Missing --${name}`)
  return value
}

function defaultDescriptor(product: string): string {
  return resolve(`local-runtime/products/${product}.json`)
}

function main(): void {
  const { command, values } = parse(process.argv.slice(2))
  const workspaceRoot = values.get('workspace-root') ?? process.env.OPENIM_LOCAL_WORKSPACE_ROOT ?? '/Volumes/workspace/work/openim-uni-runtime-workspaces'
  if (command === 'list-runs') {
    process.stdout.write(`${JSON.stringify(listLocalRuns(workspaceRoot), null, 2)}\n`)
    return
  }
  if (command === 'cleanup') {
    cleanupLocalRun(workspaceRoot, required(values, 'run-id'))
    return
  }
  if (command === 'matrix') {
    const product = required(values, 'product')
    const tier = required(values, 'tier') as LocalMatrixTier
    if (!['pr', 'nightly', 'rc'].includes(tier)) throw new Error(`Unsupported matrix tier: ${tier}`)
    const results = runLocalMatrix({
      descriptorPath: values.get('descriptor') ?? process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR ?? defaultDescriptor(product),
      tier,
      workspaceRoot,
      ...(values.get('profile') ?? process.env.OPENIM_UNI_TOOLCHAIN_PROFILE) != null ? { profilePath: values.get('profile') ?? process.env.OPENIM_UNI_TOOLCHAIN_PROFILE! } : {},
      ...(values.get('device') != null ? { deviceID: values.get('device')! } : {}),
      ...(values.get('run-prefix') != null ? { runPrefix: values.get('run-prefix')! } : {}),
    })
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
    if (results.some((result) => result.state === 'BLOCKED')) process.exitCode = 1
    return
  }
  if (!['doctor', 'prepare', 'build', 'run', 'test'].includes(command)) throw new Error('Usage: local <doctor|prepare|build|run|test|matrix|list-runs|cleanup> [options]')
  const product = required(values, 'product')
  const result = runLocalRuntime({
    command: command as LocalCommand,
    descriptorPath: values.get('descriptor') ?? process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR ?? defaultDescriptor(product),
    surface: required(values, 'surface') as LocalSurface,
    platform: required(values, 'platform') as LocalPlatform,
    suite: values.get('suite') ?? 'smoke',
    workspaceRoot,
    ...(values.get('device') != null ? { deviceID: values.get('device')! } : {}),
    ...((values.get('profile') ?? process.env.OPENIM_UNI_TOOLCHAIN_PROFILE) != null ? { profilePath: values.get('profile') ?? process.env.OPENIM_UNI_TOOLCHAIN_PROFILE! } : {}),
    ...(values.get('run-id') != null ? { runID: values.get('run-id')! } : {}),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
