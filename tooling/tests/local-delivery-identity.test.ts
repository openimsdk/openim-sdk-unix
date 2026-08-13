import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyDeliveryIdentity } from '../src/local-delivery-identity.js'

function write(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

test('verified delivery identity supplies the bundle fields missing from source-only evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-delivery-identity-'))
  const manifest = join(root, 'delivery-manifest.json')
  const checksums = join(root, 'SHA256SUMS')
  const pluginRoot = join(root, 'uni_modules/example-plugin')

  write(manifest, '{"release":{"baseline":"abc123"}}\n')
  write(join(pluginRoot, 'package.txt'), 'plugin bytes\n')
  write(checksums, [
    'ad91976e2bb88ca676e4dffe96ec44f80b0170625cdc5557be5144c8d8dc5cfe  delivery-manifest.json',
    '31839cf498c434983f244cf619d97f3c0c9f2a934b012d95cf3c07507c34eb16  uni_modules/example-plugin/package.txt',
    '',
  ].join('\n'))

  const identity = verifyDeliveryIdentity({
    manifestPath: manifest,
    checksumsPath: checksums,
    pluginRoot,
    baselineJsonPointer: '/release/baseline',
  })

  assert.deepEqual(Object.keys(identity).sort(), [
    'baseline',
    'checksumsSha256',
    'manifestSha256',
    'pluginTreeSha256',
  ])
  assert.equal(identity.baseline, 'abc123')
  assert.equal(identity.manifestSha256, 'ad91976e2bb88ca676e4dffe96ec44f80b0170625cdc5557be5144c8d8dc5cfe')
  assert.match(identity.checksumsSha256, /^[0-9a-f]{64}$/)
  assert.match(identity.pluginTreeSha256, /^[0-9a-f]{64}$/)
})

test('delivery preflight rejects plugin bytes changed after SHA256SUMS was produced', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-delivery-tamper-'))
  const manifest = join(root, 'delivery-manifest.json')
  const checksums = join(root, 'SHA256SUMS')
  const pluginRoot = join(root, 'uni_modules/example-plugin')
  const pluginFile = join(pluginRoot, 'package.txt')

  write(manifest, '{"baseline":"abc123"}\n')
  write(pluginFile, 'plugin bytes\n')
  write(checksums, [
    '5cb5e5eb80f9a1e7436818ca7ed1a11bf7258809454996f3ee7d22a5f5a0ee39  delivery-manifest.json',
    '31839cf498c434983f244cf619d97f3c0c9f2a934b012d95cf3c07507c34eb16  uni_modules/example-plugin/package.txt',
    '',
  ].join('\n'))
  writeFileSync(pluginFile, 'changed plugin bytes\n')

  assert.throws(() => verifyDeliveryIdentity({
    manifestPath: manifest,
    checksumsPath: checksums,
    pluginRoot,
    baselineJsonPointer: '/baseline',
  }), /SHA256 mismatch: uni_modules\/example-plugin\/package\.txt/)
})

test('delivery preflight never follows plugin symlinks outside the bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-delivery-link-'))
  const external = join(mkdtempSync(join(tmpdir(), 'openim-delivery-external-')), 'external.txt')
  const manifest = join(root, 'delivery-manifest.json')
  const checksums = join(root, 'SHA256SUMS')
  const pluginRoot = join(root, 'plugin')

  write(external, 'external bytes\n')
  write(manifest, '{"release":{"baseline":"abc123"}}\n')
  mkdirSync(pluginRoot, { recursive: true })
  symlinkSync(external, join(pluginRoot, 'linked.txt'))
  write(checksums, [
    'ad91976e2bb88ca676e4dffe96ec44f80b0170625cdc5557be5144c8d8dc5cfe  delivery-manifest.json',
    'cdb6e236bd8a1bf5abfd5949dd37b71c921495c324c4c66d20eba53c338ddeb6  plugin/linked.txt',
    '',
  ].join('\n'))

  assert.throws(() => verifyDeliveryIdentity({
    manifestPath: manifest,
    checksumsPath: checksums,
    pluginRoot,
    baselineJsonPointer: '/release/baseline',
  }), /symbolic link/)
})

test('delivery preflight rejects checksum paths whose parent symlink escapes the bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-delivery-parent-link-'))
  const externalRoot = mkdtempSync(join(tmpdir(), 'openim-delivery-parent-external-'))
  const manifest = join(root, 'delivery-manifest.json')
  const checksums = join(root, 'SHA256SUMS')
  const pluginRoot = join(root, 'plugin')

  write(join(externalRoot, 'external.txt'), 'external bytes\n')
  write(manifest, '{"release":{"baseline":"abc123"}}\n')
  write(join(pluginRoot, 'package.txt'), 'plugin bytes\n')
  symlinkSync(externalRoot, join(root, 'linked-directory'))
  write(checksums, [
    'ad91976e2bb88ca676e4dffe96ec44f80b0170625cdc5557be5144c8d8dc5cfe  delivery-manifest.json',
    '31839cf498c434983f244cf619d97f3c0c9f2a934b012d95cf3c07507c34eb16  plugin/package.txt',
    'cdb6e236bd8a1bf5abfd5949dd37b71c921495c324c4c66d20eba53c338ddeb6  linked-directory/external.txt',
    '',
  ].join('\n'))

  assert.throws(() => verifyDeliveryIdentity({
    manifestPath: manifest,
    checksumsPath: checksums,
    pluginRoot,
    baselineJsonPointer: '/release/baseline',
  }), /escapes delivery root/)
})
