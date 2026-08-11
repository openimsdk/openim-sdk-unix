#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';

const env = process.env;

const OPENIM_API_BASE = env.OPENIM_API_BASE || 'http://127.0.0.1:10002';
const OPENIM_WS_BASE = env.OPENIM_WS_BASE || 'ws://127.0.0.1:10001';
const OPENIM_SDK_API_BASE = env.OPENIM_SDK_API_BASE || '';
const OPENIM_SDK_WS_BASE = env.OPENIM_SDK_WS_BASE || '';

const IM_ADMIN_USER_ID = env.IM_ADMIN_USER_ID || 'imAdmin';
const IM_SECRET = env.IM_SECRET || 'openIM123';

const PLATFORM_IDS = parsePlatformIDs(env.PLATFORM_IDS || env.PLATFORM_ID || '1,2');
const ACCOUNT_PREFIX = sanitizeAccountPrefix(env.ACCOUNT_PREFIX || 'unixagent');
const OUTPUT = resolve(env.OUTPUT || '.openim-test-accounts.json');
const STATIC_OUTPUT = env.STATIC_OUTPUT == null || env.STATIC_OUTPUT === '' || env.STATIC_OUTPUT === 'false'
  ? ''
  : resolve(env.STATIC_OUTPUT);
const AUTORUN = env.AUTORUN === '1' || env.AUTORUN === 'true' ? 'true' : '';
const TIMEOUT_MS = Number(env.TIMEOUT_MS || '15000');

if (typeof fetch !== 'function') {
  throw new Error('This script requires Node.js 18+ with global fetch support.');
}

function sanitizeAccountPrefix(value) {
  const sanitized = value.replace(/[^a-zA-Z0-9]/g, '');
  return sanitized.length > 0 ? sanitized : 'unixagent';
}

function parsePlatformIDs(value) {
  const result = [];
  for (const item of value.split(',')) {
    const platformID = Number(item.trim());
    if (!Number.isFinite(platformID) || platformID <= 0) {
      throw new Error(`PLATFORM_IDS must contain positive numbers, got ${value}`);
    }
    if (!result.includes(platformID)) {
      result.push(platformID);
    }
  }
  if (result.length === 0) {
    throw new Error('PLATFORM_IDS must not be empty');
  }
  return result;
}

