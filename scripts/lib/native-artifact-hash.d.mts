export type NativeArtifactKind = 'aar' | 'xcframework-inventory'

export function sha256NativeFile(path: string): string
export function sha256NativeDirectory(path: string): string
export function hashNativeArtifact(path: string, kind: NativeArtifactKind): string
