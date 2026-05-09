import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  isNoResponseRequestedSentinel,
  shouldRecordClaudeSessionMapping,
  shouldResumeClaudeSession,
} = await jiti.import("../src/session-policy.ts");

const baseMessage = (content) => ({
  role: "assistant",
  content,
  api: "pi-claude-code-cli",
  provider: "claude-code-cli",
  model: "sonnet",
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
});

test("does not resume Claude sessions for trailing Pi tool results", () => {
  assert.equal(shouldResumeClaudeSession(true, 0), true);
  assert.equal(shouldResumeClaudeSession(false, 0), false);
  assert.equal(shouldResumeClaudeSession(true, 1), false);
  assert.equal(shouldResumeClaudeSession(true, 3), false);
});

test("does not resume from existing no-response sentinel mappings", () => {
  const sentinel = baseMessage([{ type: "text", text: "No response requested." }]);
  assert.equal(shouldResumeClaudeSession(true, 0, [sentinel]), false);
});

test("does not record mappings for intercepted tool-use assistant messages", () => {
  const message = baseMessage([{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "package.json" } }]);
  assert.equal(shouldRecordClaudeSessionMapping(message), false);
});

test("does not record Claude Code's no-response sentinel", () => {
  const message = baseMessage([{ type: "text", text: "No response requested." }]);
  assert.equal(isNoResponseRequestedSentinel(message), true);
  assert.equal(shouldRecordClaudeSessionMapping(message), false);
});

test("records normal final assistant messages", () => {
  const message = baseMessage([{ type: "text", text: "Done." }]);
  assert.equal(isNoResponseRequestedSentinel(message), false);
  assert.equal(shouldRecordClaudeSessionMapping(message), true);
});
