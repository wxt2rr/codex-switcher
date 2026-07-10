import type {
  AuthMetricsPayload,
  AuthMetricsTargetStatus,
  OverviewPayload,
} from "./desktop-model.js";

function mergeTargetStatus<T extends {
  email?: string;
  usage5h?: string;
  usageWeekly?: string;
}>(target: T, patch: AuthMetricsTargetStatus | undefined): T {
  if (!patch) {
    return target;
  }

  return {
    ...target,
    email: patch.email,
    usage5h: patch.usage5h,
    usageWeekly: patch.usageWeekly,
  };
}

export function mergeOverviewWithAuthMetrics(
  overview: OverviewPayload,
  authMetrics: AuthMetricsPayload,
): OverviewPayload {
  return {
    ...overview,
    accounts: overview.accounts.map((account) => ({
      ...account,
      authProfile:
        account.authMode === "auth"
          ? authMetrics.accounts[`${account.envName}/${account.name}`] ?? account.authProfile
          : account.authProfile,
    })),
    status: {
      ...overview.status,
      cli: overview.status.cli.apiKeyPreview
        ? overview.status.cli
        : mergeTargetStatus(overview.status.cli, authMetrics.status.cli),
      app: overview.status.app.apiKeyPreview
        ? overview.status.app
        : mergeTargetStatus(overview.status.app, authMetrics.status.app),
    },
  };
}

export function mergeAccountUsageMetrics(
  overview: OverviewPayload,
  authMetrics: AuthMetricsPayload,
): OverviewPayload {
  return {
    ...overview,
    accounts: overview.accounts.map((account) => {
      if (account.authMode !== "auth") return account;
      const nextProfile = authMetrics.accounts[`${account.envName}/${account.name}`];
      if (!nextProfile) return account;
      return {
        ...account,
        authProfile: nextProfile,
      };
    }),
  };
}