function createSuffix() {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}${random}`;
}

function trimBaseURL(value) {
  return value.replace(/\/+$/, '');
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
}

function isPrivateIPv4(address) {
  if (address.startsWith('10.')) {
    return true;
  }
  if (address.startsWith('192.168.')) {
    return true;
  }
  const parts = address.split('.').map((part) => Number(part));
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function getLocalLANIP() {
  const candidates = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal && isPrivateIPv4(item.address)) {
        candidates.push(item.address);
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error('No LAN IPv4 address found. Set OPENIM_SDK_API_BASE and OPENIM_SDK_WS_BASE explicitly.');
  }
  return candidates[0];
}

function toDeviceBaseURL(value, lanIP) {
  const trimmed = trimBaseURL(value);
  if (trimmed.length === 0) {
    return '';
  }
  const url = new URL(trimmed);
  if (isLoopbackHost(url.hostname)) {
    url.hostname = lanIP;
  }
  return trimBaseURL(url.toString());
}

function readString(value) {
  return typeof value === 'string' ? value : '';
}

function readNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clipped(value) {
  const text = String(value);
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

function writeJSONFile(filePath, value) {
  if (filePath.length === 0) {
    return;
  }
  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function postJson(url, payload, operationID, token = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
      operationID: `unixsdk_${operationID}`,
    };
    if (token.length > 0) {
      headers.token = token;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}: ${clipped(raw)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${url} returned non-JSON response: ${clipped(raw)}`);
    }

    return {
      raw,
      errCode: readNumber(parsed.errCode, 0),
      errMsg: readString(parsed.errMsg),
      data: parsed.data || {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertOK(response, label) {
  if (response.errCode !== 0) {
    throw new Error(`${label} failed: ${response.raw}`);
  }
}

async function getIMAdminToken(suffix) {
  const resp = await postJson(
    `${trimBaseURL(OPENIM_API_BASE)}/auth/get_admin_token`,
    { secret: IM_SECRET, userID: IM_ADMIN_USER_ID },
    `im_admin_token_${suffix}`,
  );
  assertOK(resp, 'get IM admin token');
  const token = readString(resp.data.token);
  if (token.length === 0) {
    throw new Error(`get IM admin token returned empty token: ${resp.raw}`);
  }
  return token;
}

async function registerViaOpenIM(account, imAdminToken, suffix) {
  const resp = await postJson(
    `${trimBaseURL(OPENIM_API_BASE)}/user/user_register`,
    {
      users: [
        {
          userID: account,
          nickname: account,
        },
      ],
    },
    `im_user_register_${account}_${suffix}`,
    imAdminToken,
  );
  assertOK(resp, `OpenIM user register ${account}`);
  return account;
}

async function getUserToken(userID, platformID, imAdminToken, suffix) {
  const resp = await postJson(
    `${trimBaseURL(OPENIM_API_BASE)}/auth/get_user_token`,
    {
      userID,
      platformID,
    },
    `im_user_token_${userID}_${platformID}_${suffix}`,
    imAdminToken,
  );
  assertOK(resp, `get user token ${userID} platform ${platformID}`);
  const token = readString(resp.data.token);
  if (token.length === 0) {
    throw new Error(`get user token returned empty token for ${userID} platform ${platformID}: ${resp.raw}`);
  }
  return token;
}

async function validateToken(userID, platformID, token, suffix) {
  const resp = await postJson(
    `${trimBaseURL(OPENIM_API_BASE)}/auth/parse_token`,
    { token },
    `parse_token_${userID}_${platformID}_${suffix}`,
  );
  assertOK(resp, `parse token ${userID} platform ${platformID}`);
  const parsedUserID = readString(resp.data.userID);
  const parsedPlatformID = readNumber(resp.data.platformID, 0);
  if (parsedUserID !== userID || parsedPlatformID !== platformID) {
    throw new Error(`parse token mismatch for ${userID} platform ${platformID}: ${resp.raw}`);
  }
}

async function registerAccount(account, imAdminToken, suffix) {
  const userID = await registerViaOpenIM(account, imAdminToken, suffix);
  const imTokens = {};
  for (const platformID of PLATFORM_IDS) {
    const imToken = await getUserToken(userID, platformID, imAdminToken, suffix);
    await validateToken(userID, platformID, imToken, suffix);
    imTokens[String(platformID)] = imToken;
  }
  return {
    userID,
    platformIDs: PLATFORM_IDS,
    imTokens,
  };
}

function readAccountToken(account, platformID) {
  return readString(account.imTokens[String(platformID)]);
}

async function main() {
  const suffix = createSuffix();
  const primaryAccount = `${ACCOUNT_PREFIX}${suffix}a`;
  const secondaryAccount = `${ACCOUNT_PREFIX}${suffix}b`;
  const lanIP = getLocalLANIP();
  const sdkApiBase = OPENIM_SDK_API_BASE.length > 0 ? OPENIM_SDK_API_BASE : OPENIM_API_BASE;
  const sdkWsBase = OPENIM_SDK_WS_BASE.length > 0 ? OPENIM_SDK_WS_BASE : OPENIM_WS_BASE;

  const imAdminToken = await getIMAdminToken(suffix);
  const primary = await registerAccount(primaryAccount, imAdminToken, suffix);
  const secondary = await registerAccount(secondaryAccount, imAdminToken, suffix);

  const output = {
    source: 'openim-test-fixture',
    generatedAt: new Date().toISOString(),
    localLANIP: lanIP,
    apiAddr: toDeviceBaseURL(sdkApiBase, lanIP),
    wsAddr: toDeviceBaseURL(sdkWsBase, lanIP),
    platformIDs: PLATFORM_IDS,
    platformID: PLATFORM_IDS.length === 1 ? PLATFORM_IDS[0] : 0,
    primaryUserID: primary.userID,
    primaryToken: readAccountToken(primary, PLATFORM_IDS[0]),
    primaryIOSToken: readAccountToken(primary, 1),
    primaryAndroidToken: readAccountToken(primary, 2),
    secondaryUserID: secondary.userID,
    secondaryToken: readAccountToken(secondary, PLATFORM_IDS[0]),
    secondaryIOSToken: readAccountToken(secondary, 1),
    secondaryAndroidToken: readAccountToken(secondary, 2),
    accounts: {
      primary,
      secondary,
    },
  };

  writeJSONFile(OUTPUT, output);
  writeJSONFile(STATIC_OUTPUT, {
    source: output.source,
    generatedAt: output.generatedAt,
    autorun: AUTORUN,
    localLANIP: output.localLANIP,
    apiAddr: output.apiAddr,
    wsAddr: output.wsAddr,
    platformID: output.platformID,
    primaryIOSToken: output.primaryIOSToken,
    primaryAndroidToken: output.primaryAndroidToken,
    primaryUserID: output.primaryUserID,
    primaryToken: output.primaryToken,
    secondaryIOSToken: output.secondaryIOSToken,
    secondaryAndroidToken: output.secondaryAndroidToken,
    secondaryUserID: output.secondaryUserID,
    secondaryToken: output.secondaryToken,
  });

  console.log(JSON.stringify({
    output: OUTPUT,
    staticOutput: STATIC_OUTPUT,
    localLANIP: output.localLANIP,
    apiAddr: output.apiAddr,
    wsAddr: output.wsAddr,
    platformIDs: output.platformIDs,
    primaryUserID: output.primaryUserID,
    secondaryUserID: output.secondaryUserID,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
