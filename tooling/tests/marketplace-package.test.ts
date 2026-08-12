import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function buildPackage(outputDir: string) {
  execFileSync(process.execPath, ['scripts/build-public-marketplace-package.mjs', '--allow-dirty', '--output-dir', outputDir], {
    cwd: root,
  })
  const manifestPath = join(outputDir, 'unix-openim-sdk-0.2.0-marketplace-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return {
    archivePath: join(outputDir, manifest.archive.fileName),
    sumsPath: join(outputDir, 'SHA256SUMS'),
    manifest,
  }
}

test('Public marketplace package is deterministic and contains only the explicit plugin allowlist', () => {
  const firstRoot = mkdtempSync(join(tmpdir(), 'openim-marketplace-first-'))
  const secondRoot = mkdtempSync(join(tmpdir(), 'openim-marketplace-second-'))
  try {
    const first = buildPackage(firstRoot)
    const second = buildPackage(secondRoot)
    assert.equal(first.manifest.version, '0.2.0')
    assert.equal(first.manifest.archive.sha256, second.manifest.archive.sha256)
    assert.deepEqual(first.manifest.files, second.manifest.files)

    const entries = execFileSync('unzip', ['-Z1', first.archivePath], { encoding: 'utf8' }).trim().split('\n')
    assert.ok(entries.includes('uni_modules/unix-openim-sdk/package.json'))
    assert.ok(entries.includes('uni_modules/unix-openim-sdk/LICENSE'))
    assert.ok(entries.includes('uni_modules/unix-openim-sdk/MARKET_USAGE.md'))
    assert.ok(entries.includes('uni_modules/unix-openim-sdk/utssdk/interface.uts'))
    assert.ok(entries.includes('uni_modules/unix-openim-sdk/utssdk/unierror.uts'))
    assert.equal(entries.some((path) => /app-harmony|\/libs\/|\/Frameworks\/|\.aar$|\.har$|\.xcframework/i.test(path)), false)
    assert.equal(entries.includes('uni_modules/unix-openim-sdk/.npmignore'), false)

    const sums = readFileSync(first.sumsPath, 'utf8')
    assert.match(sums, new RegExp(`^${first.manifest.archive.sha256}  unix-openim-sdk-0\\.2\\.0-marketplace\\.zip`, 'm'))
  } finally {
    rmSync(firstRoot, { recursive: true, force: true })
    rmSync(secondRoot, { recursive: true, force: true })
  }
})

test('Public marketplace plugin ships the repository license verbatim', () => {
  assert.equal(
    readFileSync(join(root, 'uni_modules/unix-openim-sdk/LICENSE'), 'utf8'),
    readFileSync(join(root, 'LICENSE'), 'utf8'),
  )
})
