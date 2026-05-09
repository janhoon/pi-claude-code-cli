# pi-claude-code-cli

Pi model provider package for using an authenticated Claude Code CLI subscription backend while keeping Pi as the agent runtime.

## Status

Early implementation. The package registers a `claude-code-cli` provider and routes turns through the installed `claude` binary.

## Design goals

- Use the installed `claude` binary and existing Claude Code login.
- Use Pi context as the source of truth by passing Pi's system prompt with `--system-prompt`.
- Suppress hidden Claude-side context/tooling with `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, and `--disable-slash-commands`.
- Expose active Pi tools as schema-only MCP tools under the original Pi tool names.
- Break before Claude Code executes tools, then return native Pi tool calls so Pi hooks, including memory hooks, observe normal `tool_call` / `tool_result` events.
- Reuse Claude CLI sessions with `--resume` only when the Pi branch prefix matches the stored Claude session mapping.
- Feed tool results back as text replay by default; experimental structured `tool_result` replay can be enabled with `PI_CLAUDE_CODE_STRUCTURED_TOOL_RESULTS=1`.

## Requirements

- Claude Code CLI installed on `PATH` as `claude`.
- Existing Claude Code login (`claude auth login`).
- Pi with extension package support.

## Development

```bash
npm install
npm run typecheck
```

## Attribution

This package was inspired by [`rchern/pi-claude-cli`](https://github.com/rchern/pi-claude-cli), especially its Claude CLI `stream-json`, break-early, and resume-session approach. This implementation is rewritten for Pi-context-only execution and all-active-Pi-tools-as-MCP routing.

## License

MIT
