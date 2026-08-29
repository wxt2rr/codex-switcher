import { cp, readdir, rm } from "node:fs/promises";

import { createCoreApi } from "../packages/core/src/api/core-api.js";
import { createAccountService } from "../packages/core/src/domain/account-service.js";
import { createEnvService } from "../packages/core/src/domain/env-service.js";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { resolveRuntimePaths } from "../packages/core/src/platform/runtime.js";
import { formatWhoami } from "../packages/core/src/cli.js";
import {
  createLegacyEnv,
  readLegacyState,
  writeLegacyPointers,
  writeLegacyRuntime,
} from "../packages/core/src/state/legacy.js";
import type { SwitcherState } from "../packages/core/src/state/store.js";
import {
  applyTargetHomeState,
  repairLegacyTargetHomeConfigs,
} from "../packages/core/src/system/target-home.js";

type Command =
  | "whoami"
  | "env-ls"
  | "account-ls"
  | "status"
  | "overview"
  | "env-use"
  | "account-use"
  | "env-new"
  | "runtime-update"
  | "account-rm"
  | "env-rm"
  | "account-logout";
type CommandTarget = "cli" | "app" | "both";

export async function executeAccountUse(input: {
  envName: string;
  accountName: string;
  target: CommandTarget;
}): Promise<SwitcherState> {
  const { stateDir, envsDir, defaultHome } = resolveRuntimePaths();
  const state = await readLegacyState({
    stateDir,
    envsDir,
    defaultHome,
  });

  return applySelectAccount({
    state,
    stateDir,
    envName: input.envName,
    accountName: input.accountName,
    target: input.target,
  });
}

