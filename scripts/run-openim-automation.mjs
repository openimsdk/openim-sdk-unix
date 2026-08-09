#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  evidenceFailureMessage,
  writeLatestAutomationEvidence,
} from './lib/openim-runner-evidence.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const platform = process.argv[2] || '';
const cliPath = process.env.HBUILDERX_CLI_PATH || '/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli';
const startupTimeoutMs = Number(process.env.OPENIM_TEST_STARTUP_TIMEOUT_MS || 5 * 60 * 1000);
const hardTimeoutMs = Number(process.env.OPENIM_TEST_PROCESS_TIMEOUT_MS || 30 * 60 * 1000);
const requestedVapor = process.env.OPENIM_TEST_VAPOR !== 'false' && process.env.OPENIM_TEST_VAPOR !== '0';
const runStartedAtMs = Date.now();

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(`[openim-runner] ${message}`);
  process.exit(1);
}

function findProjectJestPIDs() {
  const processList = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const reportMarker = `/hbuilderx-for-uniapp-test/${basename(projectRoot)}/`;
  const jestMarker = '/hbuilderx-for-uniapp-test-lib/node_modules/jest/bin/jest.js';
  const pids = [];
  for (const line of processList.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (match == null) {
      continue;
    }
    if (match[2].includes(jestMarker) && match[2].includes(reportMarker)) {
      pids.push(Number(match[1]));
    }
  }
  return pids;
}

function terminateProjectJestProcesses(reason) {
  const pids = findProjectJestPIDs();
  for (const pid of pids) {
    console.warn(`[openim-runner] terminating project Jest pid=${pid} (${reason})`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
  if (pids.length > 0) {
    execFileSync('sleep', ['1']);
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process exited after SIGTERM.
      }
    }
  }
  return pids.length;
}

function readConfiguredBasePath(platformName) {
  const explicit = process.env.OPENIM_TEST_CUSTOM_BASE || '';
  if (explicit.length > 0) {
    return resolve(explicit);
  }

  const envPath = resolve(projectRoot, 'env.js');
  if (!existsSync(envPath)) {
    return '';
  }
  const source = readFileSync(envPath, 'utf8');
  const key = platformName === 'android' ? 'android' : 'ios';
  const blockPattern = new RegExp(`['\"]?${key}['\"]?\\s*:\\s*\\{[\\s\\S]*?['\"]?executablePath['\"]?\\s*:\\s*['\"]([^'\"]+)['\"]`);
  const match = source.match(blockPattern);
  return match == null ? '' : resolve(match[1]);
}

function assertManifestWebSocket() {
  const manifestPath = resolve(projectRoot, 'manifest.json');
  const source = readFileSync(manifestPath, 'utf8');
  const matches = source.match(/"uni-websocket"\s*:\s*\{/g) || [];
  if (matches.length < 2) {
    fail('manifest.json must explicitly include uni-websocket for both app-android and app-ios before custom bases are built.');
  }
}

function assertStaticAutomationIsPassive() {
  const staticConfigPath = resolve(projectRoot, 'static/openim-test-config.json');
  if (!existsSync(staticConfigPath)) {
    return;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(staticConfigPath, 'utf8'));
  } catch (error) {
    fail(`static/openim-test-config.json is invalid JSON: ${error.message}`);
  }
  const autorun = String(config.autorun || '').toLowerCase();
  if (autorun === '1' || autorun === 'true' || autorun === 'yes') {
    fail('static/openim-test-config.json enables autorun. Formal uniapp.test provisions fresh accounts through Jest; regenerate the static fixture without AUTORUN=1 to prevent two page instances from running concurrently.');
  }
}

