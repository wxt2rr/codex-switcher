import type { SwitcherState, TargetName } from "../state/store.js";

const DEFAULT_ENV_NAME = "default";
const DEFAULT_ACCOUNT_NAME = "default";

export interface EnvSummary {
  name: string;
  path: string;
  isCurrentCli: boolean;
  isCurrentApp: boolean;
  accountCount: number;
}

export interface CreateEnvInput {
  envName: string;
  homePath: string;
  cloneFromEnv?: string;
  now: string;
}

export interface RemoveEnvInput {
  envName: string;
}

export interface UpdateEnvInput {
  envName: string;
  nextEnvName: string;
  homePath: string;
  now: string;
}

export interface SelectEnvInput {
  target: TargetName;
  envName: string;
  now: string;
}

export interface EnvServiceError extends Error {
  code:
    | "ENV_EXISTS"
    | "ENV_NOT_FOUND"
    | "RESERVED_ENV";
}

export function createEnvService() {
  return {
    listEnvs(state: SwitcherState): EnvSummary[] {
      return Object.values(state.envs)
        .map((env) => ({
          name: env.name,
          path: env.path,
          isCurrentCli: state.targets.cli.env === env.name,
          isCurrentApp: state.targets.app.env === env.name,
          accountCount: Object.keys(env.accounts).length,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    createEnv(state: SwitcherState, input: CreateEnvInput): SwitcherState {
      if (state.envs[input.envName]) {
        throw createEnvError("ENV_EXISTS", `Env '${input.envName}' already exists`);
      }

      if (input.cloneFromEnv && !state.envs[input.cloneFromEnv]) {
        throw createEnvError(
          "ENV_NOT_FOUND",
          `Clone source env '${input.cloneFromEnv}' not found`,
        );
      }

      return {
        ...state,
        generatedAt: input.now,
        envs: {
          ...state.envs,
          [input.envName]: {
            name: input.envName,
            path: input.homePath,
            accounts: {},
          },
        },
      };
    },

    removeEnv(state: SwitcherState, input: RemoveEnvInput): SwitcherState {
      if (input.envName === DEFAULT_ENV_NAME) {
        throw createEnvError("RESERVED_ENV", "Cannot remove reserved default env");
      }

      if (!state.envs[input.envName]) {
        throw createEnvError("ENV_NOT_FOUND", `Env '${input.envName}' not found`);
      }

      const envs = { ...state.envs };
      delete envs[input.envName];

      return {
        ...state,
        envs,
        targets: {
          cli:
            state.targets.cli.env === input.envName
              ? { env: DEFAULT_ENV_NAME, account: DEFAULT_ACCOUNT_NAME }
              : state.targets.cli,
          app:
            state.targets.app.env === input.envName
              ? { env: DEFAULT_ENV_NAME, account: DEFAULT_ACCOUNT_NAME }
              : state.targets.app,
        },
      };
    },

    updateEnv(state: SwitcherState, input: UpdateEnvInput): SwitcherState {
      const env = state.envs[input.envName];
      if (!env) {
        throw createEnvError("ENV_NOT_FOUND", `Env '${input.envName}' not found`);
      }

      if (
        input.envName === DEFAULT_ENV_NAME &&
        input.nextEnvName !== DEFAULT_ENV_NAME
      ) {
        throw createEnvError("RESERVED_ENV", "Cannot rename reserved default env");
      }

      if (
        input.nextEnvName !== input.envName &&
        state.envs[input.nextEnvName]
      ) {
        throw createEnvError("ENV_EXISTS", `Env '${input.nextEnvName}' already exists`);
      }

      const nextEnv = {
        ...env,
        name: input.nextEnvName,
        path: input.homePath,
      };
      const envs = { ...state.envs };
      delete envs[input.envName];
      envs[input.nextEnvName] = nextEnv;

      return {
        ...state,
        generatedAt: input.now,
        envs,
        targets: {
          cli:
            state.targets.cli.env === input.envName
              ? { ...state.targets.cli, env: input.nextEnvName }
              : state.targets.cli,
          app:
            state.targets.app.env === input.envName
              ? { ...state.targets.app, env: input.nextEnvName }
              : state.targets.app,
        },
      };
    },

    selectEnv(state: SwitcherState, input: SelectEnvInput): SwitcherState {
      const env = state.envs[input.envName];
      if (!env) {
        throw createEnvError("ENV_NOT_FOUND", `Env '${input.envName}' not found`);
      }

      const currentAccount = state.targets[input.target].account;
      const otherTarget: TargetName = input.target === "cli" ? "app" : "cli";
      const otherPointer = state.targets[otherTarget];
      const sharedAccount = otherPointer.env === input.envName && env.accounts[otherPointer.account]
        ? otherPointer.account
        : undefined;
      const nextAccount = sharedAccount ?? (
        env.accounts[currentAccount] ? currentAccount : DEFAULT_ACCOUNT_NAME
      );

      return {
        ...state,
        generatedAt: input.now,
        targets: {
          ...state.targets,
          [input.target]: {
            env: input.envName,
            account: nextAccount,
          },
        },
      };
    },
  };
}

function createEnvError(code: EnvServiceError["code"], message: string): EnvServiceError {
  const error = new Error(message) as EnvServiceError;
  error.code = code;
  return error;
}
