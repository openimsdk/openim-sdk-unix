#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const argumentsList = process.argv.slice(2)
const markerIndex = argumentsList.indexOf('--marker')
if (markerIndex < 0 || !argumentsList[markerIndex + 1]) {
  throw new Error('Usage: verify-runtime-ready.mjs --marker <marker> [log ...]')
}
const marker = argumentsList[markerIndex + 1]
if (!/^OPENIM_LOCAL_RUNTIME_READY:v1:[a-z0-9][a-z0-9-]*:uniapp(?:-vue[23]|x)$/.test(marker)) {
  throw new Error('Invalid product-ready marker')
}
const paths = argumentsList.filter((_value, index) => index !== markerIndex && index !== markerIndex + 1)
const source = paths.length === 0
  ? readFileSync(0, 'utf8')
  : paths.map((path) => readFileSync(path, 'utf8')).join('\n')
if (!source.includes(marker)) throw new Error('runtime product-ready marker is missing; splash, HBuilder Hello, or loading UI is not product readiness')
process.stdout.write('runtime product-ready marker verified\n')
