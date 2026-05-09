import type { ThinkingBudgets, ThinkingLevel } from "@earendil-works/pi-ai";

export function mapThinkingEffort(
  reasoning: ThinkingLevel | undefined,
  modelId: string,
  _budgets?: ThinkingBudgets,
): string | undefined {
  if (!reasoning) return undefined;
  switch (reasoning) {
    case "minimal":
      return "low";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return modelId.toLowerCase().includes("opus") ? "xhigh" : "high";
    case "xhigh":
      return "xhigh";
    default:
      return undefined;
  }
}
