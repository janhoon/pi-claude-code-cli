export interface IsolationFlags {
  strictMcpConfig: boolean;
  toolsDisabled: boolean;
  settingSourcesDisabled: boolean;
  claudeSlashCommandsDisabled: boolean;
}

export function buildIsolationArgs(): string[] {
  return [
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
  ];
}

export function assertIsolationArgs(args: string[]): IsolationFlags {
  const hasPair = (flag: string, value: string) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] === value;
  };

  const flags: IsolationFlags = {
    strictMcpConfig: args.includes("--strict-mcp-config"),
    toolsDisabled: hasPair("--tools", ""),
    settingSourcesDisabled: hasPair("--setting-sources", ""),
    claudeSlashCommandsDisabled: args.includes("--disable-slash-commands"),
  };

  const missing = Object.entries(flags)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Claude Code isolation flags missing: ${missing.join(", ")}`);
  }

  return flags;
}

export function contextAuditDisabledWarning(): string {
  return "Runtime /context audit is not enabled in this build; static isolation flags are enforced.";
}
