export type NavView = "overview" | "environments" | "accounts" | "models" | "skills" | "usage" | "operations";

export interface EnvironmentRouteStatus {
  envName: string;
  enabled: boolean;
  routedAccounts: number;
  port: number | null;
  poolEnabled?: boolean;
  poolId?: string;
  poolMemberCount?: number;
  poolReadyMembers?: number;
}

export interface UsageFilter {
  from: number;
  to: number;
  envName?: string;
  accountName?: string;
  baseUrl?: string;
  model?: string;
}

export interface UsageRequestQuery extends UsageFilter {
  page: number;
  pageSize: number;
  endpoint?: string;
  status?: "success" | "error";
  poolId?: string;
  failoverReason?: string;
  search?: string;
}

export interface UsageRequestRecord {
  requestId: string;
  routeId: string;
  startedAt: number;
  completedAt: number;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  endpoint: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
  httpStatus: number;
  latencyMs: number;
  actualCost: number | null;
  standardCost: number | null;
  poolId?: string | null;
  entryAccountName?: string | null;
  attemptedAccounts?: string[];
  attemptCount?: number;
  failoverReason?: string | null;
  sessionKeyHash?: string | null;
  errorMessage?: string | null;
  attempts?: Array<{
    accountName: string;
    startedAt: number;
    completedAt: number;
    httpStatus: number | null;
    reason: string | null;
    errorMessage: string | null;
    outcome: "success" | "retry" | "returned" | "failed";
  }>;
}

export interface UsageRequestPage {
  generatedAt: number;
  items: UsageRequestRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    envNames: string[];
    accountNames: string[];
    models: string[];
    endpoints: string[];
    poolIds: string[];
    failoverReasons: string[];
  };
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCost: number | null;
  standardCost: number | null;
  requestsWithoutUsage: number;
  cacheHitRate: number | null;
}

export interface UsageAggregate {
  key: string;
  model?: string;
  baseUrl?: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCost: number | null;
  standardCost: number | null;
}

export interface UsageTrendPoint extends UsageSummary { bucket: number }
export interface UsageSnapshot {
  generatedAt: number;
  summary: UsageSummary;
  models: UsageAggregate[];
  baseUrls: UsageAggregate[];
  trend: UsageTrendPoint[];
}

export interface UsagePricingProfile {
  kind: "actual" | "standard";
  baseUrl: string;
  modelPattern: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number | null;
  cacheReadPerMillion: number | null;
  updatedAt: number;
}

export interface AuthProfileSummary {
  plan: string;
  usage5h: string;
  usageWeekly: string;
}

export interface AccountRequestHealth {
  envName: string;
  accountName: string;
  sampleSize: number;
  successRate: number | null;
  cacheHitRate: number | null;
  segments: Array<{
    completedAt: number;
    success: boolean;
    cacheHit: boolean | null;
  }>;
}

export interface TargetStatus {
  current: string;
  auth: string;
  authExpiry: string;
  loginState: string;
  email?: string;
  usage5h?: string;
  usageWeekly?: string;
  apiKeyPreview?: string;
  baseUrl?: string;
}

export interface TaskSummary {
  id: string;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
}

export interface EnvSummary {
  name: string;
  path: string;
  isCurrentCli: boolean;
  isCurrentApp: boolean;
}

export interface AccountSummary {
  envName: string;
  name: string;
  authMode: string;
  apiKeyPreview?: string;
  apiKeyValue?: string;
  hasApiKey?: boolean;
  authProfile?: AuthProfileSummary;
  requestHealth?: AccountRequestHealth;
  isCurrentCli: boolean;
  isCurrentApp: boolean;
  route?: {
    enabled: true;
    originalBaseUrl: string;
    localBaseUrl: string;
    protocol?: "responses" | "chat_completions";
    poolEnabled?: boolean;
    poolId?: string;
  };
  runtime: {
    preferredAuthMethod: string;
    openaiBaseUrlMode: string;
    openaiBaseUrl?: string;
    independentModelEnabled?: boolean;
    independentModelProviderId?: string;
    independentModelApiKey?: string;
    independentModelBaseUrl?: string;
    apiProtocol?: "responses" | "chat_completions";
    compatibilityRouteEnabled?: boolean;
    compatibilityRouteBaseUrl?: string;
    compatibilityUpstreamModel?: string;
    compatibilityReasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
    compatibilityLongConversationStrategy?: "safe" | "continuity";
    compatibilityInstructionRole?: "auto" | "system" | "developer";
    compatibilityRequestOverrides?: Record<string, unknown>;
  };
}

export interface OverviewPayload {
  generatedAt: string;
  status: {
    cli: TargetStatus;
    app: TargetStatus;
    tokenRefresh: {
      guard: string;
      needReloginLastRun: string;
    };
  };
  envs: EnvSummary[];
  accounts: AccountSummary[];
  recentTasks: TaskSummary[];
}

export interface AuthMetricsTargetStatus {
  email: string;
  usage5h: string;
  usageWeekly: string;
}

export interface AuthMetricsPayload {
  accounts: Record<string, AuthProfileSummary>;
  requestHealth?: Record<string, AccountRequestHealth>;
  status: {
    cli?: AuthMetricsTargetStatus;
    app?: AuthMetricsTargetStatus;
  };
}

export const fallbackOverview: OverviewPayload = {
  generatedAt: "2026-06-16T14:00:00.000Z",
  status: {
    cli: {
      current: "wangxt/tuzi-free",
      auth: "apikey | base_url: https://api.tu-zi.com",
      authExpiry: "-",
      loginState: "logged-in",
      apiKeyPreview: "sk-***free",
      baseUrl: "https://api.tu-zi.com",
    },
    app: {
      current: "default/default",
      auth: "chatgpt",
      authExpiry: "-",
      loginState: "logged-in",
      email: "default@example.com",
      usage5h: "15% (06-18 13:30)",
      usageWeekly: "35% (06-21 08:00)",
    },
    tokenRefresh: {
      guard: "unknown",
      needReloginLastRun: "0",
    },
  },
  envs: [
    { name: "default", path: "~/.codex", isCurrentCli: false, isCurrentApp: true },
    { name: "wangxt", path: "~/.codex-envs/wangxt/home", isCurrentCli: true, isCurrentApp: false },
  ],
  accounts: [
    {
      envName: "default",
      name: "ckt-01",
      authMode: "apikey",
      isCurrentCli: false,
      isCurrentApp: false,
      runtime: { preferredAuthMethod: "apikey", openaiBaseUrlMode: "default" },
    },
    {
      envName: "default",
      name: "default",
      authMode: "auth",
      isCurrentCli: false,
      isCurrentApp: true,
      authProfile: {
        plan: "plus",
        usage5h: "15% (06-18 13:30)",
        usageWeekly: "35% (06-21 08:00)",
      },
      runtime: {
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
        independentModelEnabled: true,
        independentModelProviderId: "custom",
        independentModelApiKey: "sk-demo",
        independentModelBaseUrl: "https://api.example.test/v1",
      },
    },
    {
      envName: "wangxt",
      name: "tuzi-free",
      authMode: "apikey",
      isCurrentCli: true,
      isCurrentApp: false,
      runtime: { preferredAuthMethod: "apikey", openaiBaseUrlMode: "custom", openaiBaseUrl: "https://api.tu-zi.com" },
    },
  ],
  recentTasks: [
    {
      id: "task-1",
      kind: "proxy-test",
      status: "succeeded",
      startedAt: "2026-06-16T13:59:00.000Z",
      finishedAt: "2026-06-16T13:59:04.000Z",
      summary: "Proxy ready",
    },
  ],
};
