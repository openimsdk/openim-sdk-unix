export interface IOSProductPlugin {
  id: string
}

export interface IOSProductPluginInspection {
  binaryKind?(path: string): 'dynamic' | 'static' | 'other'
  binaryIdentity?(path: string): string
  appBinaries?(appPath: string): string[]
  definedSymbols?(path: string): Set<string>
}

export interface IOSProductPluginReceipt {
  schemaVersion: 1
  appPath: string
  plugins: Array<{
    id: string
    module: string
    linkage: 'dynamic' | 'static'
  }>
}

export function verifyIOSProductPlugins(options: {
  plugins: IOSProductPlugin[]
  appPath: string
  productsRoot: string
  inspect?: IOSProductPluginInspection
}): IOSProductPluginReceipt
