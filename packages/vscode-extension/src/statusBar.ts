import * as vscode from 'vscode';

const ACTIVE_PROFILE_KEY = 'ccp.activeProfile';
const ACTIVE_AUTHTYPE_KEY = 'ccp.activeAuthType';

let item: vscode.StatusBarItem;

export function initStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'ccp.switchProfile';
  context.subscriptions.push(item);
  refreshStatusBar(context);
  return item;
}

/**
 * globalState, not workspaceState: `claudeCode.environmentVariables` is
 * "application"-scoped by the extension itself, which VS Code hard-restricts
 * to User settings — the panel's active profile genuinely IS machine-wide,
 * across every open window. Tracking it per-window would just be tracking a
 * belief that doesn't match reality. (This file previously used
 * workspaceState on the assumption that non-secret profile types could get
 * real per-window isolation — confirmed wrong by VS Code's own error when
 * writing at Workspace scope.)
 */
export function getActiveProfileName(context: vscode.ExtensionContext): string | undefined {
  return context.globalState.get<string>(ACTIVE_PROFILE_KEY);
}

export async function setActiveProfileName(
  context: vscode.ExtensionContext,
  name: string,
  authType: string
): Promise<void> {
  await context.globalState.update(ACTIVE_PROFILE_KEY, name);
  await context.globalState.update(ACTIVE_AUTHTYPE_KEY, authType);
  refreshStatusBar(context);
}

export function refreshStatusBar(context: vscode.ExtensionContext): void {
  const name = getActiveProfileName(context);
  const authType = context.globalState.get<string>(ACTIVE_AUTHTYPE_KEY);
  item.text = name ? `$(account) Claude: ${name}` : '$(account) Claude: no profile';
  item.tooltip = name
    ? `Active Claude Code profile (all windows): ${name} (${authType})\nClick to switch.`
    : 'Click to select a Claude Code profile.';
  item.show();
}
