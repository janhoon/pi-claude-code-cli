import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import type { ClaudeUserInput } from "./types.js";
import { assertIsolationArgs, buildIsolationArgs } from "./context-audit.js";
import { allowedPiMcpWildcard } from "./mcp-config.js";

export interface SpawnClaudeOptions {
  modelId: string;
  cwd: string;
  systemPrompt?: string;
  mcpConfigPath: string;
  signal?: AbortSignal;
  resumeSessionId?: string;
  newSessionId?: string;
  effort?: string;
}

const activeProcesses = new Set<ChildProcess>();

export function claudeCommand(): string {
  if (process.env.CLAUDE_CODE_CLI) return process.env.CLAUDE_CODE_CLI;
  return process.platform === "win32" ? "claude.cmd" : "claude";
}

export function validateClaudeCli(): void {
  try {
    execFileSync(claudeCommand(), ["--version"], { stdio: "pipe", timeout: 5000 });
  } catch {
    throw new Error("Claude Code CLI not found. Install and authenticate the official Claude Code CLI, then ensure `claude` is on PATH.");
  }
}

export function warnIfClaudeAuthMissing(): void {
  try {
    execFileSync(claudeCommand(), ["auth", "status"], { stdio: "pipe", timeout: 5000 });
  } catch {
    console.warn("[pi-claude-code-cli] Claude CLI auth status check failed. Run `claude auth login` if requests fail.");
  }
}

export function spawnClaude(options: SpawnClaudeOptions): ChildProcess {
  const isolationArgs = buildIsolationArgs();
  assertIsolationArgs(isolationArgs);

  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    options.modelId,
    ...isolationArgs,
    "--mcp-config",
    options.mcpConfigPath,
    "--allowedTools",
    allowedPiMcpWildcard(),
  ];

  if (options.systemPrompt !== undefined) {
    args.push("--system-prompt", options.systemPrompt);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.newSessionId) {
    args.push("--session-id", options.newSessionId);
  }

  const proc = spawn(claudeCommand(), args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // Keep any hidden Claude-side dynamic features off where current CLI honors it.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? "1",
    },
  });

  registerProcess(proc);

  if (options.signal) {
    const abort = () => forceKillProcess(proc);
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
    proc.once("exit", () => options.signal?.removeEventListener("abort", abort));
  }

  return proc;
}

export function writeUserMessage(proc: ChildProcess, content: ClaudeUserInput): void {
  proc.stdin?.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content },
    }) + "\n",
  );
}

export function captureStderr(proc: ChildProcess): () => string {
  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return () => stderr;
}

export function registerProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
  proc.once("exit", () => activeProcesses.delete(proc));
}

export function forceKillProcess(proc: ChildProcess): void {
  if (proc.killed || proc.exitCode !== null) return;
  proc.kill("SIGKILL");
}

export function cleanupProcess(proc: ChildProcess): void {
  setTimeout(() => forceKillProcess(proc), 250);
}

export function killAllClaudeProcesses(): void {
  for (const proc of activeProcesses) forceKillProcess(proc);
  activeProcesses.clear();
}
