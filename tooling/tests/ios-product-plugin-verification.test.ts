import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyIOSProductPlugins } from '../../local-runtime/hosts/verify-ios-product-plugins.mjs'

function write(path: string, content = 'fixture'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

test('iOS product verification accepts exact dynamic and statically linked UTS plugin wrappers', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-ios-product-plugins-'))
  try {
    const app = join(root, 'Product.app')
    const products = join(root, 'Products')
    const dynamic = join(products, 'unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk')
    const embeddedDynamic = join(app, 'Frameworks/unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk')
    const staticWrapper = join(products, 'unimoduleOpenimAvRuntime.framework/unimoduleOpenimAvRuntime')
    const appBinary = join(app, 'Product.debug.dylib')
    write(dynamic, 'dynamic wrapper')
    write(embeddedDynamic, 'signed dynamic wrapper')
    write(staticWrapper, 'static wrapper')
    write(appBinary, 'linked app image')

    const result = verifyIOSProductPlugins({
      plugins: [{ id: 'unix-openim-sdk' }, { id: 'openim-av-runtime' }],
      appPath: app,
      productsRoot: products,
      inspect: {
        binaryKind: (path: string) => path === staticWrapper ? 'static' : 'dynamic',
        binaryIdentity: (path: string) => path === dynamic || path === embeddedDynamic ? 'UUID-DYNAMIC-X86_64' : path,
        appBinaries: () => [appBinary],
        definedSymbols: (path: string) => path === staticWrapper || path === appBinary
          ? new Set(['_$s24unimoduleOpenimAvRuntime17registrationSymbol'])
          : new Set(),
      },
    })

    assert.deepEqual(result.plugins, [
      { id: 'unix-openim-sdk', module: 'unimoduleUnixOpenimSdk', linkage: 'dynamic' },
      { id: 'openim-av-runtime', module: 'unimoduleOpenimAvRuntime', linkage: 'static' },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('iOS product verification rejects a descriptor plugin that is not linked into the host', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-ios-missing-plugin-'))
  try {
    const app = join(root, 'Product.app')
    const products = join(root, 'Products')
    const staticWrapper = join(products, 'unimoduleOpenimAvRuntime.framework/unimoduleOpenimAvRuntime')
    const appBinary = join(app, 'Product.debug.dylib')
    write(staticWrapper, 'static wrapper')
    write(appBinary, 'host without plugin')

    assert.throws(() => verifyIOSProductPlugins({
      plugins: [{ id: 'openim-av-runtime' }],
      appPath: app,
      productsRoot: products,
      inspect: {
        binaryKind: () => 'static',
        appBinaries: () => [appBinary],
        definedSymbols: (path: string) => path === staticWrapper
          ? new Set(['_$s24unimoduleOpenimAvRuntime17registrationSymbol'])
          : new Set(['_unrelated']),
      },
    }), /openim-av-runtime.*not linked into the assembled iOS host/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
