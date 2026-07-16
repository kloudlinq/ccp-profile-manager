import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ProfileConfig } from './types';

interface McpSourceFile {
  mcpServers?: Record<string, unknown>;
}

interface ClaudeStateFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * User-scope MCP servers live in <claudeConfigDir>/.claude.json (top-level
 * "mcpServers" key) — NOT settings.json, which Claude Code ignores for MCP
 * config. Verified live: a settings.json mcpServers block produces
 * "No MCP servers configured" from `claude mcp list`, while the same block in
 * .claude.json is picked up, and `claude mcp add -s user` itself writes there.
 */
function mcpTargetPath(profile: ProfileConfig): string {
  return path.join(profile.claudeConfigDir, '.claude.json');
}

/**
 * Full-replaces the mcpServers block in <claudeConfigDir>/.claude.json with
 * whatever's in sourcePath. This is a deliberate replace, not a merge — a
 * profile's MCP set should be exactly what you configured for it, not an
 * accumulation of whatever's ever been applied. Isolation itself already
 * comes for free from each profile having its own CLAUDE_CONFIG_DIR; this
 * just makes populating it a one-line operation instead of hand-editing JSON.
 *
 * .claude.json also holds Claude Code's own state (onboarding flags, project
 * history, OAuth account info) — everything outside the mcpServers key is
 * preserved untouched.
 */
export async function applyMcpServers(profile: ProfileConfig, sourcePath: string): Promise<void> {
  const sourceRaw = await fs.readFile(sourcePath, 'utf8');
  const source: McpSourceFile = JSON.parse(sourceRaw);
  if (!source.mcpServers) {
    throw new Error(`${sourcePath} has no top-level "mcpServers" key — expected { "mcpServers": { "<name>": { "command": ... } } }.`);
  }

  const targetPath = mcpTargetPath(profile);
  await fs.mkdir(profile.claudeConfigDir, { recursive: true, mode: 0o700 });

  let existing: ClaudeStateFile = {};
  try {
    existing = JSON.parse(await fs.readFile(targetPath, 'utf8'));
  } catch {
    // No .claude.json yet for this profile — starting fresh is fine.
  }

  existing.mcpServers = source.mcpServers;
  // 0600 like Claude Code's own writes — this file can contain account info.
  await fs.writeFile(targetPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

export async function currentMcpServerNames(profile: ProfileConfig): Promise<string[]> {
  try {
    const existing: ClaudeStateFile = JSON.parse(await fs.readFile(mcpTargetPath(profile), 'utf8'));
    return Object.keys(existing.mcpServers ?? {});
  } catch {
    return [];
  }
}
