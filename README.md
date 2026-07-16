# ccp — Claude Code Profile Manager

Switch between fully isolated Claude Code identities — personal subscription,
work Bedrock, a direct API key, an OpenRouter gateway — without leftover
environment variables from one silently billing the other.

Ships two surfaces over one shared core, so switching and creation logic
never diverge:

- a terminal CLI (`ccp`) with a zsh wrapper for real per-shell switching
- a VS Code extension for the Claude Code panel, with workspace pinning and
  a wrong-profile guardrail

## Why this exists

Claude Code resolves credentials by priority: cloud provider vars >
`ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > OAuth/subscription. If you
juggle more than one identity by hand, a leftover var from the previous
context silently wins — and your personal project quietly bills your
employer's Bedrock account, or vice versa. `ccp` makes the switch atomic:
every known routing variable is unset, then the target profile's set is
applied.

Each profile also gets its own `CLAUDE_CONFIG_DIR` (default:
`~/.claude-<name>`), which isolates credentials, `settings.json`, MCP
servers, `CLAUDE.md`, and session history from every other profile.

## Requirements

Stated bluntly rather than discovered the hard way:

- **macOS.** Secrets are stored in the macOS Keychain via the `security`
  CLI. On other platforms, only profile types that store no local secret
  (subscription, Bedrock, Vertex, Foundry) would work, and this is untested.
  Cross-platform secret backends are on the roadmap.
- **zsh.** The shell wrapper (`shell/ccp-init.zsh`) uses zsh hooks. bash/fish
  ports are on the roadmap.
- **Node 18+** and npm.
- **Claude Code CLI** (`claude`) on your PATH for subscription login flows.

## Supported auth types

| Type | Routes via | Secret storage |
| --- | --- | --- |
| `subscription` | claude.ai Pro/Max/Team/Enterprise OAuth | none — `credentials.json` in the profile's own config dir |
| `api_key` | `ANTHROPIC_API_KEY` | macOS Keychain |
| `gateway` | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (OpenRouter, Requesty, Z.AI, any Anthropic-compatible endpoint) | macOS Keychain |
| `bedrock` | `CLAUDE_CODE_USE_BEDROCK` + your AWS CLI session | none — assumes `aws sso login` is active |
| `vertex` | `CLAUDE_CODE_USE_VERTEX` + your gcloud session | none — assumes `gcloud auth login` / ADC |
| `foundry` | `CLAUDE_CODE_USE_FOUNDRY` + your az session | none — assumes `az login` |

## Install

### CLI

```bash
git clone https://github.com/kloudlinq/ccp-profile-manager.git
cd ccp-profile-manager
npm install
npm run build:core
npm link --workspace packages/core
which ccp-bin   # confirm it resolved
```

Then source the shell wrapper in `~/.zshrc` (this is what makes `ccp switch`
actually change your current shell's environment — a child process can't do
that on its own, same reason nvm/pyenv ship shell functions):

```bash
echo 'source /absolute/path/to/ccp-profile-manager/shell/ccp-init.zsh' >> ~/.zshrc
source ~/.zshrc
```

### VS Code extension (.vsix)

Download the `.vsix` from the latest [GitHub Release](https://github.com/kloudlinq/ccp-profile-manager/releases), then:

```bash
code --install-extension ccp-profile-manager-<version>.vsix
```

Or build it yourself: `npm run package:ext` produces the `.vsix` under
`packages/vscode-extension/`.

## Terminal usage

```bash
# Create profiles (prompts for whatever the auth type needs; secrets are masked)
ccp create personal --type subscription
ccp create work --type bedrock
ccp create openrouter-play --type gateway

# Switch — full unset-then-apply in the current shell
ccp switch work
ccp list          # * marks the active profile
ccp show work

# Preflight-check a profile before relying on it mid-task
ccp doctor work   # verifies AWS SSO session / credentials.json / keychain entry, per auth type

# Give a profile its own MCP server set
ccp mcp-apply personal ./mcp-sets/homelab.json

