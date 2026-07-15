import * as vscode from 'vscode';
import { ProfileConfig, resolveEnv, KNOWN_ROUTING_VARS } from '@kloudlinq/ccp-core';
import { setActiveProfileName } from './statusBar';

/**
 * `claudeCode.environmentVariables` is declared with "scope": "application"
 * by the official extension — VS Code enforces application scope as
 * User-settings-only at the core level; attempting Workspace or
 * WorkspaceFolder target throws "can be written only into User settings."
 * This isn't a design choice on our end, it's a hard restriction with no
 * workaround: the panel's env is always machine-wide, for every auth type,
 * across every open window. (An earlier version of this file assumed
 * non-secret profile types could get Workspace-scoped isolation — that was
 * wrong, confirmed by VS Code's own error, not just untested.)
 *
 * Real per-context parallelism only exists on the terminal side, via the
 * shell wrapper function, which is genuinely per-shell.
 */
export async function applyProfile(context: vscode.ExtensionContext, profile: ProfileConfig): Promise<void> {
  const resolved = await resolveEnv(profile);

  const envArray = Object.entries(resolved.set)
    .filter(([k]) => k !== 'CLAUDE_CONFIG_DIR') // set separately below, matches CLI convention
    .map(([name, value]) => ({ name, value }));

  // CLAUDE_CONFIG_DIR always included, so the panel's `claude` process picks
  // up the right settings.json / MCP servers / credentials.json for this profile.
  envArray.push({ name: 'CLAUDE_CONFIG_DIR', value: profile.claudeConfigDir });

  const config = vscode.workspace.getConfiguration();
  await config.update('claudeCode.environmentVariables', envArray, vscode.ConfigurationTarget.Global);

  await setActiveProfileName(context, profile.name, profile.authType);

  const choice = await vscode.window.showInformationMessage(
    `Claude Code profile switched to "${profile.name}" (applies to ALL open VS Code windows' panels — this setting is User-scoped only). The panel must reload to pick up the change.`,
    'Reload Window',
    'Later'
  );
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

export { KNOWN_ROUTING_VARS };
