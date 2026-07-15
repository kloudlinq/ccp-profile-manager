#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { AuthType } from './types';
import { listProfiles, getProfile, deleteProfile } from './profileStore';
import { resolveEnv, toShellScript } from './envManager';
import { createProfile, deleteProfileSecrets } from './authFlows';
import { applyMcpServers, currentMcpServerNames } from './mcpConfig';
import { runDoctor } from './doctor';
import { exportProfile, importProfileInteractiveCli, ExportedProfile } from './exportImport';

const VALID_TYPES: AuthType[] = ['subscription', 'api_key', 'gateway', 'bedrock', 'vertex', 'foundry'];

const program = new Command();
program.name('ccp').description('Claude Code profile manager').version('0.1.0');

program
  .command('create <name>')
  .description('Create and log in to a new profile')
  .requiredOption('-t, --type <type>', `auth type: ${VALID_TYPES.join(' | ')}`)
  .action(async (name: string, opts: { type: string }) => {
    if (!VALID_TYPES.includes(opts.type as AuthType)) {
      console.error(`Invalid --type. Must be one of: ${VALID_TYPES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    if (await getProfile(name)) {
      console.error(`Profile "${name}" already exists. Use "ccp delete ${name}" first, or pick a different name.`);
      process.exitCode = 1;
      return;
    }
    const profile = await createProfile({ name, authType: opts.type as AuthType });
    console.log(`\n[ccp] Created profile "${profile.name}" (${profile.authType}) -> ${profile.claudeConfigDir}`);
  });

program
  .command('list')
  .description('List all profiles')
  .action(async () => {
    const profiles = await listProfiles();
    if (profiles.length === 0) {
      console.log('No profiles yet. Create one with: ccp create <name> --type <type>');
      return;
    }
    const active = process.env.CCP_ACTIVE_PROFILE;
    for (const p of profiles) {
      const marker = p.name === active ? '*' : ' ';
      console.log(`${marker} ${p.name.padEnd(16)} ${p.authType.padEnd(12)} ${p.claudeConfigDir}`);
    }
  });

program
  .command('show <name>')
  .description('Show full details for a profile (no secrets printed)')
  .action(async (name: string) => {
    const profile = await getProfile(name);
    if (!profile) {
      console.error(`No such profile: ${name}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(profile, null, 2));
  });

program
  .command('switch <name>')
  .description('Switch to a profile in the CURRENT shell (must be eval\'d — see shell/ccp-init.zsh)')
  .option('--print-env', 'print the shell script instead of trying to apply it directly (always use this in practice)')
  .action(async (name: string) => {
    const profile = await getProfile(name);
    if (!profile) {
      console.error(`No such profile: ${name}`);
      process.exitCode = 1;
      return;
    }
    const resolved = await resolveEnv(profile);
    const script = toShellScript(resolved, name);
    // A child process cannot mutate its parent shell's env, regardless of
    // --print-env. This always prints; the flag exists for interface clarity
    // when called from the shell wrapper function.
    console.log(script);
  });

program
  .command('delete <name>')
  .description('Delete a profile record and its stored secret (does NOT delete claudeConfigDir contents)')
  .action(async (name: string) => {
    const profile = await getProfile(name);
    if (!profile) {
      console.error(`No such profile: ${name}`);
      process.exitCode = 1;
      return;
    }
    await deleteProfileSecrets(profile);
    await deleteProfile(name);
    console.log(`[ccp] Deleted profile "${name}". Config dir left in place: ${profile.claudeConfigDir}`);
  });

program
  .command('mcp-apply <name> <mcpServersFile>')
  .description('Replace this profile\'s MCP server set from a JSON file (shape: { "mcpServers": {...} })')
  .action(async (name: string, mcpServersFile: string) => {
    const profile = await getProfile(name);
    if (!profile) {
      console.error(`No such profile: ${name}`);
      process.exitCode = 1;
      return;
    }
    await applyMcpServers(profile, mcpServersFile);
    const names = await currentMcpServerNames(profile);
    console.log(`[ccp] Applied. "${name}" now has ${names.length} MCP server(s): ${names.join(', ') || '(none)'}`);
  });

program
  .command('doctor <name>')
  .description('Run preflight checks for a profile (auth session validity, keychain, config dir)')
  .action(async (name: string) => {
    const profile = await getProfile(name);
    if (!profile) {
      console.error(`No such profile: ${name}`);
      process.exitCode = 1;
      return;
    }
    const results = await runDoctor(profile);
    let allOk = true;
    for (const r of results) {
      console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.detail}`);
      if (!r.ok) allOk = false;
    }
    process.exitCode = allOk ? 0 : 1;
  });

program
  .command('export <name>')
  .description('Print a profile\'s shape as JSON, with no secrets and no machine-specific paths, for sharing or moving machines')
  .option('-o, --out <file>', 'write to a file instead of stdout')
  .action(async (name: string, opts: { out?: string }) => {
    const exported = await exportProfile(name);
    const json = JSON.stringify(exported, null, 2);
    if (opts.out) {
      await fs.writeFile(opts.out, json, 'utf8');
      console.log(`[ccp] Wrote ${opts.out}`);
    } else {
      console.log(json);
    }
  });

program
  .command('import <file>')
  .description('Import a profile shape exported with "ccp export" — prompts for a fresh login/secret on this machine')
  .action(async (file: string) => {
    const raw = await fs.readFile(file, 'utf8');
    const exported: ExportedProfile = JSON.parse(raw);
    const profile = await importProfileInteractiveCli(exported);
    console.log(`\n[ccp] Imported profile "${profile.name}" (${profile.authType}) -> ${profile.claudeConfigDir}`);
  });

program.parseAsync(process.argv);
