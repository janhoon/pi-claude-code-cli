import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  captureStderr,
  cleanupProcess,
  forceKillProcess,
  spawnClaude,
  writeUserMessage,
} from "./claude-cli.js";
import { handleControlRequest } from "./control-handler.js";
import { createEventBridge } from "./event-bridge.js";
import { generateMcpConfigForPiTools, type ToolExposureOptions } from "./mcp-config.js";
import { buildClaudeInput } from "./prompt.js";
import { ClaudeSessionMap, SESSION_MAP_ENTRY_TYPE, splitResumeBase } from "./session-map.js";
import { shouldRecordClaudeSessionMapping, shouldResumeClaudeSession } from "./session-policy.js";
import { isControlRequest, isResultMessage, isStreamEvent, parseClaudeLine } from "./stream-parser.js";
import { mapThinkingEffort } from "./thinking-config.js";
import type { PiMessage } from "./types.js";

const INACTIVITY_TIMEOUT_MS = 180_000;

export interface StreamViaClaudeCliOptions extends SimpleStreamOptions, ToolExposureOptions {
  cwd?: string;
}

export interface StreamViaClaudeCliDeps {
  pi: ExtensionAPI;
  sessionMap: ClaudeSessionMap;
}

export function streamViaClaudeCli(
  deps: StreamViaClaudeCliDeps,
  model: Model<any>,
  context: Context,
  options: StreamViaClaudeCliOptions = {},
) {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const cwd = options.cwd ?? process.cwd();
    const mcp = generateMcpConfigForPiTools(deps.pi, { exposeAllTools: options.exposeAllTools });
    const messages = context.messages as PiMessage[];
    const split = splitResumeBase(messages);
    const decision = deps.sessionMap.decide(split.baseMessages);
    const resume = shouldResumeClaudeSession(decision.resume, split.trailingToolResults.length, split.baseMessages);
    const claudeSessionId = resume ? decision.claudeSessionId : randomUUID();
    const prompt = buildClaudeInput(messages, resume).input;
    const bridge = createEventBridge(stream, model, mcp.activeToolNames);
    const effort = mapThinkingEffort(options.reasoning, model.id, options.thinkingBudgets);

    let proc: ReturnType<typeof spawnClaude> | undefined;
    let streamEnded = false;
    let intentionalBreak = false;
    let gotResult = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;

    const endWithError = (message: string) => {
      if (streamEnded) return;
      streamEnded = true;
      bridge.ensureStarted();
      const output = bridge.getOutput();
      const errorMessage: AssistantMessage = {
        ...output,
        content: output.content.length > 0 ? output.content : [{ type: "text", text: `Error: ${message}` }],
        stopReason: "error",
        errorMessage: message,
      };
      stream.push({ type: "error", reason: "error", error: errorMessage });
      stream.end(errorMessage);
    };

    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (proc) forceKillProcess(proc);
        endWithError(`Claude CLI produced no output for ${INACTIVITY_TIMEOUT_MS / 1000} seconds.`);
      }, INACTIVITY_TIMEOUT_MS);
    };

    try {
      proc = spawnClaude({
        modelId: model.id,
        cwd,
        systemPrompt: context.systemPrompt ?? "",
        mcpConfigPath: mcp.configPath,
        signal: options.signal,
        resumeSessionId: resume ? claudeSessionId : undefined,
        newSessionId: resume ? undefined : claudeSessionId,
        effort,
      });
      const getStderr = captureStderr(proc);

      writeUserMessage(proc, prompt.content);
      resetInactivityTimer();

      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity, terminal: false });

      proc.once("error", (error) => {
        if (!intentionalBreak) endWithError(getStderr() || error.message);
      });

      proc.once("close", (code, signal) => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (intentionalBreak || streamEnded) return;
        if (!gotResult && code !== 0 && code !== null) {
          const stderr = getStderr().trim();
          endWithError(stderr || `Claude CLI exited with code ${code}${signal ? ` (${signal})` : ""}.`);
        }
      });

      rl.on("line", (line) => {
        resetInactivityTimer();
        const message = parseClaudeLine(line);
        if (!message || streamEnded || intentionalBreak) return;

        if (isStreamEvent(message)) {
          if (message.parent_tool_use_id) return;
          bridge.handleEvent(message.event);

          const violation = bridge.getViolation();
          if (violation) {
            intentionalBreak = true;
            forceKillProcess(proc!);
            rl.close();
            endWithError(violation.message);
            return;
          }

          if (message.event.type === "message_stop" && bridge.hasPiToolCalls()) {
            intentionalBreak = true;
            forceKillProcess(proc!);
            rl.close();
          }
          return;
        }

        if (isControlRequest(message)) {
          const decision = handleControlRequest(message, proc!, mcp.activeToolNames);
          if (!decision.allowed) {
            intentionalBreak = true;
            forceKillProcess(proc!);
            rl.close();
            endWithError(decision.reason ?? "Claude requested a non-Pi tool.");
          }
          return;
        }

        if (isResultMessage(message)) {
          gotResult = true;
          if (message.subtype && message.subtype !== "success") {
            endWithError(message.error ?? message.result ?? `Claude CLI result subtype: ${message.subtype}`);
            cleanupProcess(proc!);
            rl.close();
            return;
          }
          cleanupProcess(proc!);
          rl.close();
        }
      });

      await new Promise<void>((resolve) => rl.once("close", resolve));

      if (!streamEnded) {
        bridge.ensureStarted();
        const output = bridge.getOutput();
        const hasTools = bridge.hasPiToolCalls();
        const stopReason = hasTools ? "toolUse" : output.stopReason === "length" ? "length" : "stop";
        const finalMessage: AssistantMessage = { ...output, stopReason };
        streamEnded = true;
        stream.push({ type: "done", reason: stopReason, message: finalMessage });
        stream.end(finalMessage);

        if (shouldRecordClaudeSessionMapping(finalMessage)) {
          const mapping = deps.sessionMap.record(messages, finalMessage, claudeSessionId);
          deps.pi.appendEntry(SESSION_MAP_ENTRY_TYPE, mapping);
        }
      }
    } catch (error) {
      endWithError(error instanceof Error ? error.message : String(error));
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      mcp.cleanup();
    }
  })();

  return stream;
}
