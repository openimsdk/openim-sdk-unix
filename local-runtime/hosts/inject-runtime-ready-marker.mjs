#!/usr/bin/env node

import { createHash } from 'node:crypto'
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

const pagePath = join(project, 'pages/index', surface === 'uniappx' ? 'index.uvue' : 'index.vue')
const pageMarkerPattern = /\s*<view\s+class="openim-local-runtime-ready-marker"[^>]*><\/view>\s*/g
let page = readFileSync(pagePath, 'utf8').replace(pageMarkerPattern, '\n')
const rootContainer = /(<template>(?:\s|<!--[\s\S]*?-->)*?<(?:view|scroll-view)\b[^>]*>)/
if (!rootContainer.test(page)) throw new Error('Runtime index page must have a supported root container')
const digest = createHash('sha256').update(marker).digest()
const [red, green, blue] = [digest[0], digest[1], digest[2]].map((value) => 32 + (value % 192))
const renderedMarker = `<view class="openim-local-runtime-ready-marker" style="position: fixed; right: 1px; bottom: 1px; width: 8px; height: 8px; background-color: rgb(${red}, ${green}, ${blue}); z-index: 2147483647;"></view>`
page = page.replace(rootContainer, `$1\n    ${renderedMarker}`)
writeFileSync(pagePath, page)
process.stdout.write(`staged runtime marker injected for ${product}/${surface}\n`)
