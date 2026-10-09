import { useEffect, useMemo, useState } from "react";

import type { DesktopBridge, ProviderCatalogItem } from "../bridge";
import type { OverviewPayload } from "../desktop-model";
import type { UiLanguage } from "../i18n";
import { Button } from "../components/ui/button";
import { SidePanel } from "../components/admin-primitives";
import { ListCard, ListLoadingState, ListPageFrame, ListPageHeader, ListStack, SoftBadge } from "../components/account-list-primitives";
import { ProviderIcon } from "../components/provider-icon";

const CATEGORY_LABELS: Record<ProviderCatalogItem["category"], { zh: string; en: string }> = {
  api: { zh: "API / 云服务商", en: "API / Cloud" },
  subscription: { zh: "订阅服务", en: "Subscriptions" },
  local: { zh: "本地服务", en: "Local" },
  custom: { zh: "自定义接口", en: "Custom" },
};

function label(category: ProviderCatalogItem["category"], language: UiLanguage): string {
  return CATEGORY_LABELS[category][language === "zh" ? "zh" : "en"];
}

function protocolLabel(protocol: string): string {
  if (protocol === "responses") return "Responses";
  if (protocol === "chat_completions") return "Chat Completions";
  if (protocol === "anthropic") return "Anthropic Messages";
  if (protocol === "gemini") return "Gemini";
  return protocol;
}

function conversionLabel(provider: ProviderCatalogItem, zh: boolean): string | undefined {
  if (provider.capabilities.protocolConversion) return zh ? "Responses 自动转换" : "Responses conversion";
  if (provider.protocols.includes("responses")) return zh ? "原生 Responses" : "Native Responses";
  return undefined;
}

