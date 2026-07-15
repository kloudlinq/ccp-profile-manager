import { ProfileConfig, KNOWN_ROUTING_VARS } from './types';
import { getSecret } from './keychain';

export interface ResolvedEnv {
  /** Vars that must be unset before applying (full reset, avoids precedence bugs) */
  unset: readonly string[];
  /** Vars to set for this profile, in addition to CLAUDE_CONFIG_DIR */
  set: Record<string, string>;
  /** True if this profile is subscription-based and may require a /logout
   *  inside `claude` before switching AWAY from it, if credentials.json in
   *  its own CLAUDE_CONFIG_DIR was ever polluted by a stray token var. */
  isSubscription: boolean;
}

/**
 * Resolves the full environment for a profile. Always includes every known
 * routing var in `unset` — Claude Code's credential precedence (cloud creds >
 * ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > OAuth/subscription)
 * means a stray leftover var from a previous profile silently wins otherwise.
 */
export async function resolveEnv(profile: ProfileConfig): Promise<ResolvedEnv> {
  const set: Record<string, string> = {
    CLAUDE_CONFIG_DIR: profile.claudeConfigDir,
  };

  switch (profile.authType) {
    case 'subscription':
      // No routing vars — credentials.json inside claudeConfigDir handles it.
      break;

    case 'api_key': {
      const key = await getSecret(profile.keychainAccount!);
      set.ANTHROPIC_API_KEY = key;
      break;
    }

    case 'gateway': {
      const token = await getSecret(profile.keychainAccount!);
      set.ANTHROPIC_BASE_URL = profile.gatewayBaseUrl!;
      set.ANTHROPIC_AUTH_TOKEN = token;
      // Must be explicitly empty, not merely unset, or Claude Code can fall
      // back to default Anthropic auth behavior instead of the gateway.
      set.ANTHROPIC_API_KEY = '';
      if (profile.gatewayModel) set.ANTHROPIC_MODEL = profile.gatewayModel;
      break;
    }

    case 'bedrock':
      set.CLAUDE_CODE_USE_BEDROCK = '1';
      if (profile.awsRegion) set.AWS_REGION = profile.awsRegion;
      if (profile.awsProfile) set.AWS_PROFILE = profile.awsProfile;
      break;

    case 'vertex':
      set.CLAUDE_CODE_USE_VERTEX = '1';
      if (profile.vertexProject) set.ANTHROPIC_VERTEX_PROJECT_ID = profile.vertexProject;
      if (profile.vertexRegion) set.CLOUD_ML_REGION = profile.vertexRegion;
      break;

    case 'foundry':
      set.CLAUDE_CODE_USE_FOUNDRY = '1';
      if (profile.foundryResource) set.ANTHROPIC_FOUNDRY_RESOURCE = profile.foundryResource;
      break;
  }

  return {
    unset: KNOWN_ROUTING_VARS,
    set,
    isSubscription: profile.authType === 'subscription',
  };
}

/**
 * Renders a POSIX-shell snippet that unsets every known routing var, then
 * exports the resolved set. Meant to be `eval`'d by the shell wrapper
 * function (see shell/ccp-init.zsh) — a plain child process cannot mutate
 * its parent shell's environment, so this text is the actual interface.
 */
export function toShellScript(resolved: ResolvedEnv, profileName: string): string {
  const lines: string[] = [];
  for (const v of resolved.unset) lines.push(`unset ${v}`);
  for (const [k, v] of Object.entries(resolved.set)) {
    lines.push(`export ${k}=${JSON.stringify(v)}`);
  }
  lines.push(`export CCP_ACTIVE_PROFILE=${JSON.stringify(profileName)}`);
  if (resolved.isSubscription) {
    lines.push(
      `echo "[ccp] Switched to '${profileName}' (subscription). If Claude Code reports auth conflicts, run /logout then /login once inside this profile." >&2`
    );
  }
  return lines.join('\n');
}
