import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleHelp, RefreshCw, Search } from "lucide-react";

import type {
  AccountModelDiscoverySnapshot,
  DesktopBridge,
  ModelCatalogSnapshot,
  ProviderCatalogItem,
} from "../bridge";
import type { UiLanguage } from "../i18n";
import { ProviderIcon } from "./provider-icon";
import { SidePanel } from "./admin-primitives";
import { Input, Select } from "./form-primitives";
import { Tooltip } from "./ui/tooltip";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { ModelTestButton } from "./model-test-button";
import {
  buildAccountModelCandidates,
  discoveryByProviderKeyOf,
  providerIdForAccountModel,
} from "./account-model-exposure-utils";

function accountKeyOf(envName: string, accountName: string): string {
  return `${envName}/${accountName}`;
}

function modelSourceLabel(source: string | undefined, zh: boolean): string {
  if (source === "discovered") return zh ? "服务商发现" : "Discovered";
  if (source === "preset") return zh ? "服务商预设" : "Provider preset";
  if (source === "cached") return zh ? "缓存模型" : "Cached";
  return zh ? "手动配置" : "Manual";
}

function discoveryStateLabel(snapshot: AccountModelDiscoverySnapshot | undefined, zh: boolean): string {
  if (!snapshot) return zh ? "尚未发现模型" : "Model discovery has not run";
  if (snapshot.state === "discovering") return zh ? "正在发现模型…" : "Discovering models…";
  if (snapshot.state === "failed") return zh ? "发现失败，可重试" : "Discovery failed; retry available";
  if (snapshot.state === "stale") return zh ? "使用上次结果" : "Using the last result";
  return zh ? `已发现 ${snapshot.models.length} 个模型` : `${snapshot.models.length} models discovered`;
}

