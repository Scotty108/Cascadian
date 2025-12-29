# Claude Code Bug Report: Freezing Mid-Stream, Unrecoverable State

## Summary
Claude Code freezes mid-response and enters an unrecoverable state where it won't respond to any further prompts. Only a full restart resolves it temporarily.

## Environment
- **Claude Code version**: 2.0.60 (also tested 2.0.50)
- **Install method**: Homebrew
- **OS**: macOS (Apple Silicon)
- **Shell**: zsh
- **Editors tested**: Cursor, VS Code (issue occurs in both)
- **Models tested**: Opus 4.5, Sonnet (issue occurs with both)

## Reproduction Steps
1. Open Claude Code in Cursor terminal or VS Code
2. Run a prompt that triggers multiline output (e.g., code refactor, multi-step plan)
3. Claude starts responding but **stalls partway** through response
4. Press `esc` - shows tool interruption message
5. Attempt any follow-up prompt - **Claude does not respond**
6. Only `pkill -f claude` or relaunching the IDE restores functionality

## What's Been Ruled Out
- ❌ MCP servers (disabled all, issue persists)
- ❌ Model-specific (happens with both Opus and Sonnet)
- ❌ Version-specific (happens in 2.0.50 and 2.0.60)
- ❌ Config issues (deleted ~/.claude/, reinstalled fresh)
- ❌ Permission modes (tried default, plan, --dangerously-skip-permissions)

## Diagnostics
- `/doctor` shows no errors (only MCP warnings when servers were enabled)
- No crash logs or error output when freeze occurs
- Issue is intermittent but frequent (multiple times per session)

## Suspected Cause
The streaming/response handler appears to enter a corrupted state after:
1. Mid-stream interruption (esc), OR
2. Long multiline output completion

After this state is entered, the input handler stops processing new prompts entirely.

## Desired Fix
- Proper state recovery after `esc` interruption
- Graceful handling of streaming interruptions
- Ability to continue conversation after any interruption

## Workaround
Currently the only workaround is killing and restarting Claude Code entirely.

---

**Filed by**: scotty
**Date**: 2025-12-06
**GitHub Issue URL**: https://github.com/anthropics/claude-code/issues
