#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  evidenceFailureMessage,
  evidenceManifestSummary,
  reportManifestSummary,
  writeLatestAutomationEvidence,
} from './lib/openim-runner-evidence.mjs';
import { runUnderAutomationRunnerLock } from './lib/automation-runner-lock.mjs';
import { writeAutomationRunManifestSet } from './lib/automation-run-manifest.mjs';
import {
  automationTarget,
  inspectAndroidBase,
  iosBaseHasWebSocket,
} from './lib/local-base-inspection.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const platform = process.argv[2] || '';
const cliPath = process.env.HBUILDERX_CLI_PATH || '/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli';
const startupTimeoutMs = Number(process.env.OPENIM_TEST_STARTUP_TIMEOUT_MS || 5 * 60 * 1000);
const hardTimeoutMs = Number(process.env.OPENIM_TEST_PROCESS_TIMEOUT_MS || 30 * 60 * 1000);
const requestedVapor = process.env.OPENIM_TEST_VAPOR !== 'false' && process.env.OPENIM_TEST_VAPOR !== '0';
const runStartedAtMs = Date.now();
const runId = randomUUID();
const requestedSuiteFilter = String(process.env.OPENIM_AUTOMATION_SUITE || '').trim();
const jestConfigPath = resolve(projectRoot, 'jest.config.js');
const originalJestConfig = existsSync(jestConfigPath) ? readFileSync(jestConfigPath) : null;
const automationFixturePath = resolve(projectRoot, '.openim-test-accounts.json');
const automationEnvPath = resolve(projectRoot, 'env.js');
const originalAutomationEnv = existsSync(automationEnvPath) ? readFileSync(automationEnvPath) : null;
const automationDebugConfigKey = 'hbuilderx-for-uniapp-test.isDebug';
let jestConfigRestored = false;
let automationEnvironmentRestored = false;
let automationFixtureOwned = false;
let originalAutomationFixture = null;
let originalAutomationDebugValue = '';
let automationDebugModified = false;

