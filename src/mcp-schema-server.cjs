#!/usr/bin/env node
// Schema-only MCP server for pi-claude-code-cli.
// It intentionally exposes tool schemas but does not execute tools. The parent
// provider breaks the Claude CLI stream at assistant message_stop and routes the
// resulting tool calls back through Pi's native tool loop.
"use strict";

const fs = require("node:fs");
const readline = require("node:readline");

const schemaPath = process.argv[2];
if (!schemaPath) process.exit(1);

let tools = [];
try {
  tools = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  if (!Array.isArray(tools)) tools = [];
} catch {
  process.exit(1);
}

function send(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error) response.error = error;
  else response.result = result;
  process.stdout.write(JSON.stringify(response) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (!msg || typeof msg !== "object") return;
  if (msg.id === undefined && msg.id === null) return;

  switch (msg.method) {
    case "initialize":
      send(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "pi", version: "1.0.0" },
      });
      break;
    case "tools/list":
      send(msg.id, { tools });
      break;
    case "tools/call":
      send(msg.id, {
        content: [
          {
            type: "text",
            text:
              "This MCP server is schema-only. Pi will execute this tool natively after intercepting the tool call.",
          },
        ],
        isError: true,
      });
      break;
    default:
      send(msg.id, undefined, { code: -32601, message: `Method not found: ${msg.method}` });
      break;
  }
});
