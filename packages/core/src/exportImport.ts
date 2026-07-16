import { AuthType, ProfileConfig } from './types';
import { getProfile, defaultConfigDirFor } from './profileStore';
import { ask, askSecret } from './prompt';
import { runInteractiveLoginForImport } from './authFlows';
import { finalizeNewProfile } from './profileFactory';

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
 *
 * Delegates to finalizeNewProfile — the same persistence path as `create` on
 * both surfaces — so imports get identical behavior (name validation, config
 * dir creation, OpenRouter statusLine) instead of a parallel implementation.
 */
export async function finalizeImportedProfile(
  exported: ExportedProfile,
  secrets: ImportSecrets
): Promise<ProfileConfig> {
  if (await getProfile(exported.name)) {
    throw new Error(`Profile "${exported.name}" already exists on this machine. Rename it in the export file first.`);
  }

  const { profile } = await finalizeNewProfile({
    name: exported.name,
    authType: exported.authType,
    apiKey: secrets.apiKey,
    gatewayBaseUrl: exported.gatewayBaseUrl,
    gatewayToken: secrets.gatewayToken,
    gatewayModel: exported.gatewayModel,
    awsProfile: secrets.awsProfile,
    awsRegion: exported.awsRegion,
    vertexProject: secrets.vertexProject,
    vertexRegion: exported.vertexRegion,
    foundryResource: secrets.foundryResource,
    mcpConfigSource: exported.mcpConfigSource,
  });
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
