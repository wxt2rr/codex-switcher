import { createCoreApi } from "../packages/core/src/api/core-api.js";
import { formatWhoami } from "../packages/core/src/cli.js";
import {
  createLegacyEnv,
  readLegacyState,
  writeLegacyPointers,
  writeLegacyRuntime,
} from "../packages/core/src/state/legacy.js";
import type { SwitcherState } from "../packages/core/src/state/store.js";
import { applyTargetHomeState } from "../packages/core/src/system/target-home.js";

type Command =
  | "whoami"
  | "env-ls"
  | "account-ls"
  | "status"
  | "overview"
  | "env-use"
  | "account-use"
  | "env-new"
  | "runtime-update";
type CommandTarget = "cli" | "app" | "both";

async function main() {
  const [command = "", arg1 = "all", arg2 = "", arg3 = ""] = process.argv.slice(2);
  const stateDir = process.env.CODEX_SWITCHER_STATE_DIR || `${process.env.HOME}/.codex-switcher`;
  const envsDir = process.env.CODEX_SWITCHER_ENVS_DIR || `${process.env.HOME}/.codex-envs`;
  const defaultHome = process.env.CODEX_SWITCHER_DEFAULT_HOME || `${process.env.HOME}/.codex`;
  let state = await readLegacyState({
    stateDir,
    envsDir,
    defaultHome,
  });

  switch (command as Command) {
    case "whoami": {
      process.stdout.write(
        `${formatWhoami(state, arg1 === "both" ? "all" : (arg1 as "cli" | "app" | "all"))}\n`,
      );
      return;
    }
    case "env-ls": {
      for (const env of createApi(state).listEnvs()) {
        let marks = "";
        if (env.isCurrentCli) marks += " [cli-current]";
        if (env.isCurrentApp) marks += " [app-current]";
        process.stdout.write(`- ${env.name}${marks}\n`);
      }
      return;
    }
    case "account-ls": {
      const envName = arg1;
      if (envName) {
        for (const account of createApi(state).getAccounts(envName)) {
          let marks = "";
          if (account.isCurrentCli) marks += " [cli-current]";
          if (account.isCurrentApp) marks += " [app-current]";
          process.stdout.write(`- ${account.name}${marks}\n`);
        }
        return;
      }

      for (const account of createApi(state).listAccounts()) {
        let marks = "";
        if (account.isCurrentCli) marks += " [cli-current]";
        if (account.isCurrentApp) marks += " [app-current]";
        process.stdout.write(`- ${account.envName}/${account.name}${marks}\n`);
      }
      return;
    }
    case "status": {
      const status = createApi(state).getStatus();
      process.stdout.write(`cli_current: ${status.cli.current}\n`);
      process.stdout.write(`app_current: ${status.app.current}\n`);
      process.stdout.write(`cli_auth_path: managed-by-core\n`);
      process.stdout.write(`app_auth_path: managed-by-core\n`);
      process.stdout.write(`cli_auth: ${status.cli.auth}\n`);
      process.stdout.write(`app_auth: ${status.app.auth}\n`);
      process.stdout.write(`cli_auth_expiry: ${status.cli.authExpiry}\n`);
      process.stdout.write(`app_auth_expiry: ${status.app.authExpiry}\n`);
      process.stdout.write(`token_refresh_guard: ${status.tokenRefresh.guard}\n`);
      process.stdout.write(
        `token_refresh_need_relogin_last_run: ${status.tokenRefresh.needReloginLastRun}\n`,
      );
      process.stdout.write(`cli(${status.cli.current}): ${status.cli.loginState}\n`);
      process.stdout.write(`app(${status.app.current}): ${status.app.loginState}\n`);
      return;
    }
    case "overview": {
      process.stdout.write(`${JSON.stringify(createApi(state).getOverview(), null, 2)}\n`);
      return;
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
      process.stdout.write(formatTargetSelection(state, target));
      return;
    }
    case "account-use": {
      const envName = arg1;
      const accountName = arg2;
      const target = (arg3 || "cli") as CommandTarget;
      if (!envName || !accountName) {
        throw new Error("usage: account-use <env> <account> <cli|app|both>");
      }
      state = await applySelectAccount({
        state,
        stateDir,
        envName,
        accountName,
        target,
      });
      process.stdout.write(formatTargetSelection(state, target));
      return;
    }
    case "env-new": {
      const envName = arg1;
      if (!envName) {
        throw new Error("usage: env-new <env>");
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
      process.stdout.write(`${created.name}\n`);
      return;
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
      process.stdout.write(
        `${envName}/${accountName} ${account.runtime.openaiBaseUrl ?? "default"}\n`,
      );
      return;
    }
    default:
      throw new Error(`unsupported core-cli command: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

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

function createApi(state: SwitcherState) {
  return createCoreApi({
    getState: () => state,
  });
}
