import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProfileConfig } from './types';

const CCP_HOME = path.join(os.homedir(), '.ccp');
const PROFILES_DIR = path.join(CCP_HOME, 'profiles');

async function ensureDirs(): Promise<void> {
  await fs.mkdir(PROFILES_DIR, { recursive: true, mode: 0o700 });
}

function profilePath(name: string): string {
  return path.join(PROFILES_DIR, `${name}.json`);
}

export async function listProfiles(): Promise<ProfileConfig[]> {
  await ensureDirs();
  const files = await fs.readdir(PROFILES_DIR).catch(() => [] as string[]);
  const profiles: ProfileConfig[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(PROFILES_DIR, f), 'utf8');
    profiles.push(JSON.parse(raw));
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProfile(name: string): Promise<ProfileConfig | null> {
  try {
    const raw = await fs.readFile(profilePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveProfile(profile: ProfileConfig): Promise<void> {
  await ensureDirs();
  profile.updatedAt = new Date().toISOString();
  await fs.writeFile(profilePath(profile.name), JSON.stringify(profile, null, 2), {
    mode: 0o600,
  });
}

export async function deleteProfile(name: string): Promise<void> {
  await fs.rm(profilePath(name), { force: true });
}

export function defaultConfigDirFor(name: string): string {
  return path.join(os.homedir(), `.claude-${name}`);
}
