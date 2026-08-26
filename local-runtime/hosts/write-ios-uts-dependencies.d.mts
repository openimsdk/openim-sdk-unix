export interface IOSUTSDependencyOptions {
  appPath: string
  manifestPath: string
  extAPIBinary: string
}

export interface IOSUTSDependencyReceipt {
  duts: string[]
}

export function writeIOSUTSDependencies(options: IOSUTSDependencyOptions): IOSUTSDependencyReceipt
