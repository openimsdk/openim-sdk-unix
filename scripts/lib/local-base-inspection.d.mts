export type AndroidBaseInspection = {
  hasWebSocket: boolean
  hasVaporRuntime: boolean
  hasClassicRuntime: boolean
}

export function inspectAndroidBaseEntries(input: { dexPayloads: Array<Buffer | string> }): AndroidBaseInspection
export function inspectAndroidBase(basePath: string): AndroidBaseInspection
export function iosBaseHasWebSocket(basePath: string): boolean
export function automationTarget(platform: string, iosTarget?: string): string
