#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBSOCKET_MODULE = 'uni-websocket';
const WEBSOCKET_BINARY_MARKER = Buffer.from('DCloudUTSExtAPI/uni-websocket-index.swift');

function readManifest(path) {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(source);
}

export function writeIOSUTSDependencies({ appPath, manifestPath, extAPIBinary }) {
  const app = resolve(appPath);
  const manifest = resolve(manifestPath);
  const binary = resolve(extAPIBinary);
  if (!existsSync(app) || !statSync(app).isDirectory()) {
    throw new Error(`iOS app does not exist: ${app}`);
  }
  if (!existsSync(binary) || !statSync(binary).isFile()) {
    throw new Error(`DCloudUTSExtAPI binary does not exist: ${binary}`);
  }

  const document = readManifest(manifest);
  const duts = Object.keys(document?.['app-ios']?.distribute?.modules ?? {}).sort();
  if (!duts.includes(WEBSOCKET_MODULE)) {
    throw new Error('app-ios manifest must declare uni-websocket before automation host assembly');
  }
  if (!readFileSync(binary).includes(WEBSOCKET_BINARY_MARKER)) {
    throw new Error('DCloudUTSExtAPI runtime does not contain uni-websocket');
  }

  const receipt = { duts };
  const output = resolve(app, 'HXDependencies/uniapp-x-uts.json');
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, output);
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) {
    throw new Error('Usage: write-ios-uts-dependencies.mjs <app> <manifest> <DCloudUTSExtAPI-binary>');
  }
  writeIOSUTSDependencies({
    appPath: process.argv[2],
    manifestPath: process.argv[3],
    extAPIBinary: process.argv[4],
  });
}
