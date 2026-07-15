import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ProfileConfig } from './types';

interface ClaudeSettingsFile {
  statusLine?: { type: string; command: string };
  [key: string]: unknown;
}

// Uses python3 rather than jq, since python3 is the more reliably-present
// tool for one-off JSON parsing in ad hoc shell commands. $ANTHROPIC_AUTH_TOKEN
// is already exported into this profile's environment whenever `claude` runs
// under it, so the statusLine command can read it directly — no secret needs
// to be duplicated into settings.json to make this work.
const OPENROUTER_STATUSLINE_COMMAND =
  'curl -s "https://openrouter.ai/api/v1/auth/key" -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" ' +
  '| python3 -c "import json,sys; d=json.load(sys.stdin); print(f\\"OpenRouter: \\${d[\'data\'][\'usage\']:.2f} used\\")" 2>/dev/null';

export function isOpenRouterGateway(profile: ProfileConfig): boolean {
  return profile.authType === 'gateway' && !!profile.gatewayBaseUrl?.includes('openrouter.ai');
}

/**
 * Only meaningful for OpenRouter today — its /auth/key endpoint is what
 * makes this cheap to implement. Other gateways (Requesty, Z.AI, etc.) would
 * need their own usage-endpoint mapping; this deliberately no-ops for them
 * rather than guessing at an endpoint shape that hasn't been verified.
 */
export async function applyCostStatusLine(profile: ProfileConfig): Promise<'applied' | 'skipped'> {
  if (!isOpenRouterGateway(profile)) return 'skipped';

  const settingsPath = path.join(profile.claudeConfigDir, 'settings.json');
  await fs.mkdir(profile.claudeConfigDir, { recursive: true, mode: 0o700 });

  let existing: ClaudeSettingsFile = {};
  try {
    existing = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    // fresh settings.json
  }

  existing.statusLine = { type: 'command', command: OPENROUTER_STATUSLINE_COMMAND };
  await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
  return 'applied';
}
