import * as vscode from 'vscode';
import { initStatusBar } from './statusBar';
import { registerCommands } from './commands';
import { checkGuardrail } from './guardrail';

export function activate(context: vscode.ExtensionContext): void {
  initStatusBar(context);
  registerCommands(context);

  // Guardrail runs on startup and whenever the workspace folder set changes
  // (e.g. switching from one repo window to another via "Open Recent").
  checkGuardrail(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => checkGuardrail(context))
  );
}

export function deactivate(): void {
  // No teardown needed — profiles and secrets live outside the extension's
  // own lifecycle (in ~/.ccp and macOS Keychain respectively).
}
