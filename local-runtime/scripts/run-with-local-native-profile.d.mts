export function localNativeConfig(platform: string, releaseConfig: Record<string, unknown>): Record<string, unknown>
export function localSourceManifest(releaseManifest: Record<string, unknown>): Record<string, unknown>

export function runWithLocalNativeProfile(input: {
  root: string
  platform: string
  command: string
  args: string[]
  environment?: NodeJS.ProcessEnv
}): void