export async function runCoreCli(
  argv: string[],
  io: Pick<typeof process, "stdout" | "stderr"> = process,
): Promise<number> {
  const [command = "", arg1 = "all", arg2 = "", arg3 = "", arg4 = ""] = argv;
  const { stateDir, envsDir, defaultHome } = resolveRuntimePaths();
  let state = await readLegacyState({
    stateDir,
    envsDir,
    defaultHome,
  });
  await repairLegacyTargetHomeConfigs({ state });

  switch (command as Command) {
    case "whoami": {
      io.stdout.write(
        `${formatWhoami(state, arg1 === "both" ? "all" : (arg1 as "cli" | "app" | "all"))}\n`,
      );
      return 0;
    }
    case "env-ls": {
      for (const env of createApi(state).listEnvs()) {
        let marks = "";
        if (env.isCurrentCli) marks += " [cli-current]";
        if (env.isCurrentApp) marks += " [app-current]";
        io.stdout.write(`- ${env.name}${marks}\n`);
      }
      return 0;
    }
    case "account-ls": {
      const envName = arg1;
      if (envName) {
        for (const account of createApi(state).getAccounts(envName)) {
          let marks = "";
          if (account.isCurrentCli) marks += " [cli-current]";
          if (account.isCurrentApp) marks += " [app-current]";
          io.stdout.write(`- ${account.name}${marks}\n`);
        }
        return 0;
      }

      for (const account of createApi(state).listAccounts()) {
        let marks = "";
        if (account.isCurrentCli) marks += " [cli-current]";
        if (account.isCurrentApp) marks += " [app-current]";
        io.stdout.write(`- ${account.envName}/${account.name}${marks}\n`);
      }
      return 0;
    }
    case "status": {
      const status = createApi(state).getStatus();
      io.stdout.write(`cli_current: ${status.cli.current}\n`);
      io.stdout.write(`app_current: ${status.app.current}\n`);
      io.stdout.write(`cli_auth_path: managed-by-core\n`);
      io.stdout.write(`app_auth_path: managed-by-core\n`);
      io.stdout.write(`cli_auth: ${status.cli.auth}\n`);
      io.stdout.write(`app_auth: ${status.app.auth}\n`);
      io.stdout.write(`cli_auth_expiry: ${status.cli.authExpiry}\n`);
      io.stdout.write(`app_auth_expiry: ${status.app.authExpiry}\n`);
      io.stdout.write(`token_refresh_guard: ${status.tokenRefresh.guard}\n`);
      io.stdout.write(
        `token_refresh_need_relogin_last_run: ${status.tokenRefresh.needReloginLastRun}\n`,
      );
      io.stdout.write(`cli(${status.cli.current}): ${status.cli.loginState}\n`);
      io.stdout.write(`app(${status.app.current}): ${status.app.loginState}\n`);
      return 0;
    }
    case "overview": {
      io.stdout.write(`${JSON.stringify(createApi(state).getOverview(), null, 2)}\n`);
      return 0;
    }
    case "env-use": {
      const envName = arg1;
      const target = (arg2 || "cli") as CommandTarget;
      if (!envName) {
        throw new Error("usage: env-use <env> <cli|app|both>");
      }
      state = await applySelectEnv({
        state,
        stateDir,
        envName,
        target,
      });
      io.stdout.write(formatTargetSelection(state, target));
      return 0;
    }
    case "account-use": {
      const envName = arg1;
      const accountName = arg2;
      const target = (arg3 || "cli") as CommandTarget;
      const sync = arg4 === "true";
      if (!envName || !accountName) {
        throw new Error("usage: account-use <env> <account> <cli|app|both> [true|false]");
      }
      if (sync) {
        io.stderr.write("Warning: same-env account switch only replaces auth.json; --sync is ignored\n");
      }
      state = await executeAccountUse({
        envName,
        accountName,
        target,
      });
      io.stdout.write(formatTargetSelection(state, target));
      return 0;
    }
    case "env-new": {
      const envName = arg1;
      const mode = arg2 || "from-default";
      const srcEnv = arg3;
      if (!envName) {
        throw new Error("usage: env-new <env> [empty|from-default|from-env] [src-env]");
      }
      state = createApi(state).createEnv({
        envName,
        homePath: envName === "default" ? defaultHome : `${envsDir}/${envName}/home`,
        now: new Date().toISOString(),
      });
      const created = state.envs[envName];
      if (!created) {
        throw new Error(`failed to create env '${envName}'`);
      }
      await createLegacyEnv({
        envsDir,
        envName,
      });
      if (mode === "from-default") {
        await cloneEnvHomeExcludingAuth(defaultHome, created.path);
      } else if (mode === "from-env") {
        const sourcePath = state.envs[srcEnv]?.path;
        if (!srcEnv || !sourcePath) {
          throw new Error(`source env '${srcEnv || ""}' not found`);
        }
        await cloneEnvHomeExcludingAuth(sourcePath, created.path);
      } else if (mode !== "empty") {
        throw new Error(`unknown env create mode: ${mode}`);
      }
      io.stdout.write(`${created.name}\n`);
      return 0;
    }
    case "runtime-update": {
      const envName = arg1;
      const accountName = arg2;
      const baseUrl = arg3;
      if (!envName || !accountName) {
        throw new Error("usage: runtime-update <env> <account> <baseUrl|default>");
      }
      state = createApi(state).updateAccountRuntime({
        envName,
        accountName,
        runtime: {
          preferredAuthMethod: baseUrl && baseUrl !== "default" ? "apikey" : "chatgpt",
          openaiBaseUrlMode: baseUrl && baseUrl !== "default" ? "custom" : "default",
          openaiBaseUrl: baseUrl && baseUrl !== "default" ? baseUrl : undefined,
        },
        now: new Date().toISOString(),
      });
      const account = state.envs[envName]?.accounts[accountName];
      if (!account) {
        throw new Error(`failed to update runtime for '${envName}/${accountName}'`);
      }
      await writeLegacyRuntime({
        stateDir,
        envName,
        accountName,
        runtime: account.runtime,
      });
      await applyRuntimeToActiveTargets({
        state,
        envName,
        accountName,
      });
      io.stdout.write(
        `${envName}/${accountName} ${account.runtime.openaiBaseUrl ?? "default"}\n`,
      );
      return 0;
    }
    case "account-rm": {
      const envName = arg1;
      const accountName = arg2;
      if (!envName || !accountName) {
        throw new Error("usage: account-rm <env> <account>");
      }
      state = await applyRemoveAccount({
        state,
        stateDir,
        envName,
        accountName,
      });
      io.stdout.write(`Removed account slot: ${envName}/${accountName}\n`);
      return 0;
    }
    case "account-logout": {
      const envName = arg1;
      let accountName = arg2;
      let target = (arg3 || "cli") as CommandTarget;
      if (accountName === "cli" || accountName === "app" || accountName === "both") {
        target = accountName;
        accountName = resolveLogoutAccountName(state, envName, target);
      }
      if (!envName || !accountName) {
        throw new Error("usage: account-logout <env> <account> <cli|app|both>");
      }
      state = await applyLogoutAccount({
        state,
        stateDir,
        envName,
        accountName,
        target,
      });
      io.stdout.write(`Logged out account: ${envName}/${accountName}\n`);
      return 0;
    }
    case "env-rm": {
      const envName = arg1;
      if (!envName) {
        throw new Error("usage: env-rm <env>");
      }
      state = await applyRemoveEnv({
        state,
        stateDir,
        envsDir,
        envName,
      });
      io.stdout.write(`Removed env: ${envName}\n`);
      return 0;
    }
    default:
      throw new Error(`unsupported core-cli command: ${command}`);
  }
}

