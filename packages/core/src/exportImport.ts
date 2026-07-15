import * as os from 'node:os';
import { AuthType, ProfileConfig } from './types';
import { getProfile, saveProfile, defaultConfigDirFor } from './profileStore';
import { setSecret } from './keychain';
import { ask, askSecret } from './prompt';
import { runInteractiveLoginForImport } from './authFlows';

/**
 * Everything about a profile EXCEPT: the machine-specific claudeConfigDir
 * path, the keychain account reference (meaningless off this machine), and
 * the secret itself. This is deliberately the whole point — "anyone else"
 * picking this up still has to do their own login or key entry; what they
 * don't have to do is re-derive the auth type, gateway URL, model slug, or
 * cloud region by hand.
 */
export interface ExportedProfile {
  name: string;
  authType: AuthType;
  gatewayBaseUrl?: string;
  gatewayModel?: string;
  awsRegion?: string;
  vertexRegion?: string;
  mcpConfigSource?: string;
  // awsProfile / vertexProject / foundryResource intentionally omitted —
  // these usually differ per person/machine even for "the same" logical
  // profile, so they're re-collected on import rather than copied blind.
}

export async function exportProfile(name: string): Promise<ExportedProfile> {
  const profile = await getProfile(name);
  if (!profile) throw new Error(`No such profile: ${name}`);
  return {
    name: profile.name,
    authType: profile.authType,
    gatewayBaseUrl: profile.gatewayBaseUrl,
    gatewayModel: profile.gatewayModel,
    awsRegion: profile.awsRegion,
    vertexRegion: profile.vertexRegion,
    mcpConfigSource: profile.mcpConfigSource,
  };
}

/** Everything an import needs to finish, collected however the calling
 *  surface (CLI readline, VS Code showInputBox) chooses to collect it. */
export interface ImportSecrets {
  apiKey?: string;       // for authType 'api_key'
  gatewayToken?: string; // for authType 'gateway'
  awsProfile?: string;
  vertexProject?: string;
  foundryResource?: string;
}

/**
 * Pure persistence step — no stdin, no spawned terminal, no assumption about
 * where secrets came from. Safe to call from the CLI, the VSIX, or a test.
 * Subscription-type profiles are NOT finished here: OAuth needs a real TTY
 * (CLI) or an integrated terminal (VSIX), so each surface drives that part
 * itself and calls this only for the non-interactive types.
 */
export async function finalizeImportedProfile(
  exported: ExportedProfile,
  secrets: ImportSecrets
): Promise<ProfileConfig> {
  const existing = await getProfile(exported.name);
  if (existing) {
    throw new Error(`Profile "${exported.name}" already exists on this machine. Rename it in the export file first.`);
  }

  const claudeConfigDir = defaultConfigDirFor(exported.name);
  const now = new Date().toISOString();
  const profile: ProfileConfig = {
    name: exported.name,
    authType: exported.authType,
    claudeConfigDir,
    owner: os.userInfo().username,
    gatewayBaseUrl: exported.gatewayBaseUrl,
    gatewayModel: exported.gatewayModel,
    awsRegion: exported.awsRegion,
    vertexRegion: exported.vertexRegion,
    mcpConfigSource: exported.mcpConfigSource,
    createdAt: now,
    updatedAt: now,
  };

  switch (exported.authType) {
    case 'api_key': {
      if (!secrets.apiKey) throw new Error('apiKey required for authType "api_key"');
      const account = `${exported.name}-api-key`;
      await setSecret(account, secrets.apiKey);
      profile.keychainAccount = account;
      break;
    }
    case 'gateway': {
      if (!secrets.gatewayToken) throw new Error('gatewayToken required for authType "gateway"');
      const account = `${exported.name}-gateway-token`;
      await setSecret(account, secrets.gatewayToken);
      profile.keychainAccount = account;
      break;
    }
    case 'bedrock':
      profile.awsProfile = secrets.awsProfile;
      break;
    case 'vertex':
      profile.vertexProject = secrets.vertexProject;
      break;
    case 'foundry':
      profile.foundryResource = secrets.foundryResource;
      break;
    case 'subscription':
      // Caller must run the OAuth flow (interactive terminal / integrated
      // terminal) against `claudeConfigDir` themselves, before or after this
      // call — credentials.json isn't managed by this function either way.
      break;
  }

  await saveProfile(profile);
  return profile;
}

/** CLI-only convenience: prompts on stdin/stdout for whatever the auth type
 *  needs, including the interactive OAuth spawn for subscription profiles. */
export async function importProfileInteractiveCli(exported: ExportedProfile): Promise<ProfileConfig> {
  if (exported.authType === 'subscription') {
    const claudeConfigDir = defaultConfigDirFor(exported.name);
    await runInteractiveLoginForImport(claudeConfigDir);
    return finalizeImportedProfile(exported, {});
  }

  const secrets: ImportSecrets = {};
  switch (exported.authType) {
    case 'api_key':
      secrets.apiKey = await askSecret('Anthropic API key for this profile');
      break;
    case 'gateway':
      secrets.gatewayToken = await askSecret(`Gateway token for ${exported.gatewayBaseUrl ?? '(base URL from export)'}`);
      break;
    case 'bedrock':
      secrets.awsProfile = await ask('AWS profile name on this machine (never "default")');
      break;
    case 'vertex':
      secrets.vertexProject = await ask('GCP project ID on this machine');
      break;
    case 'foundry':
      secrets.foundryResource = await ask('Foundry resource name on this machine');
      break;
  }
  return finalizeImportedProfile(exported, secrets);
}
