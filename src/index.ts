import { getModels, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { killAllClaudeProcesses, validateClaudeCli, warnIfClaudeAuthMissing } from "./claude-cli.js";
import { streamViaClaudeCli } from "./provider.js";
import { ClaudeSessionMap } from "./session-map.js";

const PROVIDER_ID = "claude-code-cli";

process.once("exit", killAllClaudeProcesses);

export default function piClaudeCodeCli(pi: ExtensionAPI) {
  const sessionMap = new ClaudeSessionMap();

  try {
    validateClaudeCli();
    warnIfClaudeAuthMissing();
  } catch (error) {
    console.error(`[pi-claude-code-cli] ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionMap.restoreFromBranchEntries(ctx.sessionManager.getBranch());
  });

  pi.registerProvider(PROVIDER_ID, {
    name: "Claude Code CLI",
    baseUrl: "claude-code-cli",
    apiKey: "unused",
    api: "claude-code-cli",
    models: buildClaudeCodeModels(),
    streamSimple: (model, context, options) =>
      streamViaClaudeCli(
        { pi, sessionMap },
        model,
        context,
        {
          ...options,
          exposeAllTools: process.env.PI_CLAUDE_CODE_EXPOSE_ALL_TOOLS === "1",
        },
      ),
  });
}

function buildClaudeCodeModels(): ProviderModelConfig[] {
  const anthropicModels = getModels("anthropic") as Model<any>[];
  const models = anthropicModels.map(toProviderModelConfig);

  const sonnet = [...models].reverse().find((model) => /sonnet/i.test(`${model.id} ${model.name}`));
  const opus = [...models].reverse().find((model) => /opus/i.test(`${model.id} ${model.name}`));

  const aliases: ProviderModelConfig[] = [];
  if (sonnet) aliases.push({ ...sonnet, id: "sonnet", name: "Claude Sonnet (Claude Code alias)" });
  if (opus) aliases.push({ ...opus, id: "opus", name: "Claude Opus (Claude Code alias)" });

  return [...aliases, ...models];
}

function toProviderModelConfig(model: Model<any>): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}
