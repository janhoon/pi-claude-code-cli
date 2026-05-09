import type { ClaudeStreamJsonMessage } from "./types.js";

export function parseClaudeLine(line: string): ClaudeStreamJsonMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as ClaudeStreamJsonMessage;
  } catch {
    return undefined;
  }
}

export function isStreamEvent(message: ClaudeStreamJsonMessage): message is Extract<ClaudeStreamJsonMessage, { type: "stream_event" }> {
  return message.type === "stream_event" && typeof (message as any).event === "object";
}

export function isResultMessage(message: ClaudeStreamJsonMessage): message is Extract<ClaudeStreamJsonMessage, { type: "result" }> {
  return message.type === "result";
}

export function isControlRequest(message: ClaudeStreamJsonMessage): message is Extract<ClaudeStreamJsonMessage, { type: "control_request" }> {
  return message.type === "control_request";
}