async function main() {
  try {
    const code = await runCoreCli(process.argv.slice(2));
    process.exit(code);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

async function applySelectEnv(options: {
  state: SwitcherState;
  stateDir: string;
  envName: string;
  target: CommandTarget;
}) {
  let next = options.state;
  const targets = expandTargets(options.target);
  for (const target of targets) {
    next = createApi(next).selectEnv({
      envName: options.envName,
      target,
      now: new Date().toISOString(),
    });
    await writeLegacyPointers({
      stateDir: options.stateDir,
      target,
      env: next.targets[target].env,
      account: next.targets[target].account,
    });
    await applyTargetHomeState({
      state: next,
      target,
    });
  }
  return next;
}

async function applySelectAccount(options: {
  state: SwitcherState;
  stateDir: string;
  envName: string;
  accountName: string;
  target: CommandTarget;
}) {
  let next = options.state;
  const targets = expandTargets(options.target);
  for (const target of targets) {
    next = createApi(next).selectAccount({
      envName: options.envName,
      accountName: options.accountName,
      target,
      now: new Date().toISOString(),
    });
    await writeLegacyPointers({
      stateDir: options.stateDir,
      target,
      env: next.targets[target].env,
      account: next.targets[target].account,
    });
    await applyTargetHomeState({
      state: next,
      target,
    });
  }
  return next;
}

function expandTargets(target: CommandTarget): Array<"cli" | "app"> {
  return target === "both" ? ["cli", "app"] : [target];
}

function formatTargetSelection(
  state: SwitcherState,
  target: CommandTarget,
): string {
  if (target === "both") {
    return `cli=${state.targets.cli.env}/${state.targets.cli.account} app=${state.targets.app.env}/${state.targets.app.account}\n`;
  }
  return `${state.targets[target].env}/${state.targets[target].account}\n`;
}

async function applyRuntimeToActiveTargets(options: {
  state: SwitcherState;
  envName: string;
  accountName: string;
}) {
  for (const target of ["cli", "app"] as const) {
    const pointer = options.state.targets[target];
    if (pointer.env === options.envName && pointer.account === options.accountName) {
      await applyTargetHomeState({
        state: options.state,
        target,
      });
    }
  }
}

async function cloneEnvHomeExcludingAuth(sourcePath: string, targetPath: string) {
  const entries = await readdir(sourcePath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "auth.json") {
      continue;
    }
    await cp(join(sourcePath, entry.name), join(targetPath, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function applyRemoveAccount(options: {
  state: SwitcherState;
  stateDir: string;
  envName: string;
  accountName: string;
}) {
  const next = createAccountService().removeAccount(options.state, {
    envName: options.envName,
    accountName: options.accountName,
    now: new Date().toISOString(),
  });

  await rm(
    join(options.stateDir, "env-accounts", options.envName, options.accountName),
    { recursive: true, force: true },
  );
  await syncTargets(options.stateDir, next, ["cli", "app"]);
  return next;
}

async function applyLogoutAccount(options: {
  state: SwitcherState;
  stateDir: string;
  envName: string;
  accountName: string;
  target: CommandTarget;
}) {
  const env = options.state.envs[options.envName];
  const account = env?.accounts[options.accountName];
  if (!env || !account) {
    throw new Error(`account '${options.accountName}' not found in env '${options.envName}'`);
  }

  const next: SwitcherState = {
    ...options.state,
    generatedAt: new Date().toISOString(),
    envs: {
      ...options.state.envs,
      [options.envName]: {
        ...env,
        accounts: {
          ...env.accounts,
          [options.accountName]: {
            ...account,
            authData: undefined,
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
            },
          },
        },
      },
    },
    targets: {
      cli:
        options.state.targets.cli.env === options.envName &&
        options.state.targets.cli.account === options.accountName
          ? { env: options.envName, account: "default" }
          : options.state.targets.cli,
      app:
        options.state.targets.app.env === options.envName &&
        options.state.targets.app.account === options.accountName
          ? { env: options.envName, account: "default" }
          : options.state.targets.app,
    },
  };

  await rm(join(options.stateDir, "env-accounts", options.envName, options.accountName, "auth.json"), {
    force: true,
  });
  await rm(join(options.stateDir, "env-accounts", options.envName, options.accountName, "runtime.json"), {
    force: true,
  });
  await syncTargets(options.stateDir, next, ["cli", "app"]);
  return next;
}

async function applyRemoveEnv(options: {
  state: SwitcherState;
  stateDir: string;
  envsDir: string;
  envName: string;
}) {
  const next = createEnvService().removeEnv(options.state, {
    envName: options.envName,
  });
  await rm(join(options.envsDir, options.envName), { recursive: true, force: true });
  await rm(join(options.stateDir, "env-accounts", options.envName), {
    recursive: true,
    force: true,
  });
  await syncTargets(options.stateDir, next, ["cli", "app"]);
  return next;
}

async function syncTargets(
  stateDir: string,
  state: SwitcherState,
  targets: Array<"cli" | "app">,
) {
  for (const target of targets) {
    await writeLegacyPointers({
      stateDir,
      target,
      env: state.targets[target].env,
      account: state.targets[target].account,
    });
    await applyTargetHomeState({
      state,
      target,
    });
  }
}

function resolveLogoutAccountName(
  state: SwitcherState,
  envName: string,
  target: CommandTarget,
): string {
  if (target === "both") {
    if (state.targets.cli.env === envName) {
      return state.targets.cli.account;
    }
    if (state.targets.app.env === envName) {
      return state.targets.app.account;
    }
    return state.targets.cli.account;
  }
  return state.targets[target].account;
}

function createApi(state: SwitcherState) {
  return createCoreApi({
    getState: () => state,
  });
}
