import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Search } from "lucide-react";

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
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
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

function providerLabel(providerId: string, providerCatalog: ProviderCatalogItem[], zh: boolean): string {
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
  onClose: () => void;
  onSaved?: () => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const accountKey = envName && accountName ? accountKeyOf(envName, accountName) : "";
  const [snapshot, setSnapshot] = useState<ModelCatalogSnapshot>({ version: 1, models: [], accountBindings: {} });
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
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
    void loadModels(false);
    // The panel is scoped to one account; the account key is the complete
    // reload boundary and deliberately avoids leaking another account's picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountKey]);

  const discovery = snapshot.accountModelDiscoveries?.[accountKey];
  const discoveryByProviderKey = useMemo(
    () => discoveryByProviderKeyOf(snapshot, accountKey),
    [snapshot, accountKey],
  );

  const allCandidates = useMemo(() => {
    return buildAccountModelCandidates(snapshot, accountKey, selectedIds);
  }, [accountKey, selectedIds, snapshot]);

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
      if (!query) return true;
      return `${model.entry.display_name} ${model.entry.slug} ${providerId}`.toLowerCase().includes(query);
    });
  }, [allCandidates, discoveryByProviderKey, providerFilter, search]);

  function toggleModel(modelId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, modelId])]
      : current.filter((id) => id !== modelId));
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

  return (
    <SidePanel
      open={open}
      title={zh ? "选择账号模型" : "Choose account models"}
      description={accountKey ? `${accountKey} · ${discoveryStateLabel(discovery, zh)}` : undefined}
      onClose={onClose}
      closeLabel={zh ? "关闭" : "Close"}
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-[#f7f8fa] px-3.5 py-3 text-[12px] leading-5 text-slate-600">
          {zh
            ? "只会暴露你勾选的模型。服务商返回的模型和模型页面手动配置的模型可以同时选择；发现失败不会删除上次结果。"
            : "Only checked models are exposed. Discovered provider models and manually configured models can be selected together; a failed refresh keeps the last result."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "搜索模型、服务商或标识" : "Search model, provider, or id"} className="pl-9" />
          </div>
          <Select
            value={providerFilter}
            onValueChange={setProviderFilter}
            items={[
              { value: "all", label: zh ? "全部服务商" : "All providers" },
              ...providerOptions.map((providerId) => ({
                value: providerId,
                label: providerLabel(providerId, providerCatalog, zh),
              })),
            ]}
            openOnHover={false}
            className="h-9 min-w-[140px] max-w-[180px] flex-1 bg-white text-[12px]"
          />
          <Button type="button" variant="outline" onClick={() => void loadModels(true)} disabled={refreshing || loading || !accountKey}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            {zh ? "刷新" : "Refresh"}
          </Button>
        </div>
        <div className="flex items-center justify-between text-[12px] text-slate-500">
          <span>{loading ? (zh ? "正在加载目录…" : "Loading catalog…") : (zh ? `显示 ${candidates.length} 个模型，已选 ${selectedIds.length} 个` : `${candidates.length} shown, ${selectedIds.length} selected`)}</span>
          <button
            type="button"
            className="font-medium text-neutral-800 hover:underline"
            onClick={() => setSelectedIds(allVisibleSelected ? selectedIds.filter((id) => !candidates.some((model) => model.id === id)) : [...new Set([...selectedIds, ...candidates.map((model) => model.id)])])}
            disabled={candidates.length === 0}
          >
            {allVisibleSelected ? (zh ? "取消全选" : "Clear visible") : (zh ? "全选显示结果" : "Select visible")}
          </button>
        </div>
        <div className="max-h-[500px] space-y-2 overflow-auto pr-1">
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/[0.1] px-4 py-8 text-center text-[12px] leading-5 text-slate-500">
              {zh ? "没有可选择的模型。可以先在模型页面添加手动模型，或检查服务商凭据后重试。" : "No selectable models. Add a manual model on the Models page or retry after checking the credential."}
            </div>
          ) : candidates.map((model) => {
            const providerId = providerIdForAccountModel(model, discoveryByProviderKey);
            const providerModelKey = typeof model.entry.provider_model_key === "string"
              ? model.entry.provider_model_key.trim()
              : "";
            const discovered = providerModelKey
              ? discoveryByProviderKey.get(providerModelKey)
              : undefined;
            const stale = discovered?.status === "stale" || discovered?.status === "unavailable";
            const checked = selectedIds.includes(model.id);
            const historicalBinding = Boolean(providerModelKey && !discovered && checked);
            return (
              <label key={model.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", historicalBinding ? "border-amber-200 bg-amber-50/40" : checked ? "border-neutral-300 bg-neutral-50" : "border-black/[0.07] bg-white hover:bg-neutral-50")}>
                <input type="checkbox" checked={checked} onChange={(event) => toggleModel(model.id, event.target.checked)} className="mt-1 size-4 accent-[#34C759]" />
                <ProviderIcon providerId={providerId} displayName={providerId} size={24} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-neutral-900">{model.entry.display_name}</span>
                    {checked ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">{model.entry.slug}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    <span className={cn("rounded px-1.5 py-0.5", historicalBinding ? "bg-amber-100 text-amber-800" : "bg-slate-100")}>
                      {historicalBinding
                        ? (zh ? "历史绑定，当前账号未发现" : "Historical binding; not found for this account")
                        : modelSourceLabel(discovered?.source ?? String(model.entry.model_source ?? "manual"), zh)}
                    </span>
                    {discovered?.upstreamModelId && discovered.upstreamModelId !== model.entry.slug ? <span className="font-mono">→ {discovered.upstreamModelId}</span> : null}
                    {stale ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{zh ? "结果已过期" : "Stale"}</span> : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] pt-4">
          <span className="text-[11px] leading-5 text-slate-500">{zh ? "可在模型页面继续调整优先级、权重和上游模型名。" : "Adjust priority, weight, and upstream ids later on the Models page."}</span>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{zh ? "取消" : "Cancel"}</Button>
            <Button type="button" onClick={() => void save()} disabled={saving || loading}>{saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存暴露模型" : "Save exposed models")}</Button>
          </div>
        </div>
      </div>
    </SidePanel>
  );
}