function providerLabel(providerId: string, providerCatalog: ProviderCatalogItem[], zh: boolean, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim();
  if (providerId === "custom") return zh ? "手动配置" : "Manual";
  return providerCatalog.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

export function AccountModelExposurePanel({
  open,
  envName,
  accountName,
  language,
  providerCatalog,
  bridge,
  onOpenModelSettings,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  envName?: string;
  accountName?: string;
  language: UiLanguage;
  providerCatalog: ProviderCatalogItem[];
  bridge: DesktopBridge;
  onOpenModelSettings: () => void;
  onClose: () => void;
  onSaved?: () => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const accountKey = envName && accountName ? accountKeyOf(envName, accountName) : "";
  const [snapshot, setSnapshot] = useState<ModelCatalogSnapshot>({ version: 1, models: [], accountBindings: {} });
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadModels(discover: boolean) {
    if (!accountKey || !envName || !accountName) return;
    discover ? setRefreshing(true) : setLoading(true);
    try {
      const next = discover
        ? await bridge.discoverAccountModels(envName, accountName)
        : await bridge.listCustomModels();
      setSnapshot(next);
      setSelectedIds(next.accountBindings[accountKey] ?? []);
    } catch (error) {
      onError(error);
    } finally {
      discover ? setRefreshing(false) : setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setProviderFilter("all");
    setModelFilter("all");
    void loadModels(false);
    // The panel is scoped to one account; the account key is the complete
    // reload boundary and deliberately avoids leaking another account's picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountKey]);

  const discovery = snapshot.accountModelDiscoveries?.[accountKey];
  const catalogFallback = discovery?.state === "failed"
    || (discovery?.state === "ready" && !discovery.models.some((model) => model.status === "available"));
  const discoveryByProviderKey = useMemo(
    () => discoveryByProviderKeyOf(snapshot, accountKey),
    [snapshot, accountKey],
  );

  const allCandidates = useMemo(() => {
    return buildAccountModelCandidates(snapshot, accountKey, selectedIds, catalogFallback);
  }, [accountKey, catalogFallback, selectedIds, snapshot]);

  const providerOptions = useMemo(() => {
    return [...new Set(allCandidates.map((model) => providerIdForAccountModel(model, discoveryByProviderKey)))].sort((left, right) =>
      providerLabel(left, providerCatalog, zh).localeCompare(providerLabel(right, providerCatalog, zh)),
    );
  }, [allCandidates, discoveryByProviderKey, providerCatalog, zh]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allCandidates.filter((model) => {
      const providerId = providerIdForAccountModel(model, discoveryByProviderKey);
      if (providerFilter !== "all" && providerId !== providerFilter) return false;
      if (modelFilter === "selected" && !selectedIds.includes(model.id)) return false;
      if (!query) return true;
      return `${model.entry.display_name} ${model.entry.slug} ${providerId} ${String(model.entry.provider_display_name ?? "")}`.toLowerCase().includes(query);
    });
  }, [allCandidates, discoveryByProviderKey, modelFilter, providerFilter, search, selectedIds]);

  function toggleModel(modelId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, modelId])]
      : current.filter((id) => id !== modelId));
  }

  function toggleVisibleModels(checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, ...candidates.map((model) => model.id)])]
      : current.filter((id) => !candidates.some((model) => model.id === id)));
  }

  async function save() {
    if (!accountKey) return;
    setSaving(true);
    try {
      setSnapshot(await bridge.setAccountModelBindings(accountKey, selectedIds));
      onSaved?.();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  const allVisibleSelected = candidates.length > 0 && candidates.every((model) => selectedIds.includes(model.id));
  const someVisibleSelected = candidates.some((model) => selectedIds.includes(model.id));
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  return (
    <SidePanel
      open={open}
      title={zh ? "选择账号模型" : "Choose account models"}
      description={accountKey ? `${accountKey} · ${discoveryStateLabel(discovery, zh)}` : undefined}
      onClose={onClose}
      closeLabel={zh ? "关闭" : "Close"}
      scrollable={false}
      footer={<>
        <span className="mr-auto max-w-[18rem] text-[11px] leading-5 text-muted-foreground">{zh ? "可在模型页面继续调整优先级、权重和上游模型名。" : "Adjust priority, weight, and upstream ids later on the Models page."}</span>
        <Button type="button" variant="outline" onClick={onClose}>{zh ? "取消" : "Cancel"}</Button>
        <Button type="button" onClick={() => void save()} disabled={saving || loading}>{saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存暴露模型" : "Save exposed models")}</Button>
      </>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0 rounded-xl bg-secondary px-3.5 py-3 text-[12px] leading-5 text-foreground-secondary">
          {zh
            ? "只会暴露你勾选的模型。服务商返回的模型和模型页面手动配置的模型可以同时选择；发现失败不会删除上次结果。"
            : "Only checked models are exposed. Discovered provider models and manually configured models can be selected together; a failed refresh keeps the last result."}
        </div>
        {catalogFallback ? (
          <div role="status" className="shrink-0 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-[12px] leading-5 text-amber-900">
            <div className="font-medium">
              {discovery?.state === "failed"
                ? (zh ? "尝试抓取服务商模型失败" : "Failed to fetch provider models")
                : (zh ? "服务商没有返回模型" : "The provider returned no models")}
            </div>
            {discovery.lastError ? <div className="mt-1 break-words text-amber-800">{discovery.lastError}</div> : null}
            <div className="mt-1 text-amber-800">
              {zh ? "你可以从当前模型列表中选择模型；保存后会按当前服务商绑定。" : "Choose from the existing model catalog; saved selections will be bound to this provider."}
            </div>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "搜索模型、服务商或标识" : "Search model, provider, or id"} className="pl-9" />
          </div>
          <Select
            value={providerFilter}
            onValueChange={setProviderFilter}
            items={[
              { value: "all", label: zh ? "全部服务商" : "All providers" },
              ...providerOptions.map((providerId) => ({
                value: providerId,
                label: providerLabel(
                  providerId,
                  providerCatalog,
                  zh,
                  String(allCandidates.find((model) => providerIdForAccountModel(model, discoveryByProviderKey) === providerId)?.entry.provider_display_name ?? ""),
                ),
              })),
            ]}
            openOnHover={false}
            className="h-9 min-w-[140px] max-w-[180px] flex-1 bg-card text-[12px]"
          />
          <Select
            value={modelFilter}
            onValueChange={setModelFilter}
            items={[
              { value: "all", label: zh ? "全部模型" : "All models" },
              { value: "selected", label: zh ? "已选择" : "Selected" },
            ]}
            openOnHover={false}
            className="h-9 min-w-[100px] max-w-[130px] flex-1 bg-card text-[12px]"
          />
          <Button type="button" variant="outline" onClick={() => void loadModels(true)} disabled={refreshing || loading || !accountKey}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            {zh ? "刷新" : "Refresh"}
          </Button>
          <Tooltip content={zh ? "找不到支持的模型？点击这里，去模型设置页新增自定义模型吧。" : "Can't find a supported model? Open Models to add a custom model."}>
            <button
              type="button"
              onClick={onOpenModelSettings}
              aria-label={zh ? "打开模型设置" : "Open model settings"}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border-subtle bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <CircleHelp className="size-4" />
            </button>
          </Tooltip>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span>{loading ? (zh ? "正在加载目录…" : "Loading catalog…") : (zh ? `显示 ${candidates.length} 个模型，已选 ${selectedIds.length} 个` : `${candidates.length} shown, ${selectedIds.length} selected`)}</span>
          <label
            className={cn(
              "inline-flex items-center gap-1.5 font-medium text-foreground",
              candidates.length === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
            title={zh ? "选择或取消当前筛选结果" : "Select or clear the current filtered results"}
          >
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleVisibleModels(event.target.checked)}
              disabled={candidates.length === 0}
              aria-label={zh ? "全选当前结果" : "Select all visible models"}
              className="size-3.5 accent-primary"
            />
            <span>{zh ? "全选" : "Select all"}</span>
          </label>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] leading-5 text-muted-foreground">
              {zh ? "没有可选择的模型。可以先在模型页面添加手动模型，或检查服务商凭据后重试。" : "No selectable models. Add a manual model on the Models page or retry after checking the credential."}
            </div>
          ) : candidates.map((model) => {
            const providerId = providerIdForAccountModel(model, discoveryByProviderKey);
            const providerModelKey = typeof model.entry.provider_model_key === "string"
              ? model.entry.provider_model_key.trim()
              : "";
            const fallbackUpstreamModel = providerModelKey.includes(":")
              ? providerModelKey.slice(providerModelKey.indexOf(":") + 1)
              : undefined;
            const discovered = providerModelKey
              ? discoveryByProviderKey.get(providerModelKey)
              : undefined;
            const stale = discovered?.status === "stale" || discovered?.status === "unavailable";
            const checked = selectedIds.includes(model.id);
            const historicalBinding = !catalogFallback && Boolean(providerModelKey && !discovered && checked);
            return (
              <div key={model.id} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", historicalBinding ? "border-amber-200 bg-amber-50/40" : checked ? "border-border-strong bg-secondary" : "border-border-subtle bg-card hover:bg-accent")}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={checked} onChange={(event) => toggleModel(model.id, event.target.checked)} className="mt-1 size-4 accent-primary" />
                  <ProviderIcon
                    providerId={providerCatalog.find((item) => item.id === providerId)?.iconKey ?? providerId}
                    displayName={providerLabel(providerId, providerCatalog, zh, String(model.entry.provider_display_name ?? ""))}
                    size={24}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{model.entry.display_name}</span>
                      {checked ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : null}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{model.entry.slug}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className={cn("rounded px-1.5 py-0.5", historicalBinding ? "bg-amber-100 text-amber-800" : "bg-secondary")}>
                        {historicalBinding
                          ? (zh ? "历史绑定，当前账号未发现" : "Historical binding; not found for this account")
                          : modelSourceLabel(discovered?.source ?? String(model.entry.model_source ?? "manual"), zh)}
                      </span>
                      {discovered?.upstreamModelId && discovered.upstreamModelId !== model.entry.slug ? <span className="font-mono">→ {discovered.upstreamModelId}</span> : null}
                      {stale ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{zh ? "结果已过期" : "Stale"}</span> : null}
                    </span>
                  </span>
                </label>
                <ModelTestButton
                  bridge={bridge}
                  language={language}
                  request={{
                    envName: envName!,
                    accountName: accountName!,
                    model: model.entry.slug,
                    ...(discovered?.upstreamModelId || fallbackUpstreamModel
                      ? { upstreamModel: discovered?.upstreamModelId ?? fallbackUpstreamModel }
                      : {}),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </SidePanel>
  );
}
