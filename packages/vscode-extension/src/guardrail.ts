import * as vscode from 'vscode';
import { getProfile } from '@kloudlinq/ccp-core';
import { getActiveProfileName } from './statusBar';
import { getExpectedProfile } from './workspacePin';
import { applyProfile } from './applyProfile';

/**
 * Runs on activation and whenever the workspace folder set changes. If the
 * workspace declares an expected profile (via "Pin This Workspace To...")
 * and it doesn't match the (genuinely machine-wide, per VS Code's own
 * User-settings-only restriction on this setting) active profile, stop and
 * ask — never silently proceed and never silently switch.
 */
export async function checkGuardrail(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const expected = await getExpectedProfile(folder);
  if (!expected) return; // workspace isn't pinned — nothing to guard

  const active = getActiveProfileName(context);
  if (active === expected) return; // already correct

  const choice = await vscode.window.showWarningMessage(
    `This workspace is pinned to Claude profile "${expected}", but "${active ?? 'none'}" is currently active. ` +
      `Continuing could route this project's Claude Code sessions through the wrong account or billing.`,
    { modal: true },
    `Switch to "${expected}"`,
    'Continue Anyway'
  );

  if (choice === `Switch to "${expected}"`) {
    const profile = await getProfile(expected);
    if (profile) {
      await applyProfile(context, profile);
    } else {
      vscode.window.showErrorMessage(`Pinned profile "${expected}" no longer exists. Use "Claude Profile: Manage..." to fix this workspace's pin.`);
    }
  }
  // "Continue Anyway" or dismiss: do nothing further, but the mismatch was
  // surfaced explicitly rather than silently ignored.
}
