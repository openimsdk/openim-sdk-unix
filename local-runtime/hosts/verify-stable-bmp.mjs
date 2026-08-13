#!/usr/bin/env node

import { readFileSync } from 'node:fs'

function readBMP(path) {
  const bytes = readFileSync(path)
  if (bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('Expected BMP screenshots')
  const offset = bytes.readUInt32LE(10)
  const width = bytes.readInt32LE(18)
  const signedHeight = bytes.readInt32LE(22)
  const bitsPerPixel = bytes.readUInt16LE(28)
  if (width <= 0 || signedHeight === 0 || bitsPerPixel !== 32) throw new Error('Expected matching 32-bit BMP screenshots')
  return { bytes, offset, width, height: Math.abs(signedHeight), topDown: signedHeight < 0 }
}

const [previousPath, currentPath] = process.argv.slice(2)
if (!previousPath || !currentPath) throw new Error('Usage: verify-stable-bmp.mjs <previous.bmp> <current.bmp>')
const previous = readBMP(previousPath)
const current = readBMP(currentPath)
if (previous.width !== current.width || previous.height !== current.height) throw new Error('runtime frames are not stable (dimensions changed)')

const contentStart = Math.floor(current.height * 0.15)
const contentEnd = Math.ceil(current.height * 0.90)
const contentLeft = Math.floor(current.width * 0.10)
const contentRight = Math.ceil(current.width * 0.90)
let changed = 0
let sampled = 0
for (let y = contentStart; y < contentEnd; y += 2) {
  const previousY = previous.topDown ? y : previous.height - 1 - y
  const currentY = current.topDown ? y : current.height - 1 - y
  for (let x = contentLeft; x < contentRight; x += 2) {
    const previousPixel = previous.offset + (previousY * previous.width + x) * 4
    const currentPixel = current.offset + (currentY * current.width + x) * 4
    let maximumDelta = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const before = previous.bytes[previousPixel + channel]
      const after = current.bytes[currentPixel + channel]
      if (before == null || after == null) throw new Error('Truncated BMP screenshot')
      maximumDelta = Math.max(maximumDelta, Math.abs(before - after))
    }
    sampled += 1
    if (maximumDelta > 18) changed += 1
  }
}
const ratio = changed / sampled
if (ratio > 0.06) throw new Error(`runtime frames are not stable (changed ratio ${ratio.toFixed(5)})`)
process.stdout.write(`runtime stable frame verified (changed ratio ${ratio.toFixed(5)})\n`)
