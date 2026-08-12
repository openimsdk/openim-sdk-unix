export interface NativeAndroidPluginDescriptor {
  id: string
  dependencies?: string[]
  androidNamespace?: string
  androidGradleTemplate?: string
}

export interface NativeAndroidProductDescriptor {
  plugins: NativeAndroidPluginDescriptor[]
  androidHost?: {
    minSdk?: number
    abiFilters?: string[]
    utsRegisterComponents?: Array<Record<string, string>>
    utsEasyCom?: Array<Record<string, string>>
  }
}

export function configureNativeAndroid(options: {
  manifest: { appid?: string }
  root: string
  descriptor?: NativeAndroidProductDescriptor | null
  environment?: Record<string, string | undefined>
}): { appID: string; androidPackage: string }
