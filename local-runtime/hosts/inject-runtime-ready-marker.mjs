#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projectArgument, product, surface] = process.argv.slice(2)
if (!projectArgument || !product || !surface) {
  throw new Error('Usage: inject-runtime-ready-marker.mjs <staged-project> <product> <surface>')
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(product)) throw new Error('Invalid local runtime product marker')
if (!['uniapp-vue2', 'uniapp-vue3', 'uniappx'].includes(surface)) throw new Error('Invalid local runtime surface marker')

const project = resolve(projectArgument)
const path = join(project, surface === 'uniappx' ? 'main.uts' : 'main.js')
const marker = `OPENIM_LOCAL_RUNTIME_READY:v1:${product}:${surface}`
const begin = '// OPENIM_LOCAL_RUNTIME_MARKER_BEGIN'
const end = '// OPENIM_LOCAL_RUNTIME_MARKER_END'
const blockPattern = /^\/\/ OPENIM_LOCAL_RUNTIME_MARKER_BEGIN\r?\nconsole\.log\([^\r\n]*\)\r?\n\/\/ OPENIM_LOCAL_RUNTIME_MARKER_END\r?\n?/gm
const original = readFileSync(path, 'utf8')
const source = original.replace(blockPattern, '').replace(/\s*$/, '\n')
const injected = `${source}${begin}\nconsole.log(${JSON.stringify(marker)})\n${end}\n`
writeFileSync(path, injected)
process.stdout.write(`staged runtime marker injected for ${product}/${surface}\n`)
