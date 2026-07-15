export type AuthType =
  | 'subscription' // claude.ai Pro/Max/Team/Enterprise via /login OAuth
  | 'api_key'       // direct ANTHROPIC_API_KEY billing
  | 'gateway'       // OpenRouter / Requesty / Z.AI / any Anthropic-compatible endpoint
  | 'bedrock'
  | 'vertex'
  | 'foundry';

/**
 * A profile is a full, isolated Claude Code identity: its own CLAUDE_CONFIG_DIR
 * (credentials, settings.json, MCP servers, CLAUDE.md, session history) plus
 * whatever env vars are needed to route auth for its type.
 *
 * Secrets (API keys, gateway tokens) are never stored here — only a keychain
 * account reference. Subscription auth needs no secret reference at all; it
 * lives in credentials.json inside claudeConfigDir, written by `claude`'s own
 * OAuth flow.
 */
export interface ProfileConfig {
  name: string;
  authType: AuthType;
  claudeConfigDir: string;

  // gateway-specific
  gatewayBaseUrl?: string;
  gatewayModel?: string;

  // bedrock-specific
  awsProfile?: string;
  awsRegion?: string;

  // vertex-specific
  vertexProject?: string;
  vertexRegion?: string;

  // foundry-specific
  foundryResource?: string;

  // optional: path to a directory of MCP server definitions / settings.json
  // fragment to seed into claudeConfigDir on creation
  mcpConfigSource?: string;

  // macOS Keychain account name holding the secret for api_key/gateway types.
  // Service name is always constant (see keychain.ts). Never the secret itself.
  keychainAccount?: string;

  owner: string; // OS username that created this profile
  createdAt: string;
  updatedAt: string;
}

export const KNOWN_ROUTING_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'AWS_REGION',
  'AWS_PROFILE',
  'CLAUDE_CONFIG_DIR',
] as const;
