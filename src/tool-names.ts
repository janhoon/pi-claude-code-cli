const PI_MCP_PREFIX = "mcp__pi__";

// Claude Code may use internal, read-only discovery tools before selecting an MCP tool.
// These do not execute user-visible file/shell actions and are allowed to complete inside Claude.
const ALLOWED_INTERNAL_TOOL_NAMES = new Set(["ToolSearch"]);

export function piMcpToolName(piToolName: string): string {
  return `${PI_MCP_PREFIX}${piToolName}`;
}

export function isPiMcpToolName(name: string): boolean {
  return name.startsWith(PI_MCP_PREFIX);
}

export function piToolNameFromMcp(name: string): string {
  return name.slice(PI_MCP_PREFIX.length);
}

export function isAllowedInternalClaudeTool(name: string): boolean {
  return ALLOWED_INTERNAL_TOOL_NAMES.has(name);
}

export function validatePiToolNameForMcp(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      `Cannot expose Pi tool '${name}' to Claude MCP bridge: tool names must match /^[A-Za-z0-9_-]+$/`,
    );
  }
}
