import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  AuthType,
  listProfiles,
  getProfile,
  deleteProfile,
  defaultConfigDirFor,
  deleteSecret,
  applyMcpServers,
  currentMcpServerNames,
  runDoctor,
  exportProfile,
  finalizeImportedProfile,
  finalizeNewProfile,
  validateProfileName,
  NewProfileInput,
  ExportedProfile,
} from '@kloudlinq/ccp-core';
import { applyProfile } from './applyProfile';
import { setExpectedProfile } from './workspacePin';

const AUTH_TYPES: { label: string; value: AuthType; detail: string }[] = [
  { label: 'Subscription', value: 'subscription', detail: 'claude.ai Pro / Max / Team / Enterprise — OAuth login' },
  { label: 'API key', value: 'api_key', detail: 'Direct Anthropic API billing' },
  { label: 'Gateway', value: 'gateway', detail: 'OpenRouter / Requesty / Z.AI / any Anthropic-compatible endpoint' },
  { label: 'Amazon Bedrock', value: 'bedrock', detail: 'Uses your existing AWS CLI session' },
  { label: 'Google Vertex AI', value: 'vertex', detail: 'Uses your existing gcloud session' },
  { label: 'Microsoft Foundry', value: 'foundry', detail: 'Uses your existing az login session' },
];

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ccp.switchProfile', () => switchProfile(context)),
    vscode.commands.registerCommand('ccp.newProfile', () => newProfile(context)),
    vscode.commands.registerCommand('ccp.manageProfiles', () => manageProfiles(context)),
    vscode.commands.registerCommand('ccp.pinWorkspaceProfile', () => pinWorkspaceProfile()),
    vscode.commands.registerCommand('ccp.applyMcpConfig', () => applyMcpConfigCommand()),
    vscode.commands.registerCommand('ccp.doctor', () => doctorCommand()),
    vscode.commands.registerCommand('ccp.exportProfile', () => exportProfileCommand()),
    vscode.commands.registerCommand('ccp.importProfile', () => importProfileCommand())
  );
}

async function switchProfile(context: vscode.ExtensionContext): Promise<void> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    const choice = await vscode.window.showInformationMessage('No profiles yet.', 'Create one now');
    if (choice) await newProfile(context);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, description: p.authType, profile: p })),
    { placeHolder: 'Switch Claude Code profile' }
  );
  if (!picked) return;
  await applyProfile(context, picked.profile);
}

/**
 * Collects inputs only — all persistence (keychain, config dir, OpenRouter
 * statusLine, the profile record itself) happens in core's
 * finalizeNewProfile, the same path the CLI and the import flow use, so
 * creation behavior can't drift between surfaces.
 */
