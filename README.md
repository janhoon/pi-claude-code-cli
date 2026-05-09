# pi-claude-code-cli

Pi model provider package for using an authenticated Claude Code CLI subscription backend while keeping Pi as the agent runtime.

## Design goals

- Use the installed `claude` binary and existing Claude Code login.
- Expose only Pi-provided tools to Claude, via MCP schemas.
- Route tool execution back through Pi-native tool calls so Pi hooks, including memory hooks, still work.
- Use Pi context as the source of truth; fail closed if hidden Claude context/tooling is detected.

Status: design/bootstrap in progress.
