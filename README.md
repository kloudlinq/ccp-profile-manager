# ccp — Claude Code Profile Manager

Manages isolated Claude Code identities (subscription, direct API key, gateway
providers like OpenRouter, and cloud providers — Bedrock, Vertex, Foundry)
across both a terminal CLI and a VS Code extension, sharing one core so
switching logic never diverges between the two surfaces.

## How it works

Each profile gets its own `CLAUDE_CONFIG_DIR` (default: `~/.claude-<name>`),
which isolates credentials, `settings.json`, MCP servers, `CLAUDE.md`, and
session history from every other profile. Switching always does a full
**unset-then-apply** of every known Claude Code routing variable before
setting the target profile's — this matters because Claude Code resolves
credentials by priority (cloud creds > `ANTHROPIC_AUTH_TOKEN` >
`ANTHROPIC_API_KEY` > OAuth/subscription), so a leftover var from a previous
profile can silently win otherwise.

Secrets (API keys, gateway tokens) are stored in the macOS Keychain, never in
a config file on disk. Subscription profiles need no stored secret — the
OAuth flow writes `credentials.json` directly into that profile's config dir.

## Build

Requires Node 18+, npm, and (for the extension) `vsce`.

```bash
npm install
npm run build
```

## Terminal usage

1. Build the core package (`npm run build:core`), then link the binary onto
   your PATH:
   ```bash
   npm link --workspace packages/core
   which ccp-bin   # confirm it resolved
   ```
2. Source the shell wrapper in `~/.zshrc` (this is what makes `ccp switch`
   actually change your current shell's environment — a child process can't
   do that on its own):
   ```bash
   echo 'source /absolute/path/to/ccp-profile-manager/shell/ccp-init.zsh' >> ~/.zshrc
   source ~/.zshrc
   ```
3. Create your first profile:
   ```bash
   ccp create personal --type subscription
   ccp create accenture --type bedrock
   ccp create openrouter-play --type gateway
   ```
4. Switch:
   ```bash
   ccp switch accenture
   ccp list
   ```
5. Give a profile its own MCP server set (isolation already exists structurally
   — each profile has its own `settings.json` — this just populates it):
   ```bash
   ccp mcp-apply personal ./mcp-sets/homelab.json
   ccp mcp-apply accenture ./mcp-sets/bedrock-kb-only.json
   ```
   Source file shape: `{ "mcpServers": { "name": { "command": ..., "args": [...] } } }`
   — same convention as Claude Code's own `settings.json`. This is a full
   replace, not a merge, so it always reflects exactly what you last applied.
6. Check a profile is actually usable before relying on it mid-task:
   ```bash
   ccp doctor accenture   # verifies AWS SSO session, credentials.json, keychain entry, etc. per auth type
   ```
7. Move a profile's *shape* (not its secret) to another machine or hand it to
   a teammate:
   ```bash
   ccp export personal --out personal.ccp-profile.json   # no secrets, no local paths
   ccp import personal.ccp-profile.json                  # prompts for a fresh login/key on this machine
   ```

## Cost visibility (OpenRouter gateway profiles)

Creating a `gateway` profile whose base URL contains `openrouter.ai` automatically
writes a `statusLine` into that profile's `settings.json` showing running spend,
using `$ANTHROPIC_AUTH_TOKEN` (already present in that profile's own environment
— no secret duplicated). This is OpenRouter-specific today, since it's the only
gateway with a verified usage-lookup endpoint wired in; other gateways no-op
silently rather than guess at an endpoint shape.

## VS Code extension (local install, not yet published)

```bash
npm run package:ext
code --install-extension packages/vscode-extension/ccp-profile-manager-0.1.0.vsix
```

Commands (Cmd/Ctrl+Shift+P):
- **Claude Profile: Switch...** — QuickPick, applies the profile, prompts a
  window reload (required — the official Claude Code extension only re-reads
  its environment settings on panel reopen or reload).
- **Claude Profile: New / Login...** — walks through the right flow per auth
  type; subscription opens an integrated terminal for the OAuth browser flow.
- **Claude Profile: Manage...** — switch / inspect / delete existing profiles.
- **Claude Profile: Pin This Workspace To...** — binds a repo folder to a
  profile via `.vscode/ccp.local.json` (auto-gitignored, holds only a profile
  *name*, never a secret). Opening a pinned workspace while a different
  profile is active triggers a modal warning before anything proceeds.
- **Claude Profile: Apply MCP Server Set...** — picks a profile and a JSON
  file, replaces that profile's `mcpServers` block.
- **Claude Profile: Run Doctor...** — preflight checks in an output panel.
- **Claude Profile: Export...** / **Import...** — same secret-free
  export/import as the CLI, via native file dialogs; subscription imports open
  an integrated terminal for OAuth, same as New/Login.

The status bar item (bottom right) always shows the active profile and is
itself a shortcut to **Switch...**.

## Panel scoping — the panel is always machine-wide, for every profile type

`claudeCode.environmentVariables` is declared `"scope": "application"` by the
official extension, and VS Code enforces application scope as **User settings
only** at the core level — attempting to write it at Workspace or
WorkspaceFolder scope throws `"can be written only into User settings."` This
was confirmed directly, not assumed: an earlier version of this tool tried
Workspace scope for non-secret profile types (subscription/bedrock/vertex/foundry)
and hit that exact error.

Practical effect: switching profiles in the VS Code panel changes it for
**every open window's panel**, for every auth type, no exceptions. Two windows
cannot run two different profiles in their panels at the same time — full
stop, not just for secret-bearing types. Real per-context parallelism (e.g.
personal in one terminal tab, Accenture in another) only exists on the
**terminal side**, via the shell wrapper function, which genuinely is
per-shell.

The status bar reflects this: it shows one active profile, globally, because
that's the truth of what's routing the panel — there's no "per-window" state
to track that would mean anything.

## Known limitations, stated plainly rather than glossed over

- The active profile shown in the status bar and used by the guardrail is
  tracked machine-wide (`globalState`), matching what's actually true of the
  panel's routing — there's no meaningful "per-window" version of this to
  track, since VS Code won't let the extension write its env setting at
  anything narrower than User scope.
- The terminal-side pin check (`chpwd` hook in `ccp-init.zsh`) warns, it
  doesn't block — a hard stop on every `cd` would be more disruptive than
  useful. It also silently no-ops if `python3` isn't on PATH.
- Bedrock/Vertex/Foundry profiles store no secret at all; they assume your
  `aws sso login` / `gcloud auth login` / `az login` session is already
  active when you switch to them — `ccp doctor` / **Run Doctor...** checks this.
- Secret input in the CLI (`ccp create ... --type api_key`) is visible in the
  terminal, not masked — acceptable for a single-user machine, worth revisiting
  before any shared-workstation use.
- The OpenRouter cost statusLine is OpenRouter-specific; other gateway types
  no-op rather than guess at an unverified usage-endpoint shape.
