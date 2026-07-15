import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

interface PinFile {
  expectedProfile?: string;
}

function pinFilePath(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, '.vscode', 'ccp.local.json');
}

export async function getExpectedProfile(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(pinFilePath(folder), 'utf8');
    const parsed: PinFile = JSON.parse(raw);
    return parsed.expectedProfile;
  } catch {
    return undefined;
  }
}

export async function setExpectedProfile(folder: vscode.WorkspaceFolder, profileName: string): Promise<void> {
  const filePath = pinFilePath(folder);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ expectedProfile: profileName }, null, 2), 'utf8');

  // Best-effort: make sure it's actually gitignored, since this file only
  // ever holds a profile *name* (not a secret) but still shouldn't leak
  // your internal profile-naming scheme into a public repo.
  const gitignorePath = path.join(folder.uri.fsPath, '.gitignore');
  const entry = '.vscode/ccp.local.json';
  try {
    const existing = await fs.readFile(gitignorePath, 'utf8');
    if (!existing.includes(entry)) {
      await fs.appendFile(gitignorePath, `\n${entry}\n`);
    }
  } catch {
    await fs.writeFile(gitignorePath, `${entry}\n`, 'utf8');
  }
}
