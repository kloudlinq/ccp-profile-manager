import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { promises as fs } from 'node:fs';
import { AuthType, ProfileConfig } from './types';
import { setSecret, deleteSecret } from './keychain';
import { ask, askSecret } from './prompt';
import { defaultConfigDirFor, saveProfile } from './profileStore';
import { applyCostStatusLine } from './statusLine';

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

export async function createProfile(opts: CreateOptions): Promise<ProfileConfig> {
  const { name, authType } = opts;
  const claudeConfigDir = defaultConfigDirFor(name);
  const owner = opts.owner ?? os.userInfo().username;
  const now = new Date().toISOString();

  const profile: ProfileConfig = {
    name,
    authType,
    claudeConfigDir,
    owner,
    createdAt: now,
    updatedAt: now,
  };

  switch (authType) {
    case 'subscription': {
      await runInteractiveLogin(claudeConfigDir);
      break;
    }

    case 'api_key': {
      const key = await askSecret('Anthropic API key (sk-ant-...)');
      const account = `${name}-api-key`;
      await setSecret(account, key);
      profile.keychainAccount = account;
      await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      break;
    }

    case 'gateway': {
      const baseUrl = await ask('Gateway base URL', 'https://openrouter.ai/api');
      const token = await askSecret('Gateway API token');
      const model = await ask('Default model slug (blank = leave unset)');
      const account = `${name}-gateway-token`;
      await setSecret(account, token);
      profile.keychainAccount = account;
      profile.gatewayBaseUrl = baseUrl;
      if (model) profile.gatewayModel = model;
      await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      const statusLineResult = await applyCostStatusLine(profile);
      if (statusLineResult === 'applied') {
        console.log('[ccp] OpenRouter detected — added a cost-usage statusLine to this profile\'s settings.json.');
      }
      break;
    }

    case 'bedrock': {
      profile.awsProfile = await ask('AWS profile name (never "default")');
      profile.awsRegion = await ask('AWS region', 'us-east-2');
      await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      console.log(
        '[ccp] No secret stored — Bedrock auth relies on your AWS CLI session ' +
          `(\`aws sso login --profile ${profile.awsProfile}\`) being active when you switch to this profile.`
      );
      break;
    }

    case 'vertex': {
      profile.vertexProject = await ask('GCP project ID');
      profile.vertexRegion = await ask('Vertex region', 'us-central1');
      await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      console.log('[ccp] No secret stored — Vertex auth relies on `gcloud auth login` / ADC.');
      break;
    }

    case 'foundry': {
      profile.foundryResource = await ask('Foundry resource name');
      await fs.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      console.log('[ccp] No secret stored — Foundry auth relies on `az login` (Entra ID).');
      break;
    }
  }

  await saveProfile(profile);
  return profile;
}

export async function deleteProfileSecrets(profile: ProfileConfig): Promise<void> {
  if (profile.keychainAccount) {
    await deleteSecret(profile.keychainAccount);
  }
}
