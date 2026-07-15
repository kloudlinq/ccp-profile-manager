import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Constant service name so every secret this tool ever stores is grouped
// under one Keychain entry family — easy to find/audit in Keychain Access.
const SERVICE = 'ccp-profile-manager';

if (process.platform !== 'darwin') {
  // Fail loudly at import time rather than surfacing a confusing "security:
  // command not found" deep inside a profile switch.
  // eslint-disable-next-line no-console
  console.warn(
    '[ccp] keychain.ts uses the macOS `security` CLI. On non-macOS platforms, ' +
      'secret storage will fail. Only subscription and cloud-provider profiles ' +
      '(which need no locally stored secret) will work.'
  );
}

export interface KeychainRef {
  /** Unique per-profile account name, e.g. "personal-api-key" */
  account: string;
}

export async function setSecret(account: string, secret: string): Promise<void> {
  // -U updates in place if it already exists, so re-running create/login is idempotent.
  await execFileAsync('security', [
    'add-generic-password',
    '-a', account,
    '-s', SERVICE,
    '-w', secret,
    '-U',
  ]);
}

export async function getSecret(account: string): Promise<string> {
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-a', account,
    '-s', SERVICE,
    '-w',
  ]);
  return stdout.trim();
}

export async function deleteSecret(account: string): Promise<void> {
  try {
    await execFileAsync('security', [
      'delete-generic-password',
      '-a', account,
      '-s', SERVICE,
    ]);
  } catch {
    // Already gone — not an error for our purposes.
  }
}
