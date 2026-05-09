import type { ChildProcess } from "node:child_process";
import type { ClaudeControlRequestMessage } from "./types.js";
import { isAllowedInternalClaudeTool, isPiMcpToolName, piToolNameFromMcp } from "./tool-names.js";

export interface ControlDecision {
  allowed: boolean;
  reason?: string;
}

export function handleControlRequest(
  message: ClaudeControlRequestMessage,
  proc: ChildProcess,
  activePiTools: Set<string>,
): ControlDecision {
  const requestId = message.request_id;
  const toolName = message.request?.tool_name ?? "";

  if (!requestId) {
    return { allowed: false, reason: "Malformed control_request without request_id" };
  }

  const decision = decideToolPermission(toolName, activePiTools);
  const response = {
    type: "control_response",
    request_id: requestId,
    response: {
      subtype: "success",
      response: decision.allowed
        ? { behavior: "allow" }
        : { behavior: "deny", message: decision.reason ?? "Denied by Pi Claude Code provider" },
    },
  };
  proc.stdin?.write(JSON.stringify(response) + "\n");
  return decision;
}

function decideToolPermission(toolName: string, activePiTools: Set<string>): ControlDecision {
  if (isPiMcpToolName(toolName)) {
    const piName = piToolNameFromMcp(toolName);
    if (!activePiTools.has(piName)) {
      return { allowed: false, reason: `MCP tool ${toolName} maps to inactive Pi tool ${piName}` };
    }
    // Allow permission layer to proceed; the schema server still does not execute tools,
    // and the provider breaks at message_stop so Pi executes natively.
    return { allowed: true };
  }

  if (isAllowedInternalClaudeTool(toolName)) {
    return { allowed: true };
  }

  return { allowed: false, reason: `Unexpected non-Pi Claude tool request: ${toolName}` };
}
