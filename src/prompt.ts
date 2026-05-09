import type { ImageContent, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { splitResumeBase } from "./session-map.js";
import type { ClaudeInputBlock, ClaudeToolResultBlock, ClaudeTurnInput, ClaudeUserInput, PiMessage } from "./types.js";

export interface PromptBuildResult {
  input: ClaudeTurnInput;
  baseMessages: PiMessage[];
}

export function buildClaudeInput(messages: PiMessage[], useResume: boolean): PromptBuildResult {
  const split = splitResumeBase(messages);

  if (useResume && split.trailingToolResults.length > 0) {
    return {
      baseMessages: split.baseMessages,
      input: {
        kind: "tool_results",
        resumeBaseHash: undefined,
        content: toolResultsToClaudeBlocks(split.trailingToolResults as ToolResultMessage[]),
      },
    };
  }

  if (useResume && split.finalUserMessage?.role === "user") {
    return {
      baseMessages: split.baseMessages,
      input: { kind: "user", content: userContentToClaudeInput(split.finalUserMessage) },
    };
  }

  return {
    baseMessages: split.baseMessages,
    input: { kind: "replay", content: fullReplayToClaudeInput(messages) },
  };
}

export function fullReplayToClaudeInput(messages: PiMessage[]): ClaudeUserInput {
  if (messages.length === 0) return "";

  const finalUserIndex = findFinalUserIndex(messages);
  const finalUser = finalUserIndex >= 0 ? messages[finalUserIndex] : undefined;
  const finalUserHasImages = finalUser?.role === "user" && contentHasImages(finalUser.content);

  if (finalUserHasImages && finalUser?.role === "user") {
    const history = messages
      .filter((_, index) => index !== finalUserIndex)
      .map(messageToReplayText)
      .filter(Boolean)
      .join("\n");
    const blocks: ClaudeInputBlock[] = [];
    if (history.trim()) blocks.push({ type: "text", text: history });
    blocks.push(...userContentToClaudeBlocks(finalUser));
    return blocks;
  }

  return messages.map(messageToReplayText).filter(Boolean).join("\n");
}

function userContentToClaudeInput(message: UserMessage): ClaudeUserInput {
  if (typeof message.content === "string") return message.content;
  return userContentToClaudeBlocks(message);
}

function userContentToClaudeBlocks(message: UserMessage): ClaudeInputBlock[] {
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];
  const blocks: ClaudeInputBlock[] = [];
  for (const block of message.content) {
    if (block.type === "text") blocks.push({ type: "text", text: block.text });
    else if (block.type === "image") blocks.push(imageToClaudeBlock(block));
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return blocks;
}

function toolResultsToClaudeBlocks(results: ToolResultMessage[]): ClaudeToolResultBlock[] {
  return results.map((result) => ({
    type: "tool_result",
    tool_use_id: result.toolCallId,
    content: toolResultContentToClaude(result.content),
    is_error: result.isError || undefined,
  }));
}

function toolResultContentToClaude(content: Array<TextContent | ImageContent>): ClaudeToolResultBlock["content"] {
  const blocks = content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    return imageToClaudeBlock(block);
  });
  if (blocks.length === 0) return "";
  return blocks;
}

function imageToClaudeBlock(block: ImageContent): Extract<ClaudeInputBlock, { type: "image" }> {
  return {
    type: "image",
    source: { type: "base64", media_type: block.mimeType, data: block.data },
  };
}

function messageToReplayText(message: PiMessage): string {
  if (message.role === "user") {
    return `USER:\n${contentToText(message.content)}`;
  }
  if (message.role === "assistant") {
    return `ASSISTANT:\n${assistantContentToText(message.content)}`;
  }
  return `TOOL RESULT (${message.toolName}, id=${message.toolCallId}):\n${contentToText(message.content)}${message.isError ? "\n[tool result marked as error]" : ""}`;
}

function assistantContentToText(content: PiMessage extends infer _ ? any[] : never): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "thinking") return "";
      if (block.type === "toolCall") {
        return `[Requested Pi tool ${block.name} with id ${block.id} and arguments ${JSON.stringify(block.arguments ?? {})}]`;
      }
      return `[${block.type}]`;
    })
    .filter(Boolean)
    .join("\n");
}

function contentToText(content: string | Array<TextContent | ImageContent>): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image attached]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function contentHasImages(content: string | Array<TextContent | ImageContent>): boolean {
  return Array.isArray(content) && content.some((block) => block.type === "image");
}

function findFinalUserIndex(messages: PiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

export function toolResultsToTextFallback(results: ToolResultMessage[]): string {
  return results
    .map((result) => `TOOL RESULT (${result.toolName}, id=${result.toolCallId}):\n${contentToText(result.content)}${result.isError ? "\n[tool result marked as error]" : ""}`)
    .join("\n\n");
}
