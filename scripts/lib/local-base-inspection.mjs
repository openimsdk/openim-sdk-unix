import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEBSOCKET_MARKER = Buffer.from('Luts/sdk/modules/DCloudUniWebsocket/');
const CLOUD_VAPOR_MARKER = Buffer.from('Lio/dcloud/uniappxv/UniAppActivity;');
const LOCAL_SDK_RUNTIME_MARKER = Buffer.from('Lio/dcloud/uniapp/UniAppActivity;');
const CLASSIC_RUNTIME_MARKER = Buffer.from('Lio/dcloud/WebAppActivity;');

export function inspectAndroidBaseEntries({ dexPayloads }) {
  let hasWebSocket = false;
  let hasVaporRuntime = false;
  let hasClassicRuntime = false;
  for (const payload of dexPayloads) {
    const dex = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    hasWebSocket = hasWebSocket || dex.includes(WEBSOCKET_MARKER);
    hasVaporRuntime = hasVaporRuntime || dex.includes(CLOUD_VAPOR_MARKER);
    hasClassicRuntime = hasClassicRuntime
      || dex.includes(CLASSIC_RUNTIME_MARKER)
      || dex.includes(LOCAL_SDK_RUNTIME_MARKER);
  }
  return { hasWebSocket, hasVaporRuntime, hasClassicRuntime };
}

export function inspectAndroidBase(basePath) {
  const entries = execFileSync('zipinfo', ['-1', basePath], { encoding: 'utf8' });
  const dexFiles = entries.split(/\r?\n/).filter((entry) => /^classes\d*\.dex$/.test(entry));
  const payloads = dexFiles.map((dexFile) => execFileSync('unzip', ['-p', basePath, dexFile], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  }));
  return inspectAndroidBaseEntries({ dexPayloads: payloads });
}

export function iosBaseHasWebSocket(basePath) {
  const dependencyPath = resolve(basePath, 'HXDependencies/uniapp-x-uts.json');
  if (!existsSync(dependencyPath)) {
    return false;
  }
  const dependency = JSON.parse(readFileSync(dependencyPath, 'utf8'));
  return Array.isArray(dependency.duts) && dependency.duts.includes('uni-websocket');
}

export function automationTarget(platform, iosTarget = 'simulator') {
  if (platform === 'android') {
    return 'app-android';
  }
  if (platform !== 'ios') {
    throw new Error(`Unsupported automation platform: ${platform}`);
  }
  return iosTarget === 'device' ? 'app-ios' : 'app-ios-simulator';
}