function stageAutomationSuiteFilter() {
  if (!existsSync(automationFixturePath)) {
    if (requestedSuiteFilter.length > 0) {
      fail('OPENIM_AUTOMATION_SUITE requires a pre-provisioned .openim-test-accounts.json fixture');
    }
    return;
  }
  originalAutomationFixture = readFileSync(automationFixturePath);
  const fixture = JSON.parse(originalAutomationFixture.toString('utf8'));
  fixture.suiteFilter = requestedSuiteFilter;
  writeFileSync(automationFixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
}

function restoreAutomationFixture() {
  if (originalAutomationFixture == null) {
    return;
  }
  writeFileSync(automationFixturePath, originalAutomationFixture, { mode: 0o600 });
  originalAutomationFixture = null;
}

function restoreJestConfig() {
  if (jestConfigRestored || originalJestConfig == null) {
    return;
  }
  jestConfigRestored = true;
  if (!existsSync(jestConfigPath) || !readFileSync(jestConfigPath).equals(originalJestConfig)) {
    writeFileSync(jestConfigPath, originalJestConfig);
  }
}

function cleanupAutomationAccountFixture() {
  if (!automationFixtureOwned) {
    return;
  }
  automationFixtureOwned = false;
  rmSync(automationFixturePath, { force: true });
}

function restoreAutomationEnvironment() {
  if (automationEnvironmentRestored) {
    return;
  }
  automationEnvironmentRestored = true;
  if (originalAutomationEnv == null) {
    rmSync(automationEnvPath, { force: true });
  } else if (!existsSync(automationEnvPath) || !readFileSync(automationEnvPath).equals(originalAutomationEnv)) {
    writeFileSync(automationEnvPath, originalAutomationEnv);
  }
}

function readAutomationProtocolDebug() {
  const output = execFileSync(cliPath, ['config', 'get', '--key', automationDebugConfigKey], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
}

function writeAutomationProtocolDebug(value) {
  execFileSync(
    cliPath,
    ['config', 'set', '--key', automationDebugConfigKey, '--value', value, '--type', 'boolean'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

function disableAutomationProtocolDebug() {
  if (process.env.OPENIM_AUTOMATION_ALLOW_PROTOCOL_DEBUG === '1') {
    fail('OPENIM_AUTOMATION_ALLOW_PROTOCOL_DEBUG is forbidden because protocol traces expose temporary IM credentials');
  }
  try {
    originalAutomationDebugValue = readAutomationProtocolDebug();
    if (originalAutomationDebugValue !== 'true' && originalAutomationDebugValue !== 'false') {
      fail(`unable to determine ${automationDebugConfigKey}; refusing to pass credentials through an unverified logger`);
    }
    if (originalAutomationDebugValue === 'true') {
      writeAutomationProtocolDebug('false');
      automationDebugModified = true;
    }
    if (readAutomationProtocolDebug() !== 'false') {
      fail(`failed to disable ${automationDebugConfigKey}; refusing to expose temporary IM credentials`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`failed to disable HBuilderX automation protocol debug: ${detail}`);
  }
}

function restoreAutomationProtocolDebug() {
  if (!automationDebugModified) {
    return;
  }
  automationDebugModified = false;
  try {
    writeAutomationProtocolDebug(originalAutomationDebugValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[openim-runner] failed to restore ${automationDebugConfigKey}: ${detail}`);
  }
}

process.on('exit', () => {
  restoreJestConfig();
  restoreAutomationFixture();
  cleanupAutomationAccountFixture();
  restoreAutomationEnvironment();
  restoreAutomationProtocolDebug();
});

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(`[openim-runner] ${message}`);
  process.exit(1);
}

let delegatedExitStatus;
try {
  delegatedExitStatus = runUnderAutomationRunnerLock({ projectRoot });
} catch (error) {
  fail(error.message);
}
if (delegatedExitStatus != null) {
  process.exit(delegatedExitStatus);
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
  return basePath;
}

function hashArtifact(path) {
  if (statSync(path).isFile()) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  const digest = createHash('sha256');
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const item = resolve(directory, name);
      const itemRelative = relative(path, item).replaceAll('\\', '/');
      const stat = statSync(item);
      if (stat.isDirectory()) {
        digest.update(`D\0${itemRelative}\0`);
        visit(item);
      } else if (stat.isFile()) {
        const fileSha256 = createHash('sha256').update(readFileSync(item)).digest('hex');
        digest.update(`F\0${itemRelative}\0${stat.size}\0${fileSha256}\0`);
      }
    }
  };
  visit(path);
  return digest.digest('hex');
}

function readGitAuthority(root, label) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) fail(`${label} does not resolve to a full Git revision`);
  return { branch, head, dirty: status.length > 0 };
}

function resolveSDKAuthorityRoot() {
  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (realpathSync(topLevel) === realpathSync(projectRoot)) return projectRoot;
  } catch {
    // A staged local-runtime project is intentionally outside the SDK worktree.
  }
  const runtimeRootValue = String(process.env.OPENIM_AUTOMATION_RUNTIME_ROOT || '');
  if (!runtimeRootValue.startsWith('/')) fail('runtime evidence requires an absolute OPENIM_AUTOMATION_RUNTIME_ROOT');
  const runtimeRoot = resolve(runtimeRootValue);
  const sdkRoot = dirname(runtimeRoot);
  if (!existsSync(runtimeRoot)
    || lstatSync(runtimeRoot).isSymbolicLink()
    || realpathSync(runtimeRoot) !== runtimeRoot
    || runtimeRoot !== resolve(sdkRoot, 'local-runtime')) fail('runtime evidence automation root is not the canonical SDK local-runtime directory');
  let stage;
  try {
    stage = JSON.parse(readFileSync(resolve(projectRoot, '.openim-local-runtime.json'), 'utf8'));
  } catch {
    fail('runtime evidence staging metadata is missing or invalid');
  }
  const sdk = readGitAuthority(sdkRoot, 'Public SDK authority');
  if (stage?.schemaVersion !== 1 || stage?.source?.revision !== sdk.head || stage?.source?.dirty !== false || sdk.dirty) fail('runtime evidence staging does not match one clean Public SDK revision');
  return sdkRoot;
}

function readToolchainLock() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(projectRoot, 'toolchain.lock.json'), 'utf8'));
  } catch {
    fail('toolchain.lock.json is missing from the automation project');
  }
  if (lock?.schemaVersion !== 2 || lock?.publicNative == null) fail('Public native toolchain authority is invalid');
  return lock;
}

function readHBuilderToolchainAuthority(lock) {
  const expectedVersion = String(lock?.hbuilderx?.version || '');
  const expectedSha256 = String(lock?.hbuilderx?.cliSha256 || '');
  if (expectedVersion.length === 0 || !/^[0-9a-f]{64}$/.test(expectedSha256)) fail('HBuilderX toolchain lock is incomplete');
  const cliSha256 = hashArtifact(cliPath);
  if (cliSha256 !== expectedSha256) fail('HBuilderX CLI does not match toolchain.lock.json');
  const infoPath = resolve(cliPath, '../../Info.plist');
  const version = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPath], { encoding: 'utf8' }).trim();
  if (version !== expectedVersion) fail('HBuilderX version does not match toolchain.lock.json');
  return { version, cliSha256 };
}

function resolvePublicCoreRoot(sdkRoot, lock) {
  const source = lock.publicNative.source;
  const environmentName = String(source.rootEnvironmentVariable || 'OPENIM_PUBLIC_CORE_DIR');
  const explicit = String(process.env[environmentName] || process.env.OPENIM_CORE_ROOT || '');
  if (explicit.length > 0) return resolve(explicit);
  for (const name of source.siblingDirectories || []) {
    const candidate = resolve(sdkRoot, '..', String(name));
    if (existsSync(candidate)) return candidate;
  }
  fail(`${environmentName} must point to the locked Public Core worktree`);
}

function readPublicCoreAuthority(platformName, sdkRoot, lock) {
  const coreRoot = resolvePublicCoreRoot(sdkRoot, lock);
  const core = readGitAuthority(coreRoot, 'Public Core authority');
  const expectedRevision = String(lock.publicNative.source.revision || '');
  if (core.dirty || core.head !== expectedRevision) fail('Public Core authority must be the exact clean revision in toolchain.lock.json');
  const platformLock = lock.publicNative[platformName];
  const nativeArtifactKind = platformName === 'ios' ? 'xcframework-inventory' : 'aar';
  const expectedNativeSha256 = String(platformName === 'ios' ? platformLock?.localOverrideInventorySha256 : platformLock?.sha256 || '');
  const nativeArtifactPath = resolve(sdkRoot, String(platformLock?.localOverridePath || ''));
  if (!/^[0-9a-f]{64}$/.test(expectedNativeSha256) || !existsSync(nativeArtifactPath)) fail(`locked ${nativeArtifactKind} authority is missing`);
  const nativeArtifactSha256 = hashArtifact(nativeArtifactPath);
  if (nativeArtifactSha256 !== expectedNativeSha256) fail(`local ${nativeArtifactKind} does not match toolchain.lock.json`);
  return { ...core, root: coreRoot, nativeArtifactKind, nativeArtifactSha256 };
}

function prepareAutomationAccountFixture() {
  if (process.env.OPENIM_AUTOMATION_PREPROVISION !== '1') {
    return;
  }
  for (const name of ['OPENIM_API_BASE', 'OPENIM_WS_BASE', 'IM_SECRET']) {
    if (String(process.env[name] || '').length === 0) {
      fail(`${name} is required when OPENIM_AUTOMATION_PREPROVISION=1`);
    }
  }
  const provisioner = resolve(projectRoot, 'scripts/register-openim-test-accounts.mjs');
  try {
    execFileSync(process.execPath, [provisioner], {
      cwd: projectRoot,
      env: {
        ...process.env,
        OUTPUT: automationFixturePath,
        STATIC_OUTPUT: 'false',
        PLATFORM_IDS: process.env.PLATFORM_IDS || '1,2',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 60 * 1000,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`failed to provision disposable OpenIM test users: ${detail}`);
  }
  chmodSync(automationFixturePath, 0o600);
  automationFixtureOwned = true;
  console.log('[openim-runner] disposable OpenIM test users provisioned');
}

if (platform !== 'android' && platform !== 'ios') {
  fail('Usage: node scripts/run-openim-automation.mjs <android|ios> [--device-id <id>]');
}
if (!existsSync(cliPath)) {
  fail(`HBuilderX CLI does not exist: ${cliPath}`);
}

function closeAutomationProject() {
  spawnSync(cliPath, ['project', 'close', '--path', projectRoot], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'ignore',
  });
}

function openAutomationProject() {
  closeAutomationProject();
  const result = spawnSync(cliPath, ['project', 'open', '--path', projectRoot], {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.error != null) {
    fail(`failed to import the staging project into HBuilderX: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`failed to import the staging project into HBuilderX (exit ${String(result.status)})`);
  }
}

openAutomationProject();
disableAutomationProtocolDebug();
assertManifestWebSocket();
assertStaticAutomationIsPassive();
terminateProjectJestProcesses('stale preflight process');
prepareAutomationAccountFixture();
stageAutomationSuiteFilter();

const target = automationTarget(platform, process.env.OPENIM_IOS_TARGET || 'simulator');
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
if (!Number.isSafeInteger(series.sequence) || series.sequence <= 0 || !Number.isSafeInteger(series.total) || series.total <= 0 || series.sequence > series.total) {
  fail('automation series metadata must be positive integers with sequence <= total');
}
const customBasePath = assertCustomBase(platform);
const sdkAuthorityRoot = resolveSDKAuthorityRoot();
const sdkAuthority = readGitAuthority(sdkAuthorityRoot, 'Public SDK authority');
if (sdkAuthority.dirty) fail('Public SDK authority must be clean before runtime evidence is generated');
const toolchainLock = readToolchainLock();
const hbuilderxAuthority = readHBuilderToolchainAuthority(toolchainLock);
const coreAuthority = readPublicCoreAuthority(platform, sdkAuthorityRoot, toolchainLock);
const runManifest = {
  schemaVersion: 1,
  runId,
  edition: 'public',
  startedAt: new Date(runStartedAtMs).toISOString(),
  platform,
  vapor: requestedVapor,
  sdk: sdkAuthority,
  core: { branch: coreAuthority.branch, head: coreAuthority.head, dirty: coreAuthority.dirty },
  customBase: {
    name: basename(customBasePath),
    sha256: hashArtifact(customBasePath),
    nativeArtifactKind: coreAuthority.nativeArtifactKind,
    nativeArtifactSha256: coreAuthority.nativeArtifactSha256,
  },
  hbuilderx: hbuilderxAuthority,
  runtime,
  series,
  result: { status: 'running', finalizationComplete: false },
};
const runManifestPath = resolve(projectRoot, 'test-results/openim-automation', `${platform}-${runId}-manifest.json`);
const latestRunManifestPath = resolve(projectRoot, 'test-results/openim-automation', `${platform}-latest-manifest.json`);
const persistRunManifest = () => writeAutomationRunManifestSet({
  perRunPath: runManifestPath,
  latestPath: latestRunManifestPath,
  manifest: runManifest,
});
persistRunManifest();
console.log(`[openim-runner] provenance manifest: ${runManifestPath}`);
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
let allocatedRuntimePort = '';
let androidAutomationRebuildStarted = false;
let androidAutomationRebuildProcess = null;

function startAndroidAutomationRebuild() {
  if (platform !== 'android' || process.env.OPENIM_LOCAL_ANDROID_AUTOMATION_REBUILD !== '1' || androidAutomationRebuildStarted) {
    return;
  }
  if (allocatedRuntimePort.length === 0 || deviceID.length === 0) {
    terminate('Android automation resource sync arrived without an allocated port or device');
    return;
  }
  androidAutomationRebuildStarted = true;
  const automationRuntimeRoot = resolve(process.env.OPENIM_AUTOMATION_RUNTIME_ROOT || resolve(projectRoot, 'local-runtime'));
  const rebuildScript = resolve(automationRuntimeRoot, 'scripts/rebuild-local-android-automation.sh');
  console.log(`[openim-runner] rebuilding static Android automation host for port ${allocatedRuntimePort}`);
  androidAutomationRebuildProcess = spawn('bash', [rebuildScript, allocatedRuntimePort, deviceID], {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  androidAutomationRebuildProcess.stdout.on('data', (chunk) => process.stdout.write(chunk));
  androidAutomationRebuildProcess.stderr.on('data', (chunk) => process.stderr.write(chunk));
  androidAutomationRebuildProcess.on('error', (error) => terminate(`Android automation host rebuild failed to start: ${error.message}`));
  androidAutomationRebuildProcess.on('close', (code) => {
    androidAutomationRebuildProcess = null;
    if (code !== 0) {
      terminate(`Android automation host rebuild failed with exit code ${String(code)}`);
    }
  });
}

function inspectOutput(chunk) {
  const text = chunk.toString();
  outputTail = `${outputTail}${text}`.slice(-64 * 1024);
  const portMatch = outputTail.match(/automator:runtime[^\n]*port=(\d+)|分配测试端口:\s*(\d+)/);
  if (portMatch != null) {
    allocatedRuntimePort = portMatch[1] || portMatch[2];
  }
  if (outputTail.includes('发送同步资源数据')) {
    startAndroidAutomationRebuild();
  }
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
  if (androidAutomationRebuildProcess != null) {
    androidAutomationRebuildProcess.kill('SIGTERM');
  }
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
  restoreJestConfig();
  restoreAutomationFixture();
  cleanupAutomationAccountFixture();
  restoreAutomationEnvironment();
  restoreAutomationProtocolDebug();
  terminateProjectJestProcesses('runner exit cleanup');
  closeAutomationProject();
  const passed = /Test Suites:\s+\d+ passed/i.test(outputTail) && /Tests:\s+\d+ passed/i.test(outputTail);
  const fullRun = requestedSuiteFilter.length === 0;
  let evidenceFailure = '';
  let reportSummary = null;
  let evidenceSummary = null;
  try {
    const { evidence, evidencePath, reportPath } = writeLatestAutomationEvidence({
      projectRoot,
      platform,
      startedAtMs: runStartedAtMs,
      fullRun,
      repositoryOverride: { revision: sdkAuthority.head, dirty: sdkAuthority.dirty },
      runtime: {
        ...runtime,
        target,
        deviceID,
      },
      series,
      runId,
      runManifest,
      runManifestPath: relative(projectRoot, runManifestPath),
    });
    reportSummary = reportManifestSummary(projectRoot, reportPath, evidence.redactedReport);
    evidenceSummary = evidenceManifestSummary(projectRoot, evidencePath, evidence);
    console.log(`[openim-runner] automation evidence: ${evidencePath}`);
    if (fullRun && (!evidence.contractEvidence.passed
      || evidence.contractEvidence.strictPassed !== true
      || evidence.responseStructureEvidence?.passed !== true
      || (Array.isArray(evidence.contractEvidence.knownIssueWaivers) && evidence.contractEvidence.knownIssueWaivers.length > 0))) {
      evidenceFailure = evidenceFailureMessage(evidence);
    }
  } catch (error) {
    evidenceFailure = `automation evidence unavailable: ${error.message}`;
  }
  const succeeded = code === 0 && failureMarker.length === 0 && passed && evidenceFailure.length === 0;
  runManifest.finishedAt = new Date().toISOString();
  runManifest.result = {
    status: succeeded ? 'passed' : 'failed',
    exitCode: code,
    signal,
    failureMarker: succeeded ? '' : (failureMarker || evidenceFailure || 'missing explicit Jest success marker'),
    finalizationComplete: true,
    ...(reportSummary == null ? {} : { report: reportSummary }),
    ...(evidenceSummary == null ? {} : { evidence: evidenceSummary }),
  };
  try {
    persistRunManifest();
  } catch (error) {
    evidenceFailure = `run manifest finalization failed: ${error.message}`;
  }
  if (succeeded && evidenceFailure.length === 0) {
    console.log('[openim-runner] automation passed');
    process.exit(0);
  }
  console.error(`[openim-runner] automation failed (code=${String(code)}, signal=${String(signal)}, marker=${failureMarker || evidenceFailure || 'missing explicit Jest success marker'})`);
  process.exit(1);
});
