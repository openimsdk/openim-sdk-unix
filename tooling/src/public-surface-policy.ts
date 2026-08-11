import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { extractExportedValues, parseSource } from './source.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path]
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => sourceFiles(join(path, entry.name)))
}

/**
 * Guards the executable/current documentation surface. Historical migration
 * records and the ID ledger are deliberately outside this scan.
 */
export function verifyNoLegacyEventControl(root: string): void {
  const legacyName = ['off', 'Event'].join('')
  const paths = [
    'contracts/base/contract.json',
    'contracts/base/response-schemas.json',
    'contracts/base/surface.snapshot.json',
    'contracts/base/test-disposition.json',
    'sdk-src',
    'tooling/src',
    'uni_modules/unix-openim-sdk/README.md',
    'uni_modules/unix-openim-sdk/utssdk',
    'pages',
  ].flatMap((path) => sourceFiles(join(root, path)))

  const offenders = paths
    .filter((path) => readFileSync(path, 'utf8').includes(legacyName))
    .map((path) => relative(root, path))
  assert(offenders.length === 0, `Legacy event-control name remains in active surface: ${offenders.join(', ')}`)
}

/**
 * A fast consumer-facing export probe. The real UTS consumer compilation is
 * performed by the platform compile gate; this catches generator drift before
 * invoking HBuilderX.
 */
export function verifyEventControlConsumerSurface(root: string): void {
  for (const platform of ['android', 'ios'] as const) {
    const path = join(root, `uni_modules/unix-openim-sdk/utssdk/app-${platform}/index.uts`)
    const exports = new Map(extractExportedValues(parseSource(path)).map((value) => [value.name, value]))
    const off = exports.get('off')
    const offAll = exports.get('offAll')
    assert(off?.signature === 'off(subscription:OpenIMSDKEventSubscription):void', `${platform} consumer export off drifted`)
    assert(offAll?.signature === 'offAll(eventName:OpenIMSDKEventName):void', `${platform} consumer export offAll drifted`)
    assert(!exports.has(['off', 'Event'].join('')), `${platform} still exports the removed event-control name`)
  }
}