export function ProvidersPage({
  overview,
  language,
  bridge,
  onAddAccount,
  onError,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  bridge: DesktopBridge;
  onAddAccount: (providerId: string) => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const [items, setItems] = useState<ProviderCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<ProviderCatalogItem>();

  useEffect(() => {
    let active = true;
    void bridge.listProviderCatalog()
      .then((next) => { if (active) setItems(next); })
      .catch(onError)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bridge, onError]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => !normalized || `${item.displayName} ${item.id} ${item.category}`.toLowerCase().includes(normalized));
  }, [items, query]);

  const grouped = useMemo(() => {
    const groups = new Map<ProviderCatalogItem["category"], ProviderCatalogItem[]>();
    for (const item of visibleItems) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    return groups;
  }, [visibleItems]);

  const providerAccounts = useMemo(() => {
    if (!activeProvider) return [];
    return overview.accounts.filter((account) => account.runtime.providerId === activeProvider.id);
  }, [activeProvider, overview.accounts]);

  return (
    <ListPageFrame>
      <ListPageHeader
        title={zh ? "服务商" : "Providers"}
        subtitle={zh ? "Codex 统一使用 Responses；网关按服务商上游协议原生转发或自动转换。" : "Codex uses Responses; the Gateway forwards natively or converts to each provider's upstream protocol."}
        search={query}
        searchPlaceholder={zh ? "搜索服务商" : "Search providers"}
        onSearchChange={setQuery}
        actions={(
          <span className="hidden text-[11px] text-slate-400 xl:inline">{visibleItems.length} / {items.length}</span>
        )}
      />

      {loading ? <ListLoadingState /> : grouped.size === 0 ? (
        <ListCard className="p-8 text-center text-sm text-slate-500">{zh ? "没有匹配的服务商" : "No matching providers"}</ListCard>
      ) : (
        <ListStack>
          {["api", "subscription", "local", "custom"].map((category) => {
            const entries = grouped.get(category as ProviderCatalogItem["category"]);
            if (!entries?.length) return null;
            return (
              <section key={category} className="space-y-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {label(category as ProviderCatalogItem["category"], language)}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {entries.map((item) => {
                    const accountCount = overview.accounts.filter((account) => account.runtime.providerId === item.id).length;
                    return (
                      <ListCard key={item.id} className="flex min-h-[152px] items-start gap-3 p-4">
                        <ProviderIcon providerId={item.iconKey} displayName={item.displayName} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-[14px] font-semibold text-neutral-950 dark:text-white">{item.displayName}</h2>
                            <SoftBadge label={item.authMethods.includes("subscription") ? (zh ? "订阅" : "Subscription") : item.category === "local" ? (zh ? "本地" : "Local") : (zh ? "API" : "API")} />
                          </div>
                          <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{item.id}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <SoftBadge label={zh ? "Codex: Responses" : "Codex: Responses"} tone="brand" />
                            {item.protocols.map((protocol) => <SoftBadge key={protocol} label={`${zh ? "上游: " : "Upstream: "}${protocolLabel(protocol)}`} />)}
                            {item.capabilities.modelDiscovery ? <SoftBadge label={zh ? "自动发现模型" : "Model discovery"} /> : null}
                            {conversionLabel(item, zh) ? <SoftBadge label={conversionLabel(item, zh)!} tone={item.capabilities.protocolConversion ? "success" : "neutral"} /> : null}
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">{accountCount} {zh ? "个账号" : "accounts"}</span>
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setActiveProvider(item)}>{zh ? "详情" : "Details"}</Button>
                              <Button size="sm" variant="outline" onClick={() => onAddAccount(item.id)}>{zh ? "添加账号" : "Add account"}</Button>
                            </div>
                          </div>
                        </div>
                      </ListCard>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </ListStack>
      )}

      <SidePanel
        open={Boolean(activeProvider)}
        title={activeProvider ? `${zh ? "服务商详情 · " : "Provider details · "}${activeProvider.displayName}` : ""}
        description={zh ? "这里展示服务商目录信息。Codex 请求统一从 Responses 进入，网关负责转换到服务商的上游协议。凭据、环境账号和模型暴露始终通过账号页管理。" : "This is a provider directory view. Codex requests enter as Responses and the Gateway converts them to the provider's upstream protocol. Manage credentials, environment accounts, and model exposure through Accounts."}
        onClose={() => setActiveProvider(undefined)}
        closeLabel={zh ? "关闭" : "Close"}
      >
        {activeProvider ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-black/[0.05] bg-slate-50 p-3">
              <ProviderIcon providerId={activeProvider.iconKey} displayName={activeProvider.displayName} size={36} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-900">{activeProvider.displayName}</div>
                <div className="font-mono text-[11px] text-slate-400">{activeProvider.id}</div>
                {activeProvider.defaultBaseUrl ? <div className="mt-1 truncate text-[11px] text-slate-500">{activeProvider.defaultBaseUrl}</div> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <SoftBadge label={label(activeProvider.category, language)} />
              {activeProvider.authMethods.map((method) => <SoftBadge key={method} label={method} />)}
              {activeProvider.protocols.map((protocol) => <SoftBadge key={protocol} label={`${zh ? "上游: " : "Upstream: "}${protocolLabel(protocol)}`} />)}
              <SoftBadge label={zh ? "Codex: Responses" : "Codex: Responses"} tone="brand" />
              {conversionLabel(activeProvider, zh) ? <SoftBadge label={conversionLabel(activeProvider, zh)!} tone={activeProvider.capabilities.protocolConversion ? "success" : "neutral"} /> : null}
            </div>
            <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
              <div className="flex justify-between gap-4"><span>{zh ? "Codex 接入协议" : "Codex ingress"}</span><span>Responses</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "服务商上游协议" : "Provider upstream"}</span><span className="text-right">{activeProvider.protocols.map((protocol) => protocolLabel(protocol)).join(" / ")}</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "网关转换" : "Gateway conversion"}</span><span>{activeProvider.capabilities.protocolConversion ? (zh ? "Responses → 上游协议" : "Responses → upstream") : (zh ? "无需转换" : "Not needed")}</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "模型发现" : "Model discovery"}</span><span>{activeProvider.capabilities.modelDiscovery ? (zh ? "支持" : "Supported") : (zh ? "手动" : "Manual")}</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "用量 / 配额" : "Quota"}</span><span>{activeProvider.capabilities.quota ? (zh ? "支持" : "Supported") : "—"}</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "凭据刷新" : "Credential refresh"}</span><span>{activeProvider.capabilities.tokenRefresh ? (zh ? "支持" : "Supported") : "—"}</span></div>
              <div className="flex justify-between gap-4"><span>{zh ? "协议转换" : "Protocol conversion"}</span><span>{activeProvider.capabilities.protocolConversion ? (zh ? "支持" : "Supported") : "—"}</span></div>
            </div>
            <div className="border-t border-black/[0.06] pt-4">
              <div className="mb-2 text-[12px] font-semibold text-slate-500">{zh ? "已连接的环境账号" : "Connected environment accounts"}</div>
              {providerAccounts.length ? (
                <div className="grid gap-2">
                  {providerAccounts.map((account) => <div key={`${account.envName}/${account.name}`} className="rounded-lg bg-slate-50 px-3 py-2 text-[12px]">{account.envName} / {account.name}</div>)}
                </div>
              ) : <div className="text-[12px] text-slate-400">{zh ? "还没有账号连接" : "No account connection yet"}</div>}
            </div>
            <Button onClick={() => onAddAccount(activeProvider.id)}>{zh ? "在账号页添加账号" : "Add account in Accounts"}</Button>
          </div>
        ) : null}
      </SidePanel>
    </ListPageFrame>
  );
}
