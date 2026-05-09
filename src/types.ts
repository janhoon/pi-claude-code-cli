import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

export type PiMessage = UserMessage | AssistantMessage | ToolResultMessage;

export type ClaudeStreamJsonMessage =
  | ClaudeStreamEventMessage
  | ClaudeResultMessage
  | ClaudeControlRequestMessage
  | Record<string, unknown>;

export interface ClaudeStreamEventMessage {
  type: "stream_event";
  parent_tool_use_id?: string | null;
  event: ClaudeApiEvent;
}

export interface ClaudeResultMessage {
  type: "result";
  subtype?: string;
  result?: string;
  error?: string;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

export interface ClaudeControlRequestMessage {
  type: "control_request";
  request_id?: string;
  request?: {
    tool_name?: string;
    tool_use_id?: string;
    input?: unknown;
    [key: string]: unknown;
  };
}

export type ClaudeApiEvent = {
  type: string;
  index?: number;
  message?: {
    usage?: ClaudeUsage;
    model?: string;
    [key: string]: unknown;
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: unknown;
    text?: string;
    thinking?: string;
    [key: string]: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
    stop_reason?: string;
    [key: string]: unknown;
  };
  usage?: ClaudeUsage;
  [key: string]: unknown;
};

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export type ClaudeUserInput = string | ClaudeInputBlock[];

export type ClaudeInputBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | ClaudeToolResultBlock;

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }>;
  is_error?: boolean;
}

export type PiContentBlock = TextContent | ImageContent;

export interface ClaudeTurnInput {
  content: ClaudeUserInput;
  kind: "user" | "tool_results" | "replay";
  /** Hash of the Pi branch prefix that this input extends when resuming. */
  resumeBaseHash?: string;
}

export interface PiToolDefinitionForMcp {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
