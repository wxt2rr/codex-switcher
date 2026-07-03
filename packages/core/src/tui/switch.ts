export type SwitchTarget = "cli" | "app";

export interface SwitchEnvOption {
  name: string;
  isCurrentCli?: boolean;
  isCurrentApp?: boolean;
}

export interface SwitchAccountOption {
  envName: string;
  name: string;
  authMode: string;
  isCurrentCli?: boolean;
  isCurrentApp?: boolean;
  runtime?: {
    preferredAuthMethod?: string;
  };
}

export function listTargetOptions(): SwitchTarget[] {
  return ["cli", "app"];
}

export function listEnvOptions(
  envs: SwitchEnvOption[],
  target: SwitchTarget,
): SwitchEnvOption[] {
  return [...envs].sort((a, b) => {
    const aCurrent = target === "cli" ? Boolean(a.isCurrentCli) : Boolean(a.isCurrentApp);
    const bCurrent = target === "cli" ? Boolean(b.isCurrentCli) : Boolean(b.isCurrentApp);
    if (aCurrent !== bCurrent) {
      return aCurrent ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function listAccountOptions(
  accounts: SwitchAccountOption[],
  envName: string,
  target: SwitchTarget,
): SwitchAccountOption[] {
  return accounts
    .filter((account) => account.envName === envName)
    .sort((a, b) => {
      const aCurrent = target === "cli" ? Boolean(a.isCurrentCli) : Boolean(a.isCurrentApp);
      const bCurrent = target === "cli" ? Boolean(b.isCurrentCli) : Boolean(b.isCurrentApp);
      if (aCurrent !== bCurrent) {
        return aCurrent ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

export function renderSwitchSummary(input: {
  target: SwitchTarget;
  envName: string;
  accountName: string;
  actionLabel?: string;
}): string {
  return [
    "codex-sw-node - Switch",
    "",
    `Target:  ${input.target}`,
    `Env:     ${input.envName}`,
    `Account: ${input.accountName}`,
    `Action:  ${input.actionLabel ?? "switch-only"}`,
    "",
    "Enter confirm  Esc/q back",
    "",
  ].join("\n");
}
