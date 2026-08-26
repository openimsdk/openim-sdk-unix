import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function sha256NativeFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256NativeDirectory(path) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const entry = join(directory, name);
      if (statSync(entry).isDirectory()) {
        walk(entry);
      } else {
        files.push(entry);
      }
    }
  };
  walk(path);

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(path, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function hashNativeArtifact(path, kind) {
  if (kind === 'aar') {
    return sha256NativeFile(path);
  }
  if (kind === 'xcframework-inventory') {
    return sha256NativeDirectory(path);
  }
  throw new Error(`Unsupported native artifact kind: ${String(kind)}`);
}
