import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || '';
}

const ESC = '\u001b';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007f'; // DEL — what macOS Terminal sends for the delete key

/**
 * Masked secret entry: raw-mode reads with `*` echo, no dependency needed.
 * Falls back to the plain (visible) prompt when stdin isn't a TTY — e.g.
 * input piped in a script — since raw mode doesn't exist there and there's
 * no terminal to leak the secret onto anyway.
 */
export async function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY) {
    return ask(question);
  }

  stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const onData = (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        // Arrow keys / function keys arrive as escape sequences — ignore the
        // whole chunk rather than letting fragments into the secret.
        if (s.startsWith(ESC)) return;
        for (const ch of s) {
          if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
            stdin.off('data', onData);
            stdout.write('\n');
            resolve(value);
            return;
          }
          if (ch === CTRL_C) {
            stdin.off('data', onData);
            stdout.write('\n');
            reject(new Error('Cancelled'));
            return;
          }
          if (ch === BACKSPACE || ch === '\b') {
            if (value.length > 0) {
              value = value.slice(0, -1);
              stdout.write('\b \b');
            }
            continue;
          }
          if (ch >= ' ') {
            value += ch;
            stdout.write('*');
          }
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}
