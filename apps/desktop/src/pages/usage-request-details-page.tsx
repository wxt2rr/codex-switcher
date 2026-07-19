import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Input, Select } from "@/components/form-primitives";
import type { DesktopBridge } from "../bridge";
import type { AccountSummary, UsageFilter, UsageRequestPage, UsageRequestRecord } from "../desktop-model";
import type { UiLanguage } from "../i18n";
import { cn } from "../lib/utils";
import { formatCompact } from "../components/usage-charts";
import { ListLoadingState, PageScrollArea } from "../components/account-list-primitives";

const emptyPage: UsageRequestPage = {
  generatedAt: 0,
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  facets: { envNames: [], accountNames: [], models: [], endpoints: [], poolIds: [], failoverReasons: [] },
};

export function UsageRequestDetailsPage({
  language,
  bridge,
  baseUrl,
  initialFilter,
  environmentNames,
  accounts,
  onBack,
}: {
  language: UiLanguage;
  bridge: DesktopBridge;
  baseUrl: string;
  initialFilter: UsageFilter;
  environmentNames: string[];
  accounts: AccountSummary[];
  onBack: () => void;
}) {
  const zh = language === "zh";
  const [data, setData] = useState(emptyPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [envName, setEnvName] = useState(initialFilter.envName ?? "all");
  const [accountName, setAccountName] = useState(initialFilter.accountName ?? "all");
  const [model, setModel] = useState(initialFilter.model ?? "all");
  const [endpoint, setEndpoint] = useState("all");
  const [poolId, setPoolId] = useState("all");
  const [failoverReason, setFailoverReason] = useState("all");
  const [status, setStatus] = useState<"all" | "success" | "error">("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const requestSequence = useRef(0);
  const accountNames = Array.from(new Set(accounts.map((account) => account.name)))
    .sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  async function loadRequests() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await bridge.loadUsageRequests({
        ...initialFilter,
        // Keep the clicked Base URL as the initial scope. Environment and account
        // filters remain editable, but the table must match the URL shown in the header.
        baseUrl: baseUrl || undefined,
        envName: envName === "all" ? undefined : envName,
        accountName: accountName === "all" ? undefined : accountName,
        model: model === "all" ? undefined : model,
        endpoint: endpoint === "all" ? undefined : endpoint,
        poolId: poolId === "all" ? undefined : poolId,
        failoverReason: failoverReason === "all" ? undefined : failoverReason,
        status: status === "all" ? undefined : status,
        search: search || undefined,
        page,
        pageSize,
      });
      if (sequence !== requestSequence.current) return;
      setData(next);
      setPage(next.page);
      setError("");
    } catch (nextError) {
      if (sequence !== requestSequence.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => { void loadRequests(); }, [envName, accountName, model, endpoint, poolId, failoverReason, status, search, page, pageSize]);

  function updateFilter(setter: (value: string) => void, value: string) {
    setPage(1);
    setter(value);
  }

  return (
    <section className="h-full min-h-0 overflow-hidden px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8">
      <PageScrollArea>
        <div className="admin-page-content flex min-h-full flex-col gap-4">
        <header className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <Button variant="ghost" className="relative z-20 mb-2 h-8 gap-1.5 px-2 text-slate-600 [-webkit-app-region:no-drag]" onClick={onBack}>
              <ArrowLeft className="size-4" />
              {zh ? "返回用量" : "Back to usage"}
            </Button>
            <h2 className="text-[28px] font-semibold tracking-[-0.04em]">{zh ? "请求详情" : "Request details"}</h2>
            <p className="mt-1 max-w-[800px] truncate text-[13px] leading-6 text-slate-500" title={baseUrl}>{baseUrl}</p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{data.generatedAt ? `${zh ? "更新于" : "Updated"} ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}</span>
            <Button variant="ghost" className="size-8 p-0" onClick={() => void loadRequests()} disabled={loading}
              aria-label={zh ? "刷新请求详情" : "Refresh request details"} title={zh ? "刷新请求详情" : "Refresh request details"}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        <div className="responsive-toolbar flex flex-wrap items-center gap-2 rounded-[14px] border border-black/[0.05] bg-white p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={zh ? "搜索请求 ID、模型或端点" : "Search request ID, model, or endpoint"}
              className="h-8 border-transparent bg-[#f7f8fa] pl-10 text-[12px] shadow-none" />
          </div>
          <Select value={envName} onValueChange={(value) => { setPage(1); setEnvName(value); setAccountName("all"); }}
            items={[{ value: "all", label: zh ? "全部环境" : "All environments" }, ...environmentNames.map((value) => ({ value, label: value }))]}
            className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <Select value={accountName} onValueChange={(value) => updateFilter(setAccountName, value)}
            items={[{ value: "all", label: zh ? "全部账号" : "All accounts" }, ...accountNames.map((value) => ({ value, label: value }))]}
            className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <Select value={model} onValueChange={(value) => updateFilter(setModel, value)}
            items={[{ value: "all", label: zh ? "全部模型" : "All models" }, ...data.facets.models.map((value) => ({ value, label: value }))]}
            className="h-8 w-[140px] border-transparent bg-[#f7f8fa]" />
          <Select value={endpoint} onValueChange={(value) => updateFilter(setEndpoint, value)}
            items={[{ value: "all", label: zh ? "全部端点" : "All endpoints" }, ...data.facets.endpoints.map((value) => ({ value, label: value }))]}
            className="h-8 w-[150px] border-transparent bg-[#f7f8fa]" />
          <Select value={poolId} onValueChange={(value) => updateFilter(setPoolId, value)}
            items={[{ value: "all", label: zh ? "全部账号池" : "All pools" }, ...data.facets.poolIds.map((value) => ({ value, label: value }))]}
            className="h-8 w-[145px] border-transparent bg-[#f7f8fa]" />
          <Select value={failoverReason} onValueChange={(value) => updateFilter(setFailoverReason, value)}
            items={[{ value: "all", label: zh ? "全部切换原因" : "All failovers" }, ...data.facets.failoverReasons.map((value) => ({ value, label: value }))]}
            className="h-8 w-[145px] border-transparent bg-[#f7f8fa]" />
          <Select value={status} onValueChange={(value) => { setPage(1); setStatus(value as typeof status); }}
            items={[{ value: "all", label: zh ? "全部状态" : "All statuses" }, { value: "success", label: zh ? "成功" : "Success" }, { value: "error", label: zh ? "失败" : "Failed" }]}
            className="h-8 w-[110px] border-transparent bg-[#f7f8fa]" />
        </div>

        {error ? <div className="border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <section className="usage-request-table min-h-0 flex-1 overflow-hidden rounded-[14px] border border-black/[0.05] bg-white">
          {loading && data.generatedAt === 0 ? <div className="h-full overflow-auto p-2"><ListLoadingState rows={6} /></div> : <div className="h-full overflow-auto">
            <table className="w-full min-w-[1380px] text-left text-[12px]">
              <thead className="border-b border-slate-200 bg-[#fafbfc] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{zh ? "时间 / 请求 ID" : "Time / Request ID"}</th>
                  <th className="px-3 font-medium">{zh ? "环境 / 账号" : "Environment / Account"}</th>
                  <th className="px-3 font-medium">{zh ? "模型" : "Model"}</th>
                  <th className="px-3 font-medium">{zh ? "端点" : "Endpoint"}</th>
                  <th className="px-3 font-medium">{zh ? "状态" : "Status"}</th>
                  <th className="px-3 font-medium">{zh ? "路由尝试" : "Routing"}</th>
                  <th className="px-3 font-medium text-blue-600">Input</th>
                  <th className="px-3 font-medium text-emerald-600">Output</th>
                  <th className="px-3 font-medium text-cyan-600">Cache Read</th>
                  <th className="px-3 font-medium">Token</th>
                  <th className="px-3 font-medium">{zh ? "延迟" : "Latency"}</th>
                  <th className="px-4 font-medium">{zh ? "费用" : "Cost"}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.requestId} className="border-b border-slate-100 last:border-b-0 hover:bg-[#fafbfc]">
                    <td className="px-4 py-3.5"><div className="whitespace-nowrap font-medium text-neutral-800">{new Date(item.completedAt).toLocaleString()}</div><div className="mt-1 max-w-[180px] truncate font-mono text-[10px] text-slate-400" title={item.requestId}>{item.requestId}</div></td>
                    <td className="px-3"><div className="font-medium text-neutral-800">{item.envName}</div><div className="mt-1 text-slate-400">{item.accountName}</div></td>
                    <td className="max-w-[150px] truncate px-3 font-medium" title={item.model ?? "unknown"}>{item.model ?? "unknown"}</td>
                    <td className="max-w-[180px] truncate px-3 font-mono text-[11px] text-slate-600" title={item.endpoint}>{item.endpoint}</td>
                    <td className="px-3"><RequestStatus item={item} zh={zh} /></td>
                    <td className="px-3"><RoutingAttempts item={item} zh={zh} /></td>
                    <td className="px-3 tabular-nums text-blue-600">{formatNullableTokens(item.inputTokens)}</td>
                    <td className="px-3 tabular-nums text-emerald-600">{formatNullableTokens(item.outputTokens)}</td>
                    <td className="px-3 tabular-nums text-cyan-600">{formatNullableTokens(item.cacheReadTokens)}</td>
                    <td className="px-3 font-medium tabular-nums">{formatNullableTokens(item.totalTokens)}</td>
                    <td className="px-3 tabular-nums text-slate-600">{formatLatency(item.latencyMs)}</td>
                    <td className="px-4 tabular-nums"><div>{item.actualCost === null ? "-" : `$${item.actualCost.toFixed(6)}`}</div>{item.standardCost !== null ? <div className="mt-1 text-[10px] text-slate-400">{zh ? "标准" : "Std"} ${item.standardCost.toFixed(6)}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {!loading && data.items.length === 0 ? <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">{zh ? "没有符合条件的请求" : "No matching requests"}</div> : null}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <div className="text-[12px] text-slate-500">{zh ? `第 ${data.page} / ${data.totalPages} 页 · 共 ${data.total} 条` : `Page ${data.page} of ${data.totalPages} · ${data.total} requests`}</div>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)); }}
              items={[20, 50, 100].map((value) => ({ value: String(value), label: zh ? `${value} 条/页` : `${value} / page` }))}
              className="h-8 w-[105px] bg-white" />
            <Button variant="outline" className="size-8 p-0" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || data.page <= 1}
              aria-label={zh ? "上一页" : "Previous page"} title={zh ? "上一页" : "Previous page"}><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" className="size-8 p-0" onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))} disabled={loading || data.page >= data.totalPages}
              aria-label={zh ? "下一页" : "Next page"} title={zh ? "下一页" : "Next page"}><ChevronRight className="size-4" /></Button>
          </div>
        </footer>
        </div>
      </PageScrollArea>
    </section>
  );
}

function formatNullableTokens(value: number | null): string {
  return value === null ? "-" : formatCompact(value);
}

function formatLatency(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(2)}s`;
}

function RequestStatus({ item, zh }: { item: UsageRequestRecord; zh: boolean }) {
  const success = item.httpStatus >= 200 && item.httpStatus < 400;
  const badgeClass = cn(
    "inline-flex rounded-md px-2 py-1 text-[11px] font-medium",
    success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
  );
  if (success) return <span className={badgeClass}>{item.httpStatus}</span>;
  return (
    <Tooltip
      className="max-w-[420px] px-3.5 py-3 text-left font-normal"
      content={(
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-rose-300">{zh ? `HTTP ${item.httpStatus} · 真实报错` : `HTTP ${item.httpStatus} · Error detail`}</div>
          <div className="break-words font-mono text-[11px] leading-5 text-white/90">
            {item.errorMessage ?? (zh ? "该历史记录创建时未保存详细错误信息" : "Detailed error information was not recorded for this historical request")}
          </div>
        </div>
      )}
    >
      <button type="button" className={cn(badgeClass, "cursor-help outline-none focus-visible:ring-2 focus-visible:ring-blue-400")}
        aria-label={zh ? `查看 HTTP ${item.httpStatus} 错误详情` : `View HTTP ${item.httpStatus} error details`}>
        {item.httpStatus}
      </button>
    </Tooltip>
  );
}

function RoutingAttempts({ item, zh }: { item: UsageRequestRecord; zh: boolean }) {
  if (!item.poolId) return <span>-</span>;
  const attempts = item.attempts ?? [];
  const trigger = (
    <button type="button" className="cursor-help text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <div className="font-medium text-neutral-700">{item.attemptCount ?? Math.max(1, attempts.length)} {zh ? "次" : "attempts"}</div>
      {item.failoverReason ? <div className="mt-1 max-w-[150px] truncate text-[10px] text-amber-600">{formatFailureReason(item.failoverReason, zh)}</div> : null}
    </button>
  );
  const historicalAccounts = item.attemptedAccounts ?? [];
  return (
    <Tooltip
      className="max-w-[460px] px-3.5 py-3 text-left font-normal"
      content={(
        <div className="min-w-[280px] space-y-2.5">
          <div className="text-[11px] font-semibold">{zh ? "路由尝试详情" : "Routing attempt details"}</div>
          {attempts.length ? attempts.map((attempt, index) => (
            <div key={`${attempt.accountName}-${attempt.startedAt}-${index}`} className="border-t border-white/15 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold text-white">#{index + 1} · {attempt.accountName}</span>
                <span className="text-white/60">{attempt.httpStatus ?? (zh ? "连接失败" : "Connection failed")} · {formatLatency(Math.max(0, attempt.completedAt - attempt.startedAt))}</span>
              </div>
              <div className="mt-1 text-[10px] text-amber-300">{formatFailureReason(attempt.reason, zh)} · {formatAttemptOutcome(attempt.outcome, zh)}</div>
              {attempt.errorMessage ? <div className="mt-1 break-words font-mono text-[10px] leading-4 text-white/80">{attempt.errorMessage}</div> : null}
            </div>
          )) : (
            <div className="text-white/75">
              {historicalAccounts.length ? `${zh ? "尝试账号" : "Accounts"}: ${historicalAccounts.join(" → ")}` : (zh ? "该历史记录没有逐次诊断数据" : "No per-attempt diagnostics for this historical record")}
              {item.failoverReason ? <div className="mt-1 text-amber-300">{zh ? "切换原因" : "Failover reason"}: {formatFailureReason(item.failoverReason, zh)}</div> : null}
            </div>
          )}
        </div>
      )}
    >
      {trigger}
    </Tooltip>
  );
}

function formatFailureReason(reason: string | null | undefined, zh: boolean): string {
  if (!reason) return zh ? "请求成功" : "Request succeeded";
  const labels: Record<string, [string, string]> = {
    transport: ["网络连接失败", "Transport error"], timeout: ["上游超时", "Upstream timeout"],
    rate_limit: ["触发限流", "Rate limited"], quota: ["额度不足", "Quota exhausted"],
    unauthorized: ["认证失败", "Unauthorized"], upstream_5xx: ["上游服务异常", "Upstream 5xx"],
    upstream_4xx: ["上游请求被拒绝", "Upstream 4xx"], validation: ["请求参数无效", "Validation error"],
    stream_interrupted: ["响应流中断", "Stream interrupted"], no_available_member: ["没有可用账号", "No available member"],
  };
  return labels[reason]?.[zh ? 0 : 1] ?? reason;
}

function formatAttemptOutcome(outcome: NonNullable<UsageRequestRecord["attempts"]>[number]["outcome"], zh: boolean): string {
  const labels: Record<typeof outcome, [string, string]> = {
    success: ["请求成功，保持当前账号", "Succeeded; account retained"],
    retry: ["失败，切换下一个账号", "Failed; trying next account"],
    returned: ["失败，错误已返回客户端", "Failed; error returned to client"],
    failed: ["失败，已停止路由", "Failed; routing stopped"],
  };
  return labels[outcome][zh ? 0 : 1];
}
