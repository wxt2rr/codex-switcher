const DEFAULT_ACCOUNT_NAME = "default";
export function createAccountService() {
    return {
        listAccounts(state, input) {
            const env = requireEnv(state, input.envName);
            return Object.values(env.accounts)
                .map((account) => ({
                name: account.name,
                authMode: account.authMode,
                runtime: account.runtime,
                isCurrentCli: state.targets.cli.env === input.envName &&
                    state.targets.cli.account === account.name,
                isCurrentApp: state.targets.app.env === input.envName &&
                    state.targets.app.account === account.name,
            }))
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        selectAccount(state, input) {
            const env = requireEnv(state, input.envName);
            requireAccount(env, input.accountName);
            return {
                ...state,
                generatedAt: input.now,
                targets: {
                    ...state.targets,
                    [input.target]: {
                        env: input.envName,
                        account: input.accountName,
                    },
                },
            };
        },
        updateRuntime(state, input) {
            const env = requireEnv(state, input.envName);
            const account = requireAccount(env, input.accountName);
            return {
                ...state,
                generatedAt: input.now,
                envs: {
                    ...state.envs,
                    [input.envName]: {
                        ...env,
                        accounts: {
                            ...env.accounts,
                            [input.accountName]: {
                                ...account,
                                runtime: input.runtime,
                            },
                        },
                    },
                },
            };
        },
        removeAccount(state, input) {
            const env = requireEnv(state, input.envName);
            requireAccount(env, input.accountName);
            const accounts = { ...env.accounts };
            delete accounts[input.accountName];
            return {
                ...state,
                generatedAt: input.now,
                envs: {
                    ...state.envs,
                    [input.envName]: {
                        ...env,
                        accounts,
                    },
                },
                targets: {
                    cli: state.targets.cli.env === input.envName &&
                        state.targets.cli.account === input.accountName
                        ? { env: input.envName, account: DEFAULT_ACCOUNT_NAME }
                        : state.targets.cli,
                    app: state.targets.app.env === input.envName &&
                        state.targets.app.account === input.accountName
                        ? { env: input.envName, account: DEFAULT_ACCOUNT_NAME }
                        : state.targets.app,
                },
            };
        },
    };
}
function requireEnv(state, envName) {
    const env = state.envs[envName];
    if (!env) {
        throw createAccountError("ENV_NOT_FOUND", `Env '${envName}' not found`);
    }
    return env;
}
function requireAccount(env, accountName) {
    const account = env.accounts[accountName];
    if (!account) {
        throw createAccountError("ACCOUNT_NOT_FOUND", `Account '${accountName}' not found in env '${env.name}'`);
    }
    return account;
}
function createAccountError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
//# sourceMappingURL=account-service.js.map