import {
  calculateCost,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { isAllowedInternalClaudeTool, isPiMcpToolName, piToolNameFromMcp } from "./tool-names.js";
import type { ClaudeApiEvent, ClaudeUsage } from "./types.js";

type TrackedBlock =
  | { kind: "text"; claudeIndex: number; contentIndex: number; text: string }
  | { kind: "thinking"; claudeIndex: number; contentIndex: number; thinking: string }
  | {
      kind: "tool";
      claudeIndex: number;
      contentIndex: number;
      id: string;
      claudeName: string;
      piName: string;
      partialJson: string;
      args: Record<string, unknown>;
    }
  | { kind: "ignored"; claudeIndex: number; claudeName: string };

export interface BridgeViolation {
  message: string;
  toolName?: string;
}

export interface EventBridge {
  handleEvent(event: ClaudeApiEvent): void;
  getOutput(): AssistantMessage;
  hasPiToolCalls(): boolean;
  getViolation(): BridgeViolation | undefined;
  ensureStarted(): void;
}

export function createEventBridge(
  stream: AssistantMessageEventStream,
  model: Model<any>,
  activePiTools: Set<string>,
): EventBridge {
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "pi-claude-code-cli",
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  const blocks: TrackedBlock[] = [];
  let started = false;
  let violation: BridgeViolation | undefined;

  function ensureStarted(): void {
    if (started) return;
    stream.push({ type: "start", partial: output });
    started = true;
  }

  function handleEvent(event: ClaudeApiEvent): void {
    ensureStarted();
    switch (event.type) {
      case "message_start":
        applyUsage(event.message?.usage);
        break;
      case "content_block_start":
        handleBlockStart(event);
        break;
      case "content_block_delta":
        handleBlockDelta(event);
        break;
      case "content_block_stop":
        handleBlockStop(event);
        break;
      case "message_delta":
        if (event.delta?.stop_reason) output.stopReason = mapStopReason(event.delta.stop_reason);
        applyUsage(event.usage);
        break;
      default:
        break;
    }
  }

  function handleBlockStart(event: ClaudeApiEvent): void {
    const claudeIndex = event.index ?? blocks.length;
    const block = event.content_block;
    if (!block) return;

    if (block.type === "text") {
      const contentIndex = output.content.length;
      blocks.push({ kind: "text", claudeIndex, contentIndex, text: "" });
      output.content.push({ type: "text", text: "" });
      stream.push({ type: "text_start", contentIndex, partial: output });
      return;
    }

    if (block.type === "thinking") {
      const contentIndex = output.content.length;
      blocks.push({ kind: "thinking", claudeIndex, contentIndex, thinking: "" });
      output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" });
      stream.push({ type: "thinking_start", contentIndex, partial: output });
      return;
    }

    if (block.type === "tool_use") {
      const claudeName = block.name ?? "";
      if (isPiMcpToolName(claudeName)) {
        const piName = piToolNameFromMcp(claudeName);
        if (!activePiTools.has(piName)) {
          violation = { message: `Claude attempted inactive Pi MCP tool ${claudeName}`, toolName: claudeName };
          blocks.push({ kind: "ignored", claudeIndex, claudeName });
          return;
        }
        const contentIndex = output.content.length;
        const id = block.id ?? `toolu_${contentIndex}`;
        blocks.push({
          kind: "tool",
          claudeIndex,
          contentIndex,
          id,
          claudeName,
          piName,
          partialJson: "",
          args: {},
        });
        output.content.push({ type: "toolCall", id, name: piName, arguments: {} });
        stream.push({ type: "toolcall_start", contentIndex, partial: output });
        return;
      }

      if (isAllowedInternalClaudeTool(claudeName)) {
        blocks.push({ kind: "ignored", claudeIndex, claudeName });
        return;
      }

      violation = { message: `Claude attempted unexpected non-Pi tool ${claudeName}`, toolName: claudeName };
      blocks.push({ kind: "ignored", claudeIndex, claudeName });
    }
  }

  function handleBlockDelta(event: ClaudeApiEvent): void {
    const block = findBlock(event.index);
    if (!block) return;
    const delta = event.delta;
    if (!delta) return;

    if (block.kind === "text" && delta.type === "text_delta" && delta.text !== undefined) {
      block.text += delta.text;
      (output.content[block.contentIndex] as TextContent).text = block.text;
      stream.push({ type: "text_delta", contentIndex: block.contentIndex, delta: delta.text, partial: output });
      return;
    }

    if (block.kind === "thinking") {
      const content = output.content[block.contentIndex] as ThinkingContent;
      if (delta.type === "thinking_delta" && delta.thinking !== undefined) {
        block.thinking += delta.thinking;
        content.thinking = block.thinking;
        stream.push({ type: "thinking_delta", contentIndex: block.contentIndex, delta: delta.thinking, partial: output });
      } else if (delta.type === "signature_delta" && delta.signature !== undefined) {
        content.thinkingSignature = (content.thinkingSignature ?? "") + delta.signature;
      }
      return;
    }

    if (block.kind === "tool" && delta.type === "input_json_delta" && delta.partial_json !== undefined) {
      block.partialJson += delta.partial_json;
      try {
        block.args = JSON.parse(block.partialJson) as Record<string, unknown>;
        (output.content[block.contentIndex] as ToolCall).arguments = block.args;
      } catch {
        // Keep previous partial args until full JSON parses.
      }
      stream.push({ type: "toolcall_delta", contentIndex: block.contentIndex, delta: delta.partial_json, partial: output });
    }
  }

  function handleBlockStop(event: ClaudeApiEvent): void {
    const block = findBlock(event.index);
    if (!block) return;

    if (block.kind === "text") {
      stream.push({ type: "text_end", contentIndex: block.contentIndex, content: block.text, partial: output });
      return;
    }

    if (block.kind === "thinking") {
      stream.push({ type: "thinking_end", contentIndex: block.contentIndex, content: block.thinking, partial: output });
      return;
    }

    if (block.kind === "tool") {
      try {
        block.args = JSON.parse(block.partialJson || "{}") as Record<string, unknown>;
      } catch {
        block.args = { _raw: block.partialJson };
      }
      const toolCall: ToolCall = { type: "toolCall", id: block.id, name: block.piName, arguments: block.args };
      output.content[block.contentIndex] = toolCall;
      stream.push({ type: "toolcall_end", contentIndex: block.contentIndex, toolCall, partial: output });
    }
  }

  function findBlock(index: number | undefined): TrackedBlock | undefined {
    const claudeIndex = index ?? -1;
    return blocks.find((block) => block.claudeIndex === claudeIndex);
  }

  function applyUsage(usage: ClaudeUsage | undefined): void {
    if (!usage) return;
    if (usage.input_tokens !== undefined && usage.input_tokens !== null) output.usage.input = usage.input_tokens;
    if (usage.output_tokens !== undefined && usage.output_tokens !== null) output.usage.output = usage.output_tokens;
    if (usage.cache_read_input_tokens !== undefined && usage.cache_read_input_tokens !== null) output.usage.cacheRead = usage.cache_read_input_tokens;
    if (usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== null) output.usage.cacheWrite = usage.cache_creation_input_tokens;
    output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
    calculateCost(model, output.usage);
  }

  return {
    handleEvent,
    getOutput: () => output,
    hasPiToolCalls: () => output.content.some((content) => content.type === "toolCall"),
    getViolation: () => violation,
    ensureStarted,
  };
}

function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" | "aborted" {
  switch (reason) {
    case "tool_use":
      return "toolUse";
    case "max_tokens":
      return "length";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}
