import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { piMcpToolName, validatePiToolNameForMcp } from "./tool-names.js";
import type { PiToolDefinitionForMcp } from "./types.js";

export interface GeneratedMcpConfig {
  configPath: string;
  schemaPath: string;
  activeToolNames: Set<string>;
  toolDefs: PiToolDefinitionForMcp[];
  cleanup(): void;
}

export interface ToolExposureOptions {
  exposeAllTools?: boolean;
}

export function generateMcpConfigForPiTools(
  pi: ExtensionAPI,
  options: ToolExposureOptions = {},
): GeneratedMcpConfig {
  const allTools = pi.getAllTools();
  if (!Array.isArray(allTools)) {
    throw new Error("Pi tool registry is not ready; cannot expose tools to Claude Code.");
  }

  const selectedNames = options.exposeAllTools
    ? allTools.map((tool) => tool.name)
    : pi.getActiveTools();
  const activeToolNames = new Set(selectedNames);

  const toolDefs = allTools
    .filter((tool) => activeToolNames.has(tool.name))
    .map((tool) => {
      validatePiToolNameForMcp(tool.name);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as Record<string, unknown>,
      };
    });

  const dir = join(tmpdir(), `pi-claude-code-cli-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });

  const schemaPath = join(dir, "tools.json");
  const configPath = join(dir, "mcp.json");
  writeFileSync(schemaPath, JSON.stringify(toMcpTools(toolDefs), null, 2), "utf8");

  const serverPath = join(dirname(fileURLToPath(import.meta.url)), "mcp-schema-server.cjs");
  const config = {
    mcpServers: {
      pi: {
        command: process.execPath,
        args: [serverPath, schemaPath],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  return {
    configPath,
    schemaPath,
    activeToolNames,
    toolDefs,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function toMcpTools(toolDefs: PiToolDefinitionForMcp[]) {
  return toolDefs.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: normalizeInputSchema(tool.inputSchema),
    annotations: inferAnnotations(tool.name),
  }));
}

function normalizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  return schema;
}

function inferAnnotations(name: string): Record<string, boolean> {
  const readOnly = /^(read|grep|find|ls|memory_search|memory_get|memory_status|memory_review_status|board_.*list|board_.*get|subagent_.*list|subagent_.*get|tmux_.*list|tmux_.*get|browser_.*status)$/i.test(name);
  if (readOnly) {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  }
  return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

export function allowedPiMcpWildcard(): string {
  return piMcpToolName("*");
}
