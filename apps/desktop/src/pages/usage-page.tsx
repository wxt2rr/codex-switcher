import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/form-primitives";
import type { DesktopBridge } from "../bridge";
import type { OverviewPayload, UsagePricingProfile, UsageSnapshot } from "../desktop-model";
import type { UiLanguage } from "../i18n";
import { StatCard } from "../components/dashboard-kit";
import { UsageDonut, UsageTrendChart, formatCompact } from "../components/usage-charts";
import { SidePanel } from "../components/admin-primitives";
import { cn } from "../lib/utils";
import {
  buildUsageFilter,
  normalizeRefreshSeconds,
  REFRESH_INTERVAL_PRESETS,
  shouldScheduleUsageRefresh,
  type UsageRange,
} from "../refresh-policy";

const emptySnapshot: UsageSnapshot = {
  generatedAt: 0,
  summary: { requests: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    totalTokens: 0, actualCost: null, standardCost: null, requestsWithoutUsage: 0, cacheHitRate: null },
  models: [], baseUrls: [], trend: [],
};

export function UsagePage({ overview, language, bridge }: { overview: OverviewPayload; language: UiLanguage; bridge: DesktopBridge }) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<UsageRange>("24h");
  const [envName, setEnvName] = useState("all");
  const [accountName, setAccountName] = useState("all");
  const [baseUrl, setBaseUrl] = useState("all");
  const [model, setModel] = useState("all");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricing, setPricing] = useState<UsagePricingProfile[]>([]);
  const [priceKind, setPriceKind] = useState<"actual" | "standard">("actual");
  const [priceBaseUrl, setPriceBaseUrl] = useState("");
  const [priceModel, setPriceModel] = useState("*");
  const [priceInput, setPriceInput] = useState("");
  const [priceOutput, setPriceOutput] = useState("");
  const [priceCacheCreation, setPriceCacheCreation] = useState("");
  const [priceCacheRead, setPriceCacheRead] = useState("");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(5);
  const [customRefreshEditing, setCustomRefreshEditing] = useState(false);
  const [customRefreshDraft, setCustomRefreshDraft] = useState("5");
  const requestInFlightRef = useRef(false);

  async function refresh() {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setLoading(true);
    const filter = buildUsageFilter({ range, envName, accountName, baseUrl, model }, Date.now());
    try { setSnapshot(await bridge.loadUsageSnapshot(filter)); setError(""); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { requestInFlightRef.current = false; setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [range, envName, accountName, baseUrl, model]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (shouldScheduleUsageRefresh(document.visibilityState, requestInFlightRef.current)) void refresh();
    }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [range, envName, accountName, baseUrl, model, refreshIntervalSeconds]);

  const accounts = overview.accounts.filter((item) => envName === "all" || item.envName === envName);
  const zh = language === "zh";
  const refreshIntervalIsPreset = REFRESH_INTERVAL_PRESETS.includes(
    refreshIntervalSeconds as (typeof REFRESH_INTERVAL_PRESETS)[number],
  );
  function commitCustomRefreshInterval() {
    const seconds = normalizeRefreshSeconds(Number(customRefreshDraft));
    setRefreshIntervalSeconds(seconds);
    setCustomRefreshDraft(String(seconds));
    setCustomRefreshEditing(false);
  }
  async function openPricing() {
    setPricing(await bridge.listUsagePricing());
    setPriceBaseUrl(snapshot.baseUrls[0]?.baseUrl ?? "");
    setPricingOpen(true);
  }
  async function savePricing() {
    if (!priceBaseUrl.trim() || !priceInput.trim() || !priceOutput.trim()) return;
    await bridge.saveUsagePricing({ kind: priceKind, baseUrl: priceBaseUrl.trim(), modelPattern: priceModel.trim() || "*",
      inputPerMillion: Number(priceInput), outputPerMillion: Number(priceOutput),
      cacheCreationPerMillion: priceCacheCreation.trim() ? Number(priceCacheCreation) : null,
      cacheReadPerMillion: priceCacheRead.trim() ? Number(priceCacheRead) : null, updatedAt: Date.now() });
    setPricing(await bridge.listUsagePricing());
    await refresh();
  }
  return (
    <section className="h-full min-h-0 overflow-auto px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8">
      <div className="admin-page-content flex min-h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-6">
          <div><h2 className="text-[28px] font-semibold tracking-[-0.04em]">{zh ? "使用统计" : "Usage Analytics"}</h2>
            <p className="mt-1 text-[13px] leading-6 text-slate-500">{zh ? "按环境、账号、Base URL 和模型近实时统计路由请求的 Token 使用量。" : "Near-real-time routed token usage by environment, account, Base URL, and model."}</p></div>
          <span className="mt-2 text-[11px] text-slate-400">{snapshot.generatedAt ? `${zh ? "更新于" : "Updated"} ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : ""}</span>
        </div>

        <div className="responsive-toolbar flex items-center gap-2 rounded-[18px] bg-white px-3 py-2.5 ring-1 ring-black/[0.04]">
          <Select value={range} onValueChange={(value) => setRange(value as UsageRange)} items={[{ value: "1h", label: zh ? "最近 1 小时" : "Last hour" }, { value: "24h", label: zh ? "最近 24 小时" : "Last 24 hours" }, { value: "7d", label: zh ? "最近 7 天" : "Last 7 days" }, { value: "30d", label: zh ? "最近 30 天" : "Last 30 days" }]} className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <Select value={envName} onValueChange={setEnvName} items={[{ value: "all", label: zh ? "全部环境" : "All environments" }, ...overview.envs.map((item) => ({ value: item.name, label: item.name }))]} className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <Select value={accountName} onValueChange={setAccountName} items={[{ value: "all", label: zh ? "全部账号" : "All accounts" }, ...accounts.map((item) => ({ value: item.name, label: item.name }))]} className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <Select value={baseUrl} onValueChange={setBaseUrl} items={[{ value: "all", label: "Base URL" }, ...snapshot.baseUrls.map((item) => ({ value: item.baseUrl ?? item.key, label: item.baseUrl ?? item.key }))]} className="h-8 min-w-[150px] max-w-[240px] border-transparent bg-[#f7f8fa]" />
          <Select value={model} onValueChange={setModel} items={[{ value: "all", label: zh ? "全部模型" : "All models" }, ...snapshot.models.map((item) => ({ value: item.model ?? item.key, label: item.model ?? item.key }))]} className="h-8 w-[130px] border-transparent bg-[#f7f8fa]" />
          <div className="ml-auto flex h-8 items-center overflow-hidden rounded-lg bg-[#f3f4f6]">
            <button type="button" className="flex size-8 shrink-0 items-center justify-center text-slate-500 transition hover:bg-[#ebeef2] hover:text-neutral-800 disabled:cursor-wait" onClick={() => void refresh()} disabled={loading} aria-label={zh ? "立即刷新" : "Refresh now"} title={zh ? "立即刷新" : "Refresh now"}><RefreshCw className={cn("size-3.5", loading && "animate-spin")} /></button>
            {customRefreshEditing ? (
              <div className="flex items-center border-l border-black/[0.05]">
                <Input data-usage-refresh-input type="number" min={1} max={3600} value={customRefreshDraft}
                  onChange={(event) => setCustomRefreshDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") commitCustomRefreshInterval(); if (event.key === "Escape") setCustomRefreshEditing(false); }}
                  aria-label={zh ? "自定义刷新秒数" : "Custom refresh seconds"} title={zh ? "自定义刷新秒数" : "Custom refresh seconds"}
                  className="h-8 w-[44px] rounded-none bg-transparent px-1.5 text-[12px] shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" autoFocus />
                <button type="button" className="flex h-8 w-7 items-center justify-center text-slate-500 hover:text-neutral-900" onClick={commitCustomRefreshInterval}
                  aria-label={zh ? "应用刷新频率" : "Apply refresh interval"} title={zh ? "应用刷新频率" : "Apply refresh interval"}><Check className="size-3.5" /></button>
              </div>
            ) : (
              <Select value={refreshIntervalIsPreset ? String(refreshIntervalSeconds) : "custom"}
                onValueChange={(value) => { if (value === "custom") { setCustomRefreshDraft(String(refreshIntervalSeconds)); setCustomRefreshEditing(true); return; } setRefreshIntervalSeconds(normalizeRefreshSeconds(Number(value))); }}
                items={[...REFRESH_INTERVAL_PRESETS.map((seconds) => ({ value: String(seconds), label: `${seconds}s` })), { value: "custom", label: refreshIntervalIsPreset ? (zh ? "自定义" : "Custom") : `${refreshIntervalSeconds}s` }]}
                className="h-8 w-[64px] rounded-none border-l border-black/[0.05] bg-transparent px-2 text-[12px] shadow-none" />
            )}
          </div>
          <Button variant="ghost" className="size-8 p-0" onClick={() => void openPricing()} aria-label={zh ? "价格配置" : "Pricing settings"} title={zh ? "价格配置" : "Pricing settings"}><Settings2 className="size-4" /></Button>
        </div>
        {error ? <div className="border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label={zh ? "请求数" : "Requests"} value={String(snapshot.summary.requests)} helper={snapshot.summary.requestsWithoutUsage ? `${snapshot.summary.requestsWithoutUsage} ${zh ? "条无用量数据" : "without usage"}` : zh ? "已记录响应" : "Recorded responses"} />
          <StatCard label="Token" value={formatCompact(snapshot.summary.totalTokens)} helper={`Input ${formatCompact(snapshot.summary.inputTokens)} / Output ${formatCompact(snapshot.summary.outputTokens)}`} />
          <StatCard label={zh ? "缓存命中率" : "Cache hit rate"} value={snapshot.summary.cacheHitRate === null ? "-" : `${(snapshot.summary.cacheHitRate * 100).toFixed(1)}%`} helper={`Cache Read ${formatCompact(snapshot.summary.cacheReadTokens)}`} />
          <StatCard label={zh ? "费用" : "Cost"} value={snapshot.summary.actualCost === null ? "-" : `$${snapshot.summary.actualCost.toFixed(4)}`} helper={`${zh ? "标准" : "Standard"}: ${snapshot.summary.standardCost === null ? "-" : `$${snapshot.summary.standardCost.toFixed(4)}`}`} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[0.95fr_1.35fr]">
          <section className="rounded-[18px] bg-white p-5 ring-1 ring-black/[0.04]"><h3 className="text-[16px] font-semibold">{zh ? "模型分布" : "Model distribution"}</h3>
            {snapshot.models.length ? <div className="mt-4 grid items-center gap-5 md:grid-cols-[220px_1fr]"><UsageDonut models={snapshot.models} /><div className="space-y-2">{snapshot.models.map((item) => <div key={item.key} className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-slate-100 py-2 text-[12px]"><b className="truncate">{item.model}</b><span>{item.requests} req</span><span>{formatCompact(item.totalTokens)}</span></div>)}</div></div> : <Empty zh={zh} />}
          </section>
          <section className="rounded-[18px] bg-white p-5 ring-1 ring-black/[0.04]"><h3 className="text-[16px] font-semibold">{zh ? "Token 使用趋势" : "Token usage trend"}</h3>
            {snapshot.trend.length ? <div className="mt-4"><UsageTrendChart trend={snapshot.trend} /></div> : <Empty zh={zh} />}
          </section>
        </div>
        <section className="rounded-[18px] bg-white p-5 ring-1 ring-black/[0.04]"><h3 className="text-[16px] font-semibold">Base URL</h3>
          <div className="mt-3 overflow-auto"><table className="w-full min-w-[720px] text-left text-[12px]"><thead className="text-slate-400"><tr><th className="py-2">Base URL</th><th>{zh ? "请求" : "Requests"}</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Token</th><th>{zh ? "标准费用" : "Standard cost"}</th></tr></thead><tbody>{snapshot.baseUrls.map((item) => <tr key={item.key} className="border-t border-slate-100"><td className="max-w-[360px] truncate py-3 font-medium">{item.baseUrl}</td><td>{item.requests}</td><td>{formatCompact(item.inputTokens)}</td><td>{formatCompact(item.outputTokens)}</td><td>{formatCompact(item.cacheReadTokens)}</td><td>{formatCompact(item.totalTokens)}</td><td>{item.standardCost === null ? "-" : `$${item.standardCost.toFixed(4)}`}</td></tr>)}</tbody></table></div>
        </section>
        <SidePanel open={pricingOpen} title={zh ? "价格配置" : "Pricing profiles"} description={zh ? "按 Base URL 和模型配置实际采购价或标准价，单位为每百万 Token。保存后会重算历史记录。" : "Configure actual or standard rates per million tokens. Historical records are repriced after saving."} onClose={() => setPricingOpen(false)} closeLabel={zh ? "关闭" : "Close"}>
          <div className="space-y-4">
            <Field label={zh ? "价格类型" : "Price type"}><Select value={priceKind} onValueChange={(value) => setPriceKind(value as "actual" | "standard")} items={[{ value: "actual", label: zh ? "实际采购价" : "Actual" }, { value: "standard", label: zh ? "标准价" : "Standard" }]} /></Field>
            <Field label="Base URL"><Input value={priceBaseUrl} onChange={(event) => setPriceBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></Field>
            <Field label={zh ? "模型匹配" : "Model pattern"}><Input value={priceModel} onChange={(event) => setPriceModel(event.target.value)} placeholder="gpt-*" /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Input / 1M"><Input type="number" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} /></Field><Field label="Output / 1M"><Input type="number" value={priceOutput} onChange={(event) => setPriceOutput(event.target.value)} /></Field><Field label="Cache Creation / 1M"><Input type="number" value={priceCacheCreation} onChange={(event) => setPriceCacheCreation(event.target.value)} placeholder={priceInput || "-"} /></Field><Field label="Cache Read / 1M"><Input type="number" value={priceCacheRead} onChange={(event) => setPriceCacheRead(event.target.value)} placeholder={priceInput || "-"} /></Field></div>
            <Button className="w-full" onClick={() => void savePricing()}>{zh ? "保存并重算" : "Save and reprice"}</Button>
            <div className="divide-y divide-slate-200 border-y border-slate-200">{pricing.map((item) => <div key={`${item.kind}/${item.baseUrl}/${item.modelPattern}`} className="py-3 text-[12px]"><div className="flex justify-between"><b>{item.kind === "actual" ? (zh ? "实际" : "Actual") : (zh ? "标准" : "Standard")}</b><span>{item.modelPattern}</span></div><div className="mt-1 truncate text-slate-500">{item.baseUrl}</div><div className="mt-1 text-slate-500">Input ${item.inputPerMillion} · Output ${item.outputPerMillion}</div></div>)}</div>
          </div>
        </SidePanel>
      </div>
    </section>
  );
}

function Empty({ zh }: { zh: boolean }) { return <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">{zh ? "开启环境路由并产生请求后显示统计" : "Enable environment routing and make requests to see usage"}</div>; }
