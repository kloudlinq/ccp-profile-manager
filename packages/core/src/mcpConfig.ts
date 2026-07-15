import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ProfileConfig } from './types';

interface McpSourceFile {
  mcpServers?: Record<string, unknown>;
}

interface ClaudeSettingsFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Full-replaces the mcpServers block in <claudeConfigDir>/settings.json with
 * whatever's in sourcePath. This is a deliberate replace, not a merge — a
 * profile's MCP set should be exactly what you configured for it, not an
 * accumulation of whatever's ever been applied. Isolation itself already
 * comes for free from each profile having its own CLAUDE_CONFIG_DIR (and
 * therefore its own settings.json); this just makes populating that file
 * for a given profile a one-line operation instead of hand-editing JSON.
 */
export async function applyMcpServers(profile: ProfileConfig, sourcePath: string): Promise<void> {
  const sourceRaw = await fs.readFile(sourcePath, 'utf8');
  const source: McpSourceFile = JSON.parse(sourceRaw);
  if (!source.mcpServers) {
    throw new Error(`${sourcePath} has no top-level "mcpServers" key — expected the same shape as Claude Code's settings.json.`);
  }

  const settingsPath = path.join(profile.claudeConfigDir, 'settings.json');
  await fs.mkdir(profile.claudeConfigDir, { recursive: true, mode: 0o700 });

  let existing: ClaudeSettingsFile = {};
  try {
    existing = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    // No settings.json yet for this profile — starting fresh is fine.
  }

  existing.mcpServers = source.mcpServers;
  await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
}

export async function currentMcpServerNames(profile: ProfileConfig): Promise<string[]> {
  const settingsPath = path.join(profile.claudeConfigDir, 'settings.json');
  try {
    const existing: ClaudeSettingsFile = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    return Object.keys(existing.mcpServers ?? {});
  } catch {
    return [];
  }
}
