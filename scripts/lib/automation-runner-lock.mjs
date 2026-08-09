import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const lockEnvironmentName = 'OPENIM_AUTOMATION_RUNNER_LOCK_PATH';
const lockfTemporaryFailureExitCode = 75;

export function automationRunnerLockPath(projectRoot) {
  return resolve(projectRoot, 'test-results/openim-automation/run-openim-automation.lock');
}

export function runUnderAutomationRunnerLock({
  projectRoot,
  argv = process.argv,
  env = process.env,
  execPath = process.execPath,
  osPlatform = process.platform,
  lockfPath = '/usr/bin/lockf',
  spawnSyncImpl = spawnSync,
}) {
  const lockPath = automationRunnerLockPath(projectRoot);
  if (env[lockEnvironmentName] === lockPath) {
    return null;
  }
  if (osPlatform !== 'darwin') {
    throw new Error(`automation runner locking requires macOS lockf; unsupported host platform: ${osPlatform}`);
  }
  if (!existsSync(lockfPath)) {
    throw new Error(`automation runner locking requires lockf: ${lockfPath}`);
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  const result = spawnSyncImpl(
    lockfPath,
    ['-k', '-t', '0', lockPath, execPath, ...argv.slice(1)],
    {
      cwd: projectRoot,
      env: { ...env, [lockEnvironmentName]: lockPath },
      stdio: 'inherit',
    },
  );
  if (result.error != null) {
    throw new Error(`failed to start automation runner under lockf: ${result.error.message}`);
  }
  if (result.status === lockfTemporaryFailureExitCode) {
    throw new Error(`another automation runner holds the project lock: ${lockPath}`);
  }
  if (result.signal != null) {
    throw new Error(`automation runner under lockf terminated by ${result.signal}`);
  }
  if (!Number.isInteger(result.status)) {
    throw new Error(`automation runner under lockf returned no exit status: ${lockPath}`);
  }
  return result.status;
}
