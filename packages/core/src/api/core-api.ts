import { createAccountService } from "../domain/account-service.js";
import { createEnvService } from "../domain/env-service.js";
import type { SwitcherState } from "../state/store.js";

export interface CoreApiOptions {
  getState(): SwitcherState;
}

export function createCoreApi(options: CoreApiOptions) {
  const envs = createEnvService();
  const accounts = createAccountService();

  return {
    getOverview() {
      const state = options.getState();
      return {
        generatedAt: state.generatedAt,
        current: state.targets,
        status: {
          cli: describeTargetStatus(state, "cli"),
          app: describeTargetStatus(state, "app"),
          tokenRefresh: {
            guard: "unknown",
            needReloginLastRun: findNeedReloginCount(state),
          },
        },
        envs: envs.listEnvs(state),
        accounts: Object.keys(state.envs)
          .sort((a, b) => a.localeCompare(b))
          .flatMap((envName) =>
            accounts.listAccounts(state, { envName }).map((account) => ({
              envName,
              ...account,
              apiKeyPreview: maskApiKey(
                state.envs[envName]?.accounts[account.name]?.authData?.OPENAI_API_KEY,
              ),
            })),
          ),
        recentTasks: state.tasks.recent,
      };
    },

    listEnvs() {
      return envs.listEnvs(options.getState());
    },

    listAccounts() {
      const state = options.getState();
      return Object.keys(state.envs)
        .sort((a, b) => a.localeCompare(b))
        .flatMap((envName) =>
          accounts.listAccounts(state, { envName }).map((account) => ({
            envName,
            ...account,
            apiKeyPreview: maskApiKey(
              state.envs[envName]?.accounts[account.name]?.authData?.OPENAI_API_KEY,
            ),
          })),
        );
    },

    selectEnv(input: {
      target: "cli" | "app";
      envName: string;
      now: string;
    }) {
      return envs.selectEnv(options.getState(), input);
    },

    selectAccount(input: {
      target: "cli" | "app";
      envName: string;
      accountName: string;
      now: string;
    }) {
      return accounts.selectAccount(options.getState(), input);
    },

    createEnv(input: {
      envName: string;
      homePath: string;
      cloneFromEnv?: string;
      now: string;
    }) {
      return envs.createEnv(options.getState(), input);
    },

    updateEnv(input: {
      envName: string;
      nextEnvName: string;
      homePath: string;
      now: string;
    }) {
      return envs.updateEnv(options.getState(), input);
    },

    updateAccountRuntime(input: {
      envName: string;
      accountName: string;
      runtime: SwitcherState["envs"][string]["accounts"][string]["runtime"];
      now: string;
    }) {
      return accounts.updateRuntime(options.getState(), input);
    },

    getStatus() {
      const state = options.getState();
      return {
        cli: describeTargetStatus(state, "cli"),
        app: describeTargetStatus(state, "app"),
        tokenRefresh: {
          guard: "unknown",
          needReloginLastRun: findNeedReloginCount(state),
        },
      };
    },

    getAccounts(envName: string) {
      return accounts.listAccounts(options.getState(), { envName });
    },
  };
}

function describeTargetStatus(state: SwitcherState, target: "cli" | "app") {
  const pointer = state.targets[target];
  const account = state.envs[pointer.env]?.accounts[pointer.account];

  return {
    current: `${pointer.env}/${pointer.account}`,
    auth: describeAuth(state, target),
    authExpiry: describeAuthExpiry(account),
    loginState: account ? "logged-in" : "not-logged-in",
  };
}

function describeAuth(state: SwitcherState, target: "cli" | "app"): string {
  const pointer = state.targets[target];
  const account = state.envs[pointer.env]?.accounts[pointer.account];
  if (!account) {
    return "unknown";
  }

  if (account.runtime.preferredAuthMethod === "apikey") {
    const baseUrl =
      account.runtime.openaiBaseUrlMode === "custom" && account.runtime.openaiBaseUrl
        ? account.runtime.openaiBaseUrl
        : "default";
    return `apikey | base_url: ${baseUrl}`;
  }

  return "chatgpt";
}

function describeAuthExpiry(
  account: SwitcherState["envs"][string]["accounts"][string] | undefined,
): string {
  if (!account?.authData?.tokens) {
    return "-";
  }

  try {
    const tokens = JSON.parse(account.authData.tokens) as { access_token?: string };
    const accessToken = tokens.access_token;
    if (!accessToken) {
      return "-";
    }

    const [, payload = ""] = accessToken.split(".");
    if (!payload) {
      return "-";
    }

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };

    if (typeof claims.exp !== "number" || claims.exp <= 0) {
      return "-";
    }

    return new Date(claims.exp * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(".000", "");
  } catch {
    return "-";
  }
}

function findNeedReloginCount(state: SwitcherState): string {
  for (const task of [...state.tasks.recent].reverse()) {
    if (task.kind !== "token-refresh" || !task.summary) {
      continue;
    }

    const match = task.summary.match(/need_relogin=(\d+)/);
    if (match) {
      return match[1];
    }
  }

  return "0";
}

function maskApiKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= 7) {
    return "***";
  }

  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}
