export interface PreparedNativeArtifact {
  path: string
  reused: boolean
  sha256?: string
  inventorySha256?: string
}

export interface PrepareLocalNativeArtifactOptions {
  root?: string
  platforms?: Array<'android' | 'ios'>
  environment?: NodeJS.ProcessEnv
}

export function sha256File(path: string): string
export function sha256Directory(path: string): string
export function prepareLocalNativeArtifacts(
  options?: PrepareLocalNativeArtifactOptions,
): Partial<Record<'android' | 'ios', PreparedNativeArtifact>>
