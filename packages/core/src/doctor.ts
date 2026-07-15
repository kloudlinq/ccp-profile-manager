import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ProfileConfig } from './types';
import { getSecret } from './keychain';

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
}

async function checkClaudeBinary(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('claude', ['--version']);
    return { label: 'claude binary on PATH', ok: true, detail: stdout.trim() };
  } catch {
    return { label: 'claude binary on PATH', ok: false, detail: '`claude` did not resolve — check PATH or standalone CLI install' };
  }
}

async function checkConfigDir(profile: ProfileConfig): Promise<DoctorCheck> {
  try {
    await fs.access(profile.claudeConfigDir);
    return { label: 'CLAUDE_CONFIG_DIR exists', ok: true, detail: profile.claudeConfigDir };
  } catch {
    return {
      label: 'CLAUDE_CONFIG_DIR exists',
      ok: false,
      detail: `${profile.claudeConfigDir} not found — run "ccp create" or complete /login once`,
    };
  }
}

async function checkSubscriptionCreds(profile: ProfileConfig): Promise<DoctorCheck> {
  const credsPath = path.join(profile.claudeConfigDir, 'credentials.json');
  try {
    await fs.access(credsPath);
    return { label: 'credentials.json present', ok: true, detail: credsPath };
  } catch {
    return {
      label: 'credentials.json present',
      ok: false,
      detail: 'Not found — run `claude` under this profile and complete /login',
    };
  }
}

async function checkKeychainSecret(account: string, label: string): Promise<DoctorCheck> {
  try {
    const secret = await getSecret(account);
    return { label, ok: secret.length > 0, detail: secret.length > 0 ? 'retrieved OK' : 'empty value stored' };
  } catch {
    return { label, ok: false, detail: `Keychain lookup failed for account "${account}" — re-run "ccp create" for this profile` };
  }
}

async function checkAwsSession(awsProfile: string): Promise<DoctorCheck> {
  try {
    await execFileAsync('aws', ['sts', 'get-caller-identity', '--profile', awsProfile]);
    return { label: `AWS session (${awsProfile})`, ok: true, detail: 'valid' };
  } catch {
    return {
      label: `AWS session (${awsProfile})`,
      ok: false,
      detail: `Not valid or expired — run: aws sso login --profile ${awsProfile}`,
    };
  }
}

async function checkGcloudSession(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('gcloud', [
      'auth', 'list', '--filter=status:ACTIVE', '--format=value(account)',
    ]);
    const ok = stdout.trim().length > 0;
    return { label: 'gcloud active session', ok, detail: ok ? stdout.trim() : 'No active account — run: gcloud auth login' };
  } catch {
    return { label: 'gcloud active session', ok: false, detail: '`gcloud` not found or not authenticated' };
  }
}

async function checkAzSession(): Promise<DoctorCheck> {
  try {
    await execFileAsync('az', ['account', 'show']);
    return { label: 'az active session', ok: true, detail: 'valid' };
  } catch {
    return { label: 'az active session', ok: false, detail: 'Not signed in — run: az login' };
  }
}

export async function runDoctor(profile: ProfileConfig): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [await checkClaudeBinary(), await checkConfigDir(profile)];

  switch (profile.authType) {
    case 'subscription':
      checks.push(await checkSubscriptionCreds(profile));
      break;
    case 'api_key':
      if (profile.keychainAccount) checks.push(await checkKeychainSecret(profile.keychainAccount, 'API key in Keychain'));
      break;
    case 'gateway':
      if (profile.keychainAccount) checks.push(await checkKeychainSecret(profile.keychainAccount, 'Gateway token in Keychain'));
      break;
    case 'bedrock':
      if (profile.awsProfile) checks.push(await checkAwsSession(profile.awsProfile));
      break;
    case 'vertex':
      checks.push(await checkGcloudSession());
      break;
    case 'foundry':
      checks.push(await checkAzSession());
      break;
  }

  return checks;
}
