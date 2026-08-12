export type AutomationPlatform = {
  id: string
  executablePath: string
  appid: string
  package: string
}

export type AutomationEnvironmentState = {
  schema: number
  platforms: Record<string, AutomationPlatform>
}

export function buildAutomationEnvironment(input: {
  previous?: Partial<AutomationEnvironmentState>
  platform: string
  basePath: string
  deviceID: string
  appID: string
  packageName: string
}): AutomationEnvironmentState

export function renderAutomationEnvironment(state: AutomationEnvironmentState): string
