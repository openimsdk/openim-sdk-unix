#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) throw new Error('Usage: verify-nonblank-bmp.mjs <image.bmp>')
const bytes = readFileSync(path)
if (bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('Expected a BMP screenshot')
const offset = bytes.readUInt32LE(10)
const width = bytes.readInt32LE(18)
const signedHeight = bytes.readInt32LE(22)
const bitsPerPixel = bytes.readUInt16LE(28)
if (width <= 0 || signedHeight === 0 || bitsPerPixel !== 32) throw new Error('Expected a 32-bit BMP screenshot')
const height = Math.abs(signedHeight)
const topDown = signedHeight < 0
const contentStart = Math.floor(height * 0.15)
const contentEnd = Math.ceil(height * 0.90)
const contentLeft = Math.floor(width * 0.10)
const contentRight = Math.ceil(width * 0.90)
let nonBlank = 0
let sampled = 0
for (let y = contentStart; y < contentEnd; y += 2) {
  const storedY = topDown ? y : height - 1 - y
  for (let x = contentLeft; x < contentRight; x += 2) {
    const pixel = offset + (storedY * width + x) * 4
    const blue = bytes[pixel]
    const green = bytes[pixel + 1]
    const red = bytes[pixel + 2]
    if (red == null || green == null || blue == null) throw new Error('Truncated BMP screenshot')
    sampled += 1
    if (red < 242 || green < 242 || blue < 242) nonBlank += 1
  }
}
const ratio = nonBlank / sampled
if (ratio < 0.01) throw new Error(`iOS runtime rendered a blank page (content ratio ${ratio.toFixed(5)})`)
process.stdout.write(`iOS runtime content ratio ${ratio.toFixed(5)}\n`)
