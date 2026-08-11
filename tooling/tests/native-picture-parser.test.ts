import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const common = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/native-call-common.uts'), 'utf8')

test('picture element parsing preserves partial native createImageMessage results', () => {
  const parser = common.match(/function parseNativePictureElem[\s\S]*?\n}\n\nfunction parseNativeSoundElem/)?.[0] ?? ''

  assert.match(parser, /const sourcePath = helpers\.readStringParam\(value, 'sourcePath'\)/)
  assert.match(parser, /sourcePicture != null \|\| bigPicture != null \|\| snapshotPicture != null \|\| sourcePath\.length > 0/)
  assert.match(parser, /return \{ sourcePath: sourcePath, sourcePicture: sourcePicture, bigPicture: bigPicture, snapshotPicture: snapshotPicture \}/)
  assert.doesNotMatch(parser, /sourcePicture != null && bigPicture != null && snapshotPicture != null/)
})
