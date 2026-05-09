import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createHash, randomUUID } from "node:crypto";
import type { PiMessage } from "./types.js";

export const SESSION_MAP_ENTRY_TYPE = "pi-claude-code-cli-session-map";

export interface ClaudeSessionMappingEntry {
  contextHash: string;
  claudeSessionId: string;
  recordedAt: number;
}

export interface ResumeDecision {
  claudeSessionId: string;
  resume: boolean;
  baseHash: string;
}

export class ClaudeSessionMap {
  private byContextHash = new Map<string, string>();

  restoreFromBranchEntries(entries: readonly any[]): void {
    this.byContextHash.clear();
    for (const entry of entries) {
      if (entry?.type !== "custom") continue;
      if (entry.customType !== SESSION_MAP_ENTRY_TYPE) continue;
      const data = entry.data as ClaudeSessionMappingEntry | undefined;
      if (!data?.contextHash || !data?.claudeSessionId) continue;
      this.byContextHash.set(data.contextHash, data.claudeSessionId);
    }
  }

  decide(baseMessages: PiMessage[]): ResumeDecision {
    const baseHash = hashMessages(baseMessages);
    const existing = this.byContextHash.get(baseHash);
    if (existing) {
      return { claudeSessionId: existing, resume: true, baseHash };
    }
    return { claudeSessionId: randomUUID(), resume: false, baseHash };
  }

  record(contextMessages: PiMessage[], assistant: AssistantMessage, claudeSessionId: string): ClaudeSessionMappingEntry {
    const contextHash = hashMessages([...contextMessages, assistant]);
    this.byContextHash.set(contextHash, claudeSessionId);
    return { contextHash, claudeSessionId, recordedAt: Date.now() };
  }
}

export function hashMessages(messages: readonly PiMessage[]): string {
  const canonical = messages.map(canonicalizeMessage).join("\n---\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function splitResumeBase(messages: readonly PiMessage[]): {
  baseMessages: PiMessage[];
  trailingToolResults: PiMessage[];
  finalUserMessage: PiMessage | undefined;
} {
  const result = {
    baseMessages: [...messages] as PiMessage[],
    trailingToolResults: [] as PiMessage[],
    finalUserMessage: undefined as PiMessage | undefined,
  };

  if (messages.length === 0) return result;

  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.role === "toolResult") {
    result.trailingToolResults.unshift(messages[index]);
    index--;
  }
  if (result.trailingToolResults.length > 0) {
    result.baseMessages = messages.slice(0, index + 1) as PiMessage[];
    return result;
  }

  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    result.finalUserMessage = last;
    result.baseMessages = messages.slice(0, -1) as PiMessage[];
  }
  return result;
}

function canonicalizeMessage(message: PiMessage): string {
  if (message.role === "user") {
    return stableStringify({ role: message.role, content: message.content });
  }
  if (message.role === "assistant") {
    return stableStringify({ role: message.role, provider: message.provider, model: message.model, content: message.content });
  }
  return stableStringify({
    role: message.role,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    content: message.content,
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
