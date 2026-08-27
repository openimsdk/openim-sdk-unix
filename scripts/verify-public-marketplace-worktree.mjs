#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRelativeRoot = 'uni_modules/unix-openim-sdk'
const forbiddenDirectoryPattern = /(?:^|\/)(?:libs|Frameworks|Resources|_CodeSignature)(?:\/|$)/

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

function listTree(root, path, files, directories, symlinks) {
  for (const name of readdirSync(path).sort()) {
    const absolute = join(path, name)
    const repositoryPath = relative(root, absolute).replaceAll('\\', '/')
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      symlinks.push(repositoryPath)
    } else if (stat.isDirectory()) {
      directories.push(repositoryPath)
      listTree(root, absolute, files, directories, symlinks)
    } else {
      files.push({ path: repositoryPath, size: stat.size })
    }
  }
}

export function verifyPublicMarketplaceWorktree(root = defaultRoot) {
  const resolvedRoot = resolve(root)
  const pluginRoot = join(resolvedRoot, pluginRelativeRoot)
  const dirty = git(resolvedRoot, ['status', '--porcelain']).trim()
  const tracked = new Set(
    git(resolvedRoot, ['ls-files', '-z', '--', pluginRelativeRoot])
      .split('\0')
      .filter((path) => path !== ''),
  )
  const files = []
  const directories = []
  const symlinks = []
  listTree(resolvedRoot, pluginRoot, files, directories, symlinks)

  const actual = new Set(files.map((file) => file.path))
  const missing = [...tracked].filter((path) => !actual.has(path)).sort()
  const extra = files.map((file) => file.path).filter((path) => !tracked.has(path)).sort()
  const forbiddenDirectories = directories.filter((path) => forbiddenDirectoryPattern.test(path)).sort()
  const findings = []
  if (dirty !== '') findings.push('repository is dirty')
  if (missing.length > 0) findings.push(`tracked plugin files are missing: ${missing.join(', ')}`)
  if (extra.length > 0) findings.push(`untracked or ignored plugin files are present: ${extra.join(', ')}`)
  if (symlinks.length > 0) findings.push(`plugin symlinks are forbidden: ${symlinks.join(', ')}`)
  if (forbiddenDirectories.length > 0) findings.push(`forbidden plugin directories are present: ${forbiddenDirectories.join(', ')}`)
  if (findings.length > 0) throw new Error(`Public marketplace worktree preflight failed:\n${findings.join('\n')}`)

  return {
    pluginRelativeRoot,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  }
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyPublicMarketplaceWorktree(process.argv[2] ?? defaultRoot)
  process.stdout.write(`Public marketplace worktree verified: ${result.fileCount} tracked files, ${result.totalBytes} bytes.\n`)
}