async function newProfile(context: vscode.ExtensionContext): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Profile name (e.g. personal, accenture, wgu)',
    validateInput: (v) => validateProfileName(v) ?? undefined,
  });
  if (!name) return;

  if (await getProfile(name)) {
    vscode.window.showErrorMessage(`Profile "${name}" already exists.`);
    return;
  }

  const typePick = await vscode.window.showQuickPick(
    AUTH_TYPES.map((t) => ({ label: t.label, detail: t.detail, value: t.value })),
    { placeHolder: 'Auth type' }
  );
  if (!typePick) return;

  const input: NewProfileInput = { name, authType: typePick.value };

  switch (typePick.value) {
    case 'subscription':
      // Nothing to collect — the OAuth flow runs in an integrated terminal
      // after the profile record exists (below).
      break;
    case 'api_key': {
      const key = await vscode.window.showInputBox({ prompt: 'Anthropic API key', password: true });
      if (!key) return;
      input.apiKey = key;
      break;
    }
    case 'gateway': {
      const baseUrl = await vscode.window.showInputBox({
        prompt: 'Gateway base URL',
        value: 'https://openrouter.ai/api',
      });
      if (!baseUrl) return;
      const token = await vscode.window.showInputBox({ prompt: 'Gateway API token', password: true });
      if (!token) return;
      const model = await vscode.window.showInputBox({ prompt: 'Default model slug (optional)' });
      if (model === undefined) return; // Esc — treat as cancel, unlike an intentional blank
      input.gatewayBaseUrl = baseUrl;
      input.gatewayToken = token;
      if (model) input.gatewayModel = model;
      break;
    }
    case 'bedrock': {
      const awsProfile = await vscode.window.showInputBox({ prompt: 'AWS profile name (never "default")' });
      if (awsProfile === undefined) return;
      const awsRegion = await vscode.window.showInputBox({ prompt: 'AWS region', value: 'us-east-2' });
      if (awsRegion === undefined) return;
      input.awsProfile = awsProfile || undefined;
      input.awsRegion = awsRegion || undefined;
      break;
    }
    case 'vertex': {
      const vertexProject = await vscode.window.showInputBox({ prompt: 'GCP project ID' });
      if (vertexProject === undefined) return;
      const vertexRegion = await vscode.window.showInputBox({ prompt: 'Vertex region', value: 'us-central1' });
      if (vertexRegion === undefined) return;
      input.vertexProject = vertexProject || undefined;
      input.vertexRegion = vertexRegion || undefined;
      break;
    }
    case 'foundry': {
      const foundryResource = await vscode.window.showInputBox({ prompt: 'Foundry resource name' });
      if (foundryResource === undefined) return;
      input.foundryResource = foundryResource || undefined;
      break;
    }
  }

  try {
    const { profile, costStatusLine } = await finalizeNewProfile(input);

    if (typePick.value === 'subscription') {
      // The GUI extension can't inherit an interactive TTY the way the CLI
      // spawn can. Open an integrated terminal instead and let the user run
      // the OAuth flow there — this profile becomes usable once /login completes.
      const term = vscode.window.createTerminal({
        name: `Claude login: ${name}`,
        env: { CLAUDE_CONFIG_DIR: profile.claudeConfigDir },
      });
      term.show();
      term.sendText('claude');
      vscode.window.showInformationMessage(
        `Complete the browser sign-in in the "Claude login: ${name}" terminal, then come back and switch to this profile.`
      );
      return;
    }

    vscode.window.showInformationMessage(
      `Created profile "${name}" (${typePick.value}).` +
        (costStatusLine === 'applied' ? ' OpenRouter detected — cost statusLine added to its settings.json.' : '')
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create profile: ${(err as Error).message}`);
  }
}

async function manageProfiles(context: vscode.ExtensionContext): Promise<void> {
  const profiles = await listProfiles();
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, description: `${p.authType} — ${p.claudeConfigDir}`, profile: p })),
    { placeHolder: 'Manage a profile' }
  );
  if (!picked) return;

  const action = await vscode.window.showQuickPick(['Switch to this profile', 'Show details', 'Delete'], {
    placeHolder: picked.label,
  });
  if (!action) return;

  if (action === 'Switch to this profile') {
    await applyProfile(context, picked.profile);
  } else if (action === 'Show details') {
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(picked.profile, null, 2),
      language: 'json',
    });
    await vscode.window.showTextDocument(doc);
  } else if (action === 'Delete') {
    const confirm = await vscode.window.showWarningMessage(
      `Delete profile "${picked.label}"? This removes the stored secret reference but leaves ${picked.profile.claudeConfigDir} on disk.`,
      { modal: true },
      'Delete'
    );
    if (confirm === 'Delete') {
      if (picked.profile.keychainAccount) await deleteSecret(picked.profile.keychainAccount);
      await deleteProfile(picked.label);
      vscode.window.showInformationMessage(`Deleted profile "${picked.label}".`);
    }
  }
}

async function pinWorkspaceProfile(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Open a folder first.');
    return;
  }
  const profiles = await listProfiles();
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => p.name),
    { placeHolder: `Pin "${path.basename(folder.uri.fsPath)}" to which profile?` }
  );
  if (!picked) return;
  await setExpectedProfile(folder, picked);
  vscode.window.showInformationMessage(
    `Pinned this workspace to "${picked}". Opening it while a different profile is active will now warn you.`
  );
}

async function applyMcpConfigCommand(): Promise<void> {
  const profiles = await listProfiles();
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, profile: p })),
    { placeHolder: 'Apply an MCP server set to which profile?' }
  );
  if (!picked) return;

  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ['json'] },
    title: 'Select an MCP servers file (shape: { "mcpServers": {...} })',
  });
  if (!files || files.length === 0) return;

  try {
    await applyMcpServers(picked.profile, files[0].fsPath);
    const names = await currentMcpServerNames(picked.profile);
    vscode.window.showInformationMessage(
      `Applied to "${picked.label}": ${names.length} MCP server(s) — ${names.join(', ') || '(none)'}`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to apply MCP config: ${(err as Error).message}`);
  }
}

