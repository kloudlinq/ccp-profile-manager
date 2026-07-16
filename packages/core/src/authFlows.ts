import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { AuthType, ProfileConfig } from './types';
import { deleteSecret } from './keychain';
import { ask, askSecret } from './prompt';
import { defaultConfigDirFor } from './profileStore';
import { finalizeNewProfile, NewProfileInput } from './profileFactory';

function findClaudeBinary(): string {
  // Assumes `claude` is on PATH (standalone CLI install). The VS Code
  // extension's bundled binary is a separate copy and isn't addressable
  // here — this path is for the CLI/terminal side of the tool.
  return 'claude';
}

export async function runInteractiveLoginForImport(claudeConfigDir: string): Promise<void> {
  return runInteractiveLogin(claudeConfigDir);
}

async function runInteractiveLogin(claudeConfigDir: string): Promise<void> {
  await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
  console.log(
    `\n[ccp] Launching \`claude\` with CLAUDE_CONFIG_DIR=${claudeConfigDir}.\n` +
      `Complete the browser OAuth flow, then type /exit or Ctrl+D to return here.\n`
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(findClaudeBinary(), [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        // Strip any routing vars that might be lingering in the parent shell
        // so the login flow can't accidentally inherit a different profile's route.
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_BASE_URL: undefined,
      } as NodeJS.ProcessEnv,
    });
    child.on('exit', (code) => (code === 0 || code === null ? resolve() : resolve())); // user-driven exit either way
    child.on('error', reject);
  });
}

interface CreateOptions {
  name: string;
  authType: AuthType;
  owner?: string;
}

/**
 * CLI-side creation: collects whatever the auth type needs on stdin/stdout
 * (or runs the interactive OAuth spawn for subscription), then hands
 * everything to finalizeNewProfile — the single shared persistence path,
 * same one the VSIX and the import flow use.
 */
export async function createProfile(opts: CreateOptions): Promise<ProfileConfig> {
  const { name, authType } = opts;
  const input: NewProfileInput = { name, authType, owner: opts.owner };

  switch (authType) {
    case 'subscription': {
      await runInteractiveLogin(defaultConfigDirFor(name));
      break;
    }

    case 'api_key': {
      input.apiKey = await askSecret('Anthropic API key (sk-ant-...)');
      break;
    }

    case 'gateway': {
      input.gatewayBaseUrl = await ask('Gateway base URL', 'https://openrouter.ai/api');
      input.gatewayToken = await askSecret('Gateway API token');
      const model = await ask('Default model slug (blank = leave unset)');
      if (model) input.gatewayModel = model;
      break;
    }

    case 'bedrock': {
      input.awsProfile = await ask('AWS profile name (never "default")');
      input.awsRegion = await ask('AWS region', 'us-east-2');
      console.log(
        '[ccp] No secret stored — Bedrock auth relies on your AWS CLI session ' +
          `(\`aws sso login --profile ${input.awsProfile}\`) being active when you switch to this profile.`
      );
      break;
    }

    case 'vertex': {
      input.vertexProject = await ask('GCP project ID');
      input.vertexRegion = await ask('Vertex region', 'us-central1');
      console.log('[ccp] No secret stored — Vertex auth relies on `gcloud auth login` / ADC.');
      break;
    }

    case 'foundry': {
      input.foundryResource = await ask('Foundry resource name');
      console.log('[ccp] No secret stored — Foundry auth relies on `az login` (Entra ID).');
      break;
    }
  }

  const { profile, costStatusLine } = await finalizeNewProfile(input);
  if (costStatusLine === 'applied') {
    console.log("[ccp] OpenRouter detected — added a cost-usage statusLine to this profile's settings.json.");
  }
  return profile;
}

export async function deleteProfileSecrets(profile: ProfileConfig): Promise<void> {
  if (profile.keychainAccount) {
    await deleteSecret(profile.keychainAccount);
  }
}