# Move a profile's *shape* (never its secret) to another machine or teammate
ccp export personal --out personal.ccp-profile.json
ccp import personal.ccp-profile.json   # prompts for a fresh login/key on this machine
```

Optional: show the active profile in your prompt —

```zsh
RPROMPT='%F{yellow}${CCP_ACTIVE_PROFILE:+[ccp:$CCP_ACTIVE_PROFILE]}%f'
```

### MCP server sets

`ccp mcp-apply <profile> <file>` replaces the profile's user-scope MCP
servers with the contents of a JSON file shaped like:

```json
{ "mcpServers": { "name": { "command": "...", "args": ["..."] } } }
```

It writes to `.claude.json` inside the profile's config dir — the file
Claude Code actually reads for user-scope MCP servers (`claude mcp add -s
user` writes there too; a `mcpServers` block in `settings.json` is ignored —
verified against a live install). Everything else in `.claude.json`
(onboarding state, project history) is preserved. It's a full replace, not a
merge, so a profile's MCP set always reflects exactly what you last applied.

## Cost visibility (OpenRouter gateway profiles)

Creating a `gateway` profile whose base URL contains `openrouter.ai`
automatically writes a `statusLine` into that profile's `settings.json`
showing running spend, using `$ANTHROPIC_AUTH_TOKEN` from the profile's own
environment — no secret duplicated. OpenRouter-specific today, since it's
the only gateway with a verified usage-lookup endpoint wired in; other
gateways no-op silently rather than guess at an endpoint shape.

## VS Code extension

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
  file, replaces that profile's MCP servers.
- **Claude Profile: Run Doctor...** — preflight checks in an output panel.
- **Claude Profile: Export...** / **Import...** — same secret-free
  export/import as the CLI, via native file dialogs.

The status bar item (bottom right) always shows the active profile and is
itself a shortcut to **Switch...**.

### Panel scoping — the panel is always machine-wide, for every profile type

`claudeCode.environmentVariables` is declared `"scope": "application"` by the
official extension, and VS Code enforces application scope as **User settings
only** at the core level — attempting to write it at Workspace or
WorkspaceFolder scope throws `"can be written only into User settings."` This
was confirmed directly, not assumed: an earlier version of this tool tried
Workspace scope for non-secret profile types and hit that exact error.

Practical effect: switching profiles in the VS Code panel changes it for
**every open window's panel**, for every auth type, no exceptions. Real
per-context parallelism (e.g. personal in one terminal tab, work in another)
only exists on the **terminal side**, via the shell wrapper function, which
genuinely is per-shell.

## Security model

- Secrets (API keys, gateway tokens) live in the macOS Keychain under one
  constant service name (`ccp-profile-manager`), never in a config file on
  disk. Profile records in `~/.ccp/profiles/` hold only a Keychain *account
  reference*.
- CLI secret prompts are masked (`*` echo); piped/non-TTY input falls back
  to plain reads since there's no terminal to leak onto.
- `ccp export` deliberately excludes secrets, keychain references, and
  machine-specific paths — an import always re-collects credentials on the
  target machine.
- Profile names are restricted to `[a-z0-9-]` (must start alphanumeric)
  because they become file and directory names.

## Known limitations, stated plainly rather than glossed over

- macOS-only secret storage and zsh-only shell integration (see Requirements).
- The active profile shown in the VS Code status bar is tracked machine-wide,
  matching what's actually true of the panel's routing — there's no
  meaningful "per-window" version of this to track.
- The terminal-side pin check (`chpwd` hook) warns, it doesn't block — a
  hard stop on every `cd` would be more disruptive than useful. It silently
  no-ops if `python3` isn't on PATH.
- Bedrock/Vertex/Foundry profiles store no secret at all; they assume your
  cloud CLI session is already active when you switch — `ccp doctor` checks
  this.
- The OpenRouter cost statusLine is OpenRouter-specific; other gateway types
  no-op rather than guess at an unverified usage-endpoint shape.

## Roadmap

- Cross-platform secret backends (Windows Credential Manager, libsecret)
- bash/fish shell wrappers
- `ccp current`, `ccp doctor --all`
- VS Code Marketplace publishing

## Development

```bash
npm install
npm run build          # core + extension
npm run package:ext    # produce the .vsix
```

The repo is an npm workspace: `packages/core` (shared logic + `ccp-bin`
CLI), `packages/vscode-extension` (VSIX), `shell/` (zsh integration). All
profile persistence goes through `finalizeNewProfile` in
`packages/core/src/profileFactory.ts` — if you add a surface, collect input
there and hand off; don't persist directly.

## License

[MIT](LICENSE) © KloudLinQ LLC