async function doctorCommand(): Promise<void> {
  const profiles = await listProfiles();
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, profile: p })),
    { placeHolder: 'Run preflight checks on which profile?' }
  );
  if (!picked) return;

  const results = await runDoctor(picked.profile);
  const channel = vscode.window.createOutputChannel('Claude Profile Doctor');
  channel.clear();
  channel.appendLine(`Preflight checks for "${picked.label}":\n`);
  let allOk = true;
  for (const r of results) {
    channel.appendLine(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  channel.show();
  if (!allOk) {
    vscode.window.showWarningMessage(`"${picked.label}" failed one or more checks — see the "Claude Profile Doctor" output panel.`);
  } else {
    vscode.window.showInformationMessage(`"${picked.label}" passed all preflight checks.`);
  }
}

async function exportProfileCommand(): Promise<void> {
  const profiles = await listProfiles();
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => p.name),
    { placeHolder: 'Export which profile?' }
  );
  if (!picked) return;

  const exported = await exportProfile(picked);
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${picked}.ccp-profile.json`),
    filters: { JSON: ['json'] },
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exported, null, 2), 'utf8'));
  vscode.window.showInformationMessage(`Exported "${picked}" (no secrets included) to ${uri.fsPath}`);
}

async function importProfileCommand(): Promise<void> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ['json'] },
    title: 'Select an exported profile JSON file',
  });
  if (!files || files.length === 0) return;

  const raw = await vscode.workspace.fs.readFile(files[0]);
  const exported: ExportedProfile = JSON.parse(Buffer.from(raw).toString('utf8'));

  if (await getProfile(exported.name)) {
    vscode.window.showErrorMessage(`Profile "${exported.name}" already exists on this machine.`);
    return;
  }

  if (exported.authType === 'subscription') {
    // Same pattern as newProfile(): GUI extension can't inherit a TTY, so
    // open an integrated terminal for the OAuth flow, then persist the
    // (secret-free) record separately.
    const claudeConfigDir = defaultConfigDirFor(exported.name);
    const term = vscode.window.createTerminal({
      name: `Claude login: ${exported.name}`,
      env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
    });
    term.show();
    term.sendText('claude');
    try {
      await finalizeImportedProfile(exported, {});
    } catch (err) {
      vscode.window.showErrorMessage(`Import failed: ${(err as Error).message}`);
      return;
    }
    vscode.window.showInformationMessage(
      `Imported "${exported.name}". Complete sign-in in the "Claude login: ${exported.name}" terminal.`
    );
    return;
  }

  const secrets: { apiKey?: string; gatewayToken?: string; awsProfile?: string; vertexProject?: string; foundryResource?: string } = {};
  switch (exported.authType) {
    case 'api_key':
      secrets.apiKey = await vscode.window.showInputBox({ prompt: 'Anthropic API key for this profile', password: true });
      if (!secrets.apiKey) return;
      break;
    case 'gateway':
      secrets.gatewayToken = await vscode.window.showInputBox({
        prompt: `Gateway token for ${exported.gatewayBaseUrl ?? '(base URL from export)'}`,
        password: true,
      });
      if (!secrets.gatewayToken) return;
      break;
    case 'bedrock':
      secrets.awsProfile = await vscode.window.showInputBox({ prompt: 'AWS profile name on this machine (never "default")' });
      break;
    case 'vertex':
      secrets.vertexProject = await vscode.window.showInputBox({ prompt: 'GCP project ID on this machine' });
      break;
    case 'foundry':
      secrets.foundryResource = await vscode.window.showInputBox({ prompt: 'Foundry resource name on this machine' });
      break;
  }

  try {
    const profile = await finalizeImportedProfile(exported, secrets);
    vscode.window.showInformationMessage(`Imported profile "${profile.name}" (${profile.authType}).`);
  } catch (err) {
    vscode.window.showErrorMessage(`Import failed: ${(err as Error).message}`);
  }
}
