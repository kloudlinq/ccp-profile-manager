# ccp — Claude Code profile manager shell integration
#
# Source this from ~/.zshrc:
#   source /path/to/ccp-profile-manager/shell/ccp-init.zsh
#
# Why this exists: `ccp switch <name>` runs as a child process and cannot
# change your shell's environment on its own — same reason pyenv/nvm/direnv
# all ship a shell function instead of relying on the binary alone. This
# function intercepts `switch` and `eval`s the exported script; every other
# subcommand (list/show/create/delete) passes straight through to the binary.

ccp() {
  if [[ "$1" == "switch" && -n "$2" ]]; then
    local script
    script="$(command ccp-bin switch "$2")" || return $?
    eval "$script"
    echo "[ccp] Active profile: ${CCP_ACTIVE_PROFILE}" >&2
  else
    command ccp-bin "$@"
  fi
}

# Optional: show the active profile in your prompt. Add to PROMPT/RPROMPT:
#   '%F{yellow}${CCP_ACTIVE_PROFILE:+[ccp:$CCP_ACTIVE_PROFILE]}%f'

# Terminal-side counterpart to the VS Code guardrail: the panel only checks
# its pin on window open/reload, so a plain `cd` into a pinned repo in a
# terminal tab was previously invisible to this tool entirely. This warns —
# it does not block, since a hard stop on every `cd` would be more disruptive
# than useful, but it does mean you'll see it before running a task in the
# wrong context. Reads .vscode/ccp.local.json, the same file VS Code's
# "Pin This Workspace To..." command writes.
_ccp_check_pin() {
  local pinfile="$PWD/.vscode/ccp.local.json"
  [[ -f "$pinfile" ]] || return
  if ! command -v python3 >/dev/null 2>&1; then
    return # no python3 available — silently skip rather than error on every cd
  fi
  local expected
  expected=$(python3 -c "import json,sys
try:
    print(json.load(open(sys.argv[1])).get('expectedProfile',''))
except Exception:
    pass" "$pinfile" 2>/dev/null)
  [[ -z "$expected" ]] && return
  if [[ "$CCP_ACTIVE_PROFILE" != "$expected" ]]; then
    print -P "%F{red}[ccp] this directory is pinned to '%F{yellow}$expected%F{red}', but '%F{yellow}${CCP_ACTIVE_PROFILE:-none}%F{red}' is active.%f Run: ccp switch $expected"
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _ccp_check_pin
_ccp_check_pin  # also check immediately if the shell started inside a pinned dir
