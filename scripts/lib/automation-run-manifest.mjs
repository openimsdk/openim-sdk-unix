import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative } from 'node:path'

function writeJSONAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${dirname(path)}/.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function writeAutomationRunManifestSet({ latestPath, perRunPath, manifest }) {
  if (typeof latestPath !== 'string'
    || typeof perRunPath !== 'string'
    || !isAbsolute(latestPath)
    || !isAbsolute(perRunPath)
    || latestPath === perRunPath
    || manifest == null
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || typeof manifest.runId !== 'string'
    || manifest.runId.length === 0
    || (manifest.platform !== 'android' && manifest.platform !== 'ios' && manifest.platform !== 'harmony')) {
    throw new Error('run manifest set is invalid')
  }
  if (existsSync(perRunPath)) {
    let existing
    try {
      existing = JSON.parse(readFileSync(perRunPath, 'utf8'))
    } catch {
      throw new Error('existing run manifest is invalid')
    }
    if (existing?.result?.finalizationComplete === true) {
      throw new Error('immutable finalized run manifest cannot be rewritten')
    }
    if (existing?.runId !== manifest.runId || existing?.platform !== manifest.platform) {
      throw new Error('run manifest identity cannot change during finalization')
    }
  }
  writeJSONAtomic(perRunPath, manifest)
  writeJSONAtomic(latestPath, {
    schemaVersion: 1,
    navigationOnly: true,
    platform: manifest.platform,
    runId: manifest.runId,
    path: relative(dirname(latestPath), perRunPath),
    updatedAt: new Date().toISOString(),
  })
}
