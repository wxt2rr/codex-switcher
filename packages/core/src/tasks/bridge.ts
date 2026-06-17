import type { TaskRecord, TaskRunner } from "./task-runner.js";

export interface ExternalCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ExternalCommandRunner = (
  command: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<ExternalCommandResult>;

export interface BridgeTaskServiceOptions {
  runner: ExternalCommandRunner;
  tasks: TaskRunner;
}

export function createBridgeTaskService(options: BridgeTaskServiceOptions) {
  return {
    runAuthLogin(input: { codexBin: string; codexHome: string }) {
      return options.tasks.run({
        kind: "auth-login",
        summary: "Run auth-based Codex login",
        execute: async ({ log, updateProgress }) => {
          updateProgress("starting");
          log(`launching ${input.codexBin} login`);
          const result = await options.runner(
            input.codexBin,
            ["login"],
            { CODEX_HOME: input.codexHome },
          );
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `login failed with exit code ${result.exitCode}`);
          }
          updateProgress("completed");
          return result;
        },
      });
    },

    runProxyTest(input: { command: string; args: string[] }) {
      return options.tasks.run({
        kind: "proxy-test",
        summary: "Run proxy connectivity check",
        execute: async ({ log, updateProgress }) => {
          updateProgress("starting");
          log(`running ${input.command} ${input.args.join(" ")}`);
          const result = await options.runner(input.command, input.args);
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `command failed with exit code ${result.exitCode}`);
          }
          updateProgress("completed");
          return result;
        },
      });
    },
  };
}
