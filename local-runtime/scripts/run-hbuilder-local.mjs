#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function run(cli, args, stdio) {
  const result = spawnSync(cli, args, {
    cwd: projectRoot,
    env: process.env,
    stdio,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`HBuilderX ${args[0]} failed with exit code ${String(result.status)}`)
  }
}

const separator = process.argv.indexOf('--')
if (separator !== 3 || process.argv.length <= separator + 1) {
  throw new Error('Usage: run-hbuilder-local.mjs <hbuilder-cli> -- <command> [args...]')
}
const cli = process.argv[2]
// HBuilderX caches manifest compiler settings for an imported project. Close it
// first so the source-render manifest written by the local profile is re-read.
spawnSync(cli, ['project', 'close', '--path', projectRoot], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'ignore',
})
run(cli, ['project', 'open', '--path', projectRoot], 'ignore')
const commandArgs = process.argv.slice(separator + 1)
run(cli, commandArgs, 'inherit')

if (commandArgs[0] === 'launch' && commandArgs[1] === 'app-ios') {
  const readOption = (name, fallback) => {
    const index = commandArgs.indexOf(name)
    return index >= 0 && index + 1 < commandArgs.length ? commandArgs[index + 1] : fallback
  }
  const logArgs = [
    'logcat',
    'app-ios',
    '--project',
    projectRoot,
    '--iosTarget',
    readOption('--iosTarget', 'simulator'),
    '--mode',
    'lastBuild',
  ]
  const deviceID = readOption('--deviceId', '')
  if (deviceID.length > 0) logArgs.push('--deviceId', deviceID)
  run(cli, logArgs, 'inherit')
}
