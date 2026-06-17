const DEFAULT_ENV_NAME = "default";
const DEFAULT_ACCOUNT_NAME = "default";
export function createEnvService() {
    return {
        listEnvs(state) {
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
        createEnv(state, input) {
            if (state.envs[input.envName]) {
                throw createEnvError("ENV_EXISTS", `Env '${input.envName}' already exists`);
            }
            if (input.cloneFromEnv && !state.envs[input.cloneFromEnv]) {
                throw createEnvError("ENV_NOT_FOUND", `Clone source env '${input.cloneFromEnv}' not found`);
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
        removeEnv(state, input) {
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
                    cli: state.targets.cli.env === input.envName
                        ? { env: DEFAULT_ENV_NAME, account: DEFAULT_ACCOUNT_NAME }
                        : state.targets.cli,
                    app: state.targets.app.env === input.envName
                        ? { env: DEFAULT_ENV_NAME, account: DEFAULT_ACCOUNT_NAME }
                        : state.targets.app,
                },
            };
        },
        selectEnv(state, input) {
            const env = state.envs[input.envName];
            if (!env) {
                throw createEnvError("ENV_NOT_FOUND", `Env '${input.envName}' not found`);
            }
            const currentAccount = state.targets[input.target].account;
            const nextAccount = env.accounts[currentAccount]
                ? currentAccount
                : env.accounts[DEFAULT_ACCOUNT_NAME]
                    ? DEFAULT_ACCOUNT_NAME
                    : DEFAULT_ACCOUNT_NAME;
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
function createEnvError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
//# sourceMappingURL=env-service.js.map