function inspectAndroidBase(basePath) {
  const entries = execFileSync('zipinfo', ['-1', basePath], { encoding: 'utf8' });
  const dexFiles = entries.split(/\r?\n/).filter((entry) => /^classes\d*\.dex$/.test(entry));
  let hasWebSocket = false;
  let hasVaporRuntime = false;
  let hasClassicRuntime = false;
  for (const dexFile of dexFiles) {
    const dex = execFileSync('unzip', ['-p', basePath, dexFile], {
      encoding: null,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (dex.includes(Buffer.from('Luts/sdk/modules/DCloudUniWebsocket/'))) {
      hasWebSocket = true;
    }
    hasVaporRuntime = hasVaporRuntime || dex.includes(Buffer.from('Lio/dcloud/uniappxv/UniAppActivity;'));
    hasClassicRuntime = hasClassicRuntime || dex.includes(Buffer.from('Lio/dcloud/uniapp/UniAppActivity;'));
  }
  return { hasWebSocket, hasVaporRuntime, hasClassicRuntime };
}

function iosBaseHasWebSocket(basePath) {
  const dependencyPath = resolve(basePath, 'HXDependencies/uniapp-x-uts.json');
  if (!existsSync(dependencyPath)) {
    return false;
  }
  const dependency = JSON.parse(readFileSync(dependencyPath, 'utf8'));
  return Array.isArray(dependency.duts) && dependency.duts.includes('uni-websocket');
}

function assertCustomBase(platformName) {
  const basePath = readConfiguredBasePath(platformName);
  if (basePath.length === 0) {
    fail('No custom base path found. Set OPENIM_TEST_CUSTOM_BASE or configure executablePath in env.js.');
  }
  if (!existsSync(basePath)) {
    fail(`Custom base does not exist: ${basePath}`);
  }

  const androidMetadata = platformName === 'android' ? inspectAndroidBase(basePath) : null;
  const hasWebSocket = androidMetadata == null ? iosBaseHasWebSocket(basePath) : androidMetadata.hasWebSocket;
  if (!hasWebSocket) {
    fail(`Custom ${platformName} base does not contain uni-websocket: ${basePath}. Rebuild the base after the manifest module change.`);
  }
  if (androidMetadata != null && requestedVapor && !androidMetadata.hasVaporRuntime) {
    fail(`Custom Android base is not a Vapor runtime: ${basePath}. Rebuild the Vapor base, or set OPENIM_TEST_VAPOR=false only for a classic-runtime diagnostic run.`);
  }
  if (androidMetadata != null && !requestedVapor && !androidMetadata.hasClassicRuntime) {
    fail(`Custom Android base is not a classic runtime: ${basePath}. Set OPENIM_TEST_VAPOR=true for this base.`);
  }
  console.log(`[openim-runner] custom base preflight passed: ${basePath}`);
}

if (platform !== 'android' && platform !== 'ios') {
  fail('Usage: node scripts/run-openim-automation.mjs <android|ios> [--device-id <id>]');
}
if (!existsSync(cliPath)) {
  fail(`HBuilderX CLI does not exist: ${cliPath}`);
}

assertManifestWebSocket();
assertStaticAutomationIsPassive();
assertCustomBase(platform);
terminateProjectJestProcesses('stale preflight process');

const target = platform === 'android' ? 'app-android' : 'app-ios-simulator';
const deviceID = readArgument('--device-id') || process.env.OPENIM_TEST_DEVICE_ID || '';
const runtime = {
  target,
  deviceID,
  deviceKind: process.env.OPENIM_TEST_DEVICE_KIND || (target.includes('simulator') ? 'simulator' : 'unknown'),
  osVersion: process.env.OPENIM_TEST_OS_VERSION || 'unknown',
  architecture: process.env.OPENIM_TEST_ARCHITECTURE || 'unknown',
  buildConfiguration: process.env.OPENIM_TEST_BUILD_CONFIGURATION || 'Debug',
};
const series = {
  id: process.env.OPENIM_AUTOMATION_SERIES_ID || `standalone-${runStartedAtMs}`,
  sequence: Number(process.env.OPENIM_AUTOMATION_SERIES_SEQUENCE || 1),
  total: Number(process.env.OPENIM_AUTOMATION_SERIES_TOTAL || 1),
};
const args = ['uniapp.test', target, '--project', projectRoot, '--vapor', requestedVapor ? 'true' : 'false'];
if (requestedVapor) {
  args.push('--vapor_render_target', 'bytecode');
}
if (deviceID.length > 0) {
  args.push('--device_id', deviceID);
}

console.log(`[openim-runner] starting ${target} (${requestedVapor ? 'vapor-bytecode' : 'classic'})${deviceID.length > 0 ? ` on ${deviceID}` : ''}`);
const child = spawn(cliPath, args, {
  cwd: projectRoot,
  env: process.env,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let connected = false;
let terminating = false;
let failureMarker = '';
let outputTail = '';

function inspectOutput(chunk) {
  const text = chunk.toString();
  outputTail = `${outputTail}${text}`.slice(-64 * 1024);
  if (text.includes('[openim-test] automator connected')) {
    connected = true;
    clearTimeout(startupTimer);
  }
  const failureMatch = text.match(/(?:编译失败|uni-websocket not found|Test Suites:\s+\d+ failed|Tests:\s+\d+ failed)/i);
  if (failureMatch != null) {
    failureMarker = failureMatch[0];
  }
}

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  inspectOutput(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  inspectOutput(chunk);
});

function terminate(reason) {
  if (terminating) {
    return;
  }
  terminating = true;
  failureMarker = reason;
  console.error(`[openim-runner] ${reason}`);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  terminateProjectJestProcesses(reason);
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 5000).unref();
}

const startupTimer = setTimeout(() => {
  terminate(`automator did not connect within ${startupTimeoutMs}ms; verify that the custom base contains uni-websocket and no stale Jest process owns the test port`);
}, startupTimeoutMs);
const hardTimer = setTimeout(() => {
  terminate(`automation exceeded hard timeout ${hardTimeoutMs}ms`);
}, hardTimeoutMs);
const heartbeat = setInterval(() => {
  console.log(`[openim-runner] ${connected ? 'test flow is running' : 'waiting for automator connection'} (${Math.floor(process.uptime())}s process uptime)`);
}, 15 * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => terminate(`received ${signal}`));
}

child.on('error', (error) => terminate(`failed to start HBuilderX CLI: ${error.message}`));
child.on('close', (code, signal) => {
  clearTimeout(startupTimer);
  clearTimeout(hardTimer);
  clearInterval(heartbeat);
  terminateProjectJestProcesses('runner exit cleanup');
  const passed = /Test Suites:\s+\d+ passed/i.test(outputTail) && /Tests:\s+\d+ passed/i.test(outputTail);
  let evidenceFailure = '';
  try {
    const fullRun = String(process.env.OPENIM_AUTOMATION_SUITE || '').length === 0;
    const { evidence, evidencePath } = writeLatestAutomationEvidence({
      projectRoot,
      platform,
      startedAtMs: runStartedAtMs,
      fullRun,
      runtime: {
        ...runtime,
        target,
        deviceID,
      },
      series,
    });
    console.log(`[openim-runner] automation evidence: ${evidencePath}`);
    if (!evidence.contractEvidence.passed) {
      evidenceFailure = evidenceFailureMessage(evidence);
    }
  } catch (error) {
    evidenceFailure = `automation evidence unavailable: ${error.message}`;
  }
  if (code === 0 && failureMarker.length === 0 && passed && evidenceFailure.length === 0) {
    console.log('[openim-runner] automation passed');
    process.exit(0);
  }
  console.error(`[openim-runner] automation failed (code=${String(code)}, signal=${String(signal)}, marker=${failureMarker || evidenceFailure || 'missing explicit Jest success marker'})`);
  process.exit(1);
});
