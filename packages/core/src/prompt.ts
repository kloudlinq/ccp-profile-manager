import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || '';
}

/** For secrets: still visible in this minimal implementation (no TTY raw-mode
 *  masking dependency). Terminal scrollback may retain it — acceptable for a
 *  personal tool, but flagged here deliberately rather than silently assumed safe. */
export async function askSecret(question: string): Promise<string> {
  return ask(`${question} (input will be visible)`);
}
