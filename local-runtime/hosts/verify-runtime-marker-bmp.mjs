#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [path, product, surface] = process.argv.slice(2)
if (!path || !product || !surface) {
  throw new Error('Usage: verify-runtime-marker-bmp.mjs <image.bmp> <product> <surface>')
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(product)) throw new Error('Invalid local runtime product marker')
if (!['uniapp-vue2', 'uniapp-vue3', 'uniappx'].includes(surface)) throw new Error('Invalid local runtime surface marker')

const marker = `OPENIM_LOCAL_RUNTIME_READY:v1:${product}:${surface}`
const digest = createHash('sha256').update(marker).digest()
const [expectedRed, expectedGreen, expectedBlue] = [digest[0], digest[1], digest[2]].map((value) => 32 + (value % 192))
const bytes = readFileSync(path)
if (bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('Expected a BMP screenshot')
const offset = bytes.readUInt32LE(10)
const width = bytes.readInt32LE(18)
const signedHeight = bytes.readInt32LE(22)
const bitsPerPixel = bytes.readUInt16LE(28)
if (width <= 0 || signedHeight === 0 || bitsPerPixel !== 32) throw new Error('Expected a 32-bit BMP screenshot')
const height = Math.abs(signedHeight)
const topDown = signedHeight < 0
const tolerance = 6
let matches = 0
for (let y = 0; y < height; y += 1) {
  const storedY = topDown ? y : height - 1 - y
  for (let x = 0; x < width; x += 1) {
    const pixel = offset + (storedY * width + x) * 4
    const blue = bytes[pixel]
    const green = bytes[pixel + 1]
    const red = bytes[pixel + 2]
    if (red == null || green == null || blue == null) throw new Error('Truncated BMP screenshot')
    if (Math.abs(red - expectedRed) <= tolerance &&
        Math.abs(green - expectedGreen) <= tolerance &&
        Math.abs(blue - expectedBlue) <= tolerance) {
      matches += 1
    }
  }
}
if (matches < 16) throw new Error('rendered product marker is missing')
process.stdout.write(`rendered product marker verified (${matches} pixels)\n`)
