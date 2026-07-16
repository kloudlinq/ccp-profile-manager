import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import { AuthType, ProfileConfig } from './types';
import { setSecret } from './keychain';
import { getProfile, saveProfile, defaultConfigDirFor } from './profileStore';
import { applyCostStatusLine } from './statusLine';

/**
 * Profile names become both a filename (~/.ccp/profiles/<name>.json) and a
 * directory (~/.claude-<name>), so the character set is restricted to rule
 * out path traversal and shell-quoting surprises, not just for aesthetics.
 */
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

/** Returns an error message, or null if the name is acceptable. */
export function validateProfileName(name: string): string | null {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    return 'Profile names may only contain letters, numbers, and hyphens, and must start with a letter or number.';
  }
  return null;
}

/**
 * Everything profile creation needs, collected however the calling surface
 * chooses (CLI readline, VS Code InputBox, an import file). Which fields are
 * required depends on authType — finalizeNewProfile enforces that.
 */
export interface NewProfileInput {
  name: string;
  authType: AuthType;
  owner?: string;

  apiKey?: string; // api_key

  gatewayBaseUrl?: string; // gateway
  gatewayToken?: string;
  gatewayModel?: string;

  awsProfile?: string; // bedrock
  awsRegion?: string;

  vertexProject?: string; // vertex
  vertexRegion?: string;

  foundryResource?: string; // foundry

  mcpConfigSource?: string;
}

export interface FinalizeResult {
  profile: ProfileConfig;
  /** 'applied' when an OpenRouter cost statusLine was written to settings.json. */
  costStatusLine: 'applied' | 'skipped';
}

/**
 * The single path every surface goes through to persist a new profile:
 * validate the name, refuse duplicates, store secrets in the Keychain,
 * create the config dir, apply the OpenRouter cost statusLine when relevant,
 * and save the record. The CLI's prompts, the VSIX's InputBoxes, and the
 * import flow all only *collect* input — none of them persist anything
 * themselves, so creation behavior cannot drift between surfaces again.
 *
 * Subscription profiles: the OAuth flow itself is NOT run here — it needs a
 * real TTY (CLI) or an integrated terminal (VSIX), so each surface drives
 * that part before or after this call, against profile.claudeConfigDir.
 */
export async function finalizeNewProfile(input: NewProfileInput): Promise<FinalizeResult> {
  const nameError = validateProfileName(input.name);
  if (nameError) throw new Error(nameError);
  if (await getProfile(input.name)) {
    throw new Error(`Profile "${input.name}" already exists on this machine.`);
  }

  const claudeConfigDir = defaultConfigDirFor(input.name);
  const now = new Date().toISOString();
  const profile: ProfileConfig = {
    name: input.name,
    authType: input.authType,
    claudeConfigDir,
    owner: input.owner ?? os.userInfo().username,
    mcpConfigSource: input.mcpConfigSource,
    createdAt: now,
    updatedAt: now,
  };

  switch (input.authType) {
    case 'subscription':
      // No secret to store — credentials.json is written by `claude`'s own
      // OAuth flow, driven by the calling surface.
      break;

    case 'api_key': {
      if (!input.apiKey) throw new Error('apiKey is required for authType "api_key"');
      const account = `${input.name}-api-key`;
      await setSecret(account, input.apiKey);
      profile.keychainAccount = account;
      break;
    }

    case 'gateway': {
      if (!input.gatewayBaseUrl) throw new Error('gatewayBaseUrl is required for authType "gateway"');
      if (!input.gatewayToken) throw new Error('gatewayToken is required for authType "gateway"');
      const account = `${input.name}-gateway-token`;
      await setSecret(account, input.gatewayToken);
      profile.keychainAccount = account;
      profile.gatewayBaseUrl = input.gatewayBaseUrl;
      if (input.gatewayModel) profile.gatewayModel = input.gatewayModel;
      break;
    }

    case 'bedrock':
      if (input.awsProfile) profile.awsProfile = input.awsProfile;
      if (input.awsRegion) profile.awsRegion = input.awsRegion;
      break;

    case 'vertex':
      if (input.vertexProject) profile.vertexProject = input.vertexProject;
      if (input.vertexRegion) profile.vertexRegion = input.vertexRegion;
      break;

    case 'foundry':
      if (input.foundryResource) profile.foundryResource = input.foundryResource;
      break;
  }

  await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
  const costStatusLine = await applyCostStatusLine(profile);
  await saveProfile(profile);
  return { profile, costStatusLine };
}
