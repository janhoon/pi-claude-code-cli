import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { PiMessage } from "./types.js";

export function shouldResumeClaudeSession(
  hasMappedSession: boolean,
  trailingToolResultCount: number,
  baseMessages: readonly PiMessage[] = [],
): boolean {
  // Claude Code does not persist the intercepted assistant tool-use message when
  // pi-claude-code-cli kills the process before Claude executes the tool. If we
  // resume that Claude session with only Pi tool results, Claude sees orphaned
  // "TOOL RESULT" user text and can answer with its internal sentinel:
  // "No response requested." Use a full Pi replay instead after tool results.
  if (!hasMappedSession || trailingToolResultCount > 0) return false;

  // Existing sessions may already contain mappings recorded for the sentinel.
  // Do not resume from those corrupted Claude-side histories; replay Pi context.
  const last = baseMessages.at(-1);
  if (last?.role === "assistant" && isNoResponseRequestedSentinel(last)) return false;

  return true;
}

export function shouldRecordClaudeSessionMapping(message: AssistantMessage): boolean {
  if (message.content.some((block) => block.type === "toolCall")) return false;
  if (isNoResponseRequestedSentinel(message)) return false;
  return true;
}

export function isNoResponseRequestedSentinel(message: AssistantMessage): boolean {
  const visibleText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .join("\n")
    .trim();

  if (visibleText !== "No response requested.") return false;

  return message.content.every((block) => {
    if (block.type === "text") return block.text.trim() === "No response requested.";
    if (block.type === "thinking") return !block.thinking.trim();
    return false;
  });
}
