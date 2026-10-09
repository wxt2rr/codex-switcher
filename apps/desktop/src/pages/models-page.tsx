import { useEffect, useMemo, useState } from "react";
import { Braces, FilePenLine, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import type { CustomModelRecord, DesktopBridge, ModelCatalogEntry, ModelCatalogSnapshot, ProviderCatalogItem } from "../bridge";
import type { OverviewPayload } from "../desktop-model";
import type { UiLanguage } from "../i18n";
import {
  IconActionButton,
  ListCard,
  ListLoadingState,
  ListPageFrame,
  ListPageHeader,
  ListStack,
  SoftBadge,
} from "../components/account-list-primitives";
import { ConfirmDialog, SidePanel } from "../components/admin-primitives";
import { Field, Input, Select, Textarea } from "../components/form-primitives";
import { Button } from "../components/ui/button";
import { ProviderIcon } from "../components/provider-icon";
import {
  createDefaultModelEntry,
  parseSingleModelCatalog,
  serializeSingleModelCatalog,
} from "../model-editor";

function providerLabel(providerId: string, providerCatalog: ProviderCatalogItem[], zh: boolean): string {
  if (providerId === "custom") return zh ? "手动配置" : "Manual";
  return providerCatalog.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

function discoveryStatusLabel(status: string, zh: boolean): string {
  if (status === "available") return zh ? "可用" : "Available";
  if (status === "stale") return zh ? "结果已过期" : "Stale";
  if (status === "discovering") return zh ? "正在发现" : "Discovering";
  if (status === "failed") return zh ? "发现失败" : "Discovery failed";
  if (status === "unavailable") return zh ? "暂不可用" : "Unavailable";
  return status;
}

function accountLabel(
  accountKey: string,
  accountsByKey: Map<string, OverviewPayload["accounts"][number]>,
): string {
  const account = accountsByKey.get(accountKey);
  return account ? `${account.envName} / ${account.name}` : accountKey;
}

function AccountSourceSummary({
  label,
  count,
  emptyLabel,
  accountLabels,
  zh,
}: {
  label: string;
  count: number;
  emptyLabel: string;
  accountLabels: string[];
  zh: boolean;
}) {
  const preview = accountLabels.slice(0, 2);
  const remaining = Math.max(0, accountLabels.length - preview.length);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
        <span>{label}</span>
        <span>{count} {zh ? "个账号" : count === 1 ? "account" : "accounts"}</span>
      </div>
      {preview.length ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
          {preview.map((account) => <SoftBadge key={account} label={account} className="max-w-full truncate text-[10px]" />)}
          {remaining ? <SoftBadge label={`+${remaining}`} className="text-[10px]" /> : null}
        </div>
      ) : <div className="mt-1.5 text-[11px] text-slate-400">{emptyLabel}</div>}
    </div>
  );
}

export function ModelsPage({
  overview,
  language,
  providerCatalog,
  bridge,
  onSuccess,
  onError,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  providerCatalog: ProviderCatalogItem[];
  bridge: DesktopBridge;
  onSuccess: (message: string) => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const [snapshot, setSnapshot] = useState<ModelCatalogSnapshot>({ version: 1, models: [], accountBindings: {} });
  const [activeModelId, setActiveModelId] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [draft, setDraft] = useState<ModelCatalogEntry>(createDefaultModelEntry());
  const [jsonDraft, setJsonDraft] = useState(serializeSingleModelCatalog(createDefaultModelEntry()));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const activeModel = snapshot.models.find((model) => model.id === activeModelId);
  const knownAccountKeys = useMemo(
    () => new Set(overview.accounts.map((account) => `${account.envName}/${account.name}`)),
    [overview.accounts],
  );
  const accountsByKey = useMemo(
    () => new Map(overview.accounts.map((account) => [`${account.envName}/${account.name}`, account])),
    [overview.accounts],
  );

  const exposedAccountKeysByModel = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const [accountKey, modelIds] of Object.entries(snapshot.accountBindings)) {
      if (!knownAccountKeys.has(accountKey)) continue;
      for (const modelId of modelIds) {
        result.set(modelId, [...new Set([...(result.get(modelId) ?? []), accountKey])]);
      }
    }
    return result;
  }, [knownAccountKeys, snapshot.accountBindings]);

  const discoveryByModelKey = useMemo(() => {
    const result = new Map<string, { providerId: string; status: string; accountKeys: string[] }>();
    for (const [accountKey, discovery] of Object.entries(snapshot.accountModelDiscoveries ?? {})) {
      for (const model of discovery.models) {
        const current = result.get(model.providerModelKey);
        const accountKeys = knownAccountKeys.has(accountKey)
          ? [...new Set([...(current?.accountKeys ?? []), accountKey])]
          : (current?.accountKeys ?? []);
        result.set(model.providerModelKey, {
          providerId: current?.providerId ?? model.providerId,
          status: current?.status === "available" || model.status !== "available" ? (current?.status ?? model.status) : model.status,
          accountKeys,
        });
      }
    }
    return result;
  }, [knownAccountKeys, snapshot.accountModelDiscoveries]);

  const providerOptions = useMemo(() => {
    const ids = snapshot.models.map((model) => {
      const providerKey = typeof model.entry.provider_model_key === "string" ? model.entry.provider_model_key : undefined;
      const discoveryInfo = providerKey ? discoveryByModelKey.get(providerKey) : undefined;
      return String(model.entry.provider_id ?? discoveryInfo?.providerId ?? "custom");
    });
    return [...new Set(ids)].sort((left, right) => providerLabel(left, providerCatalog, zh).localeCompare(providerLabel(right, providerCatalog, zh)));
  }, [discoveryByModelKey, providerCatalog, snapshot.models, zh]);

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot.models.filter((model) => {
      const providerKey = typeof model.entry.provider_model_key === "string" ? model.entry.provider_model_key : undefined;
      const discoveryInfo = providerKey ? discoveryByModelKey.get(providerKey) : undefined;
      const providerId = String(model.entry.provider_id ?? discoveryInfo?.providerId ?? "custom");
      if (providerFilter !== "all" && providerId !== providerFilter) return false;
      return !normalized || `${model.entry.display_name} ${model.entry.slug} ${providerId}`.toLowerCase().includes(normalized);
    });
  }, [discoveryByModelKey, providerFilter, query, snapshot.models]);

  useEffect(() => {
    void bridge.listCustomModels().then(setSnapshot).catch(onError).finally(() => setLoading(false));
  }, [bridge]);

  async function refreshDiscoveries() {
    setRefreshing(true);
    try {
      for (const account of overview.accounts) {
        await bridge.discoverAccountModels(account.envName, account.name);
      }
      setSnapshot(await bridge.listCustomModels());
      onSuccess(zh ? "账号模型目录已刷新" : "Account model catalogs refreshed");
    } catch (error) {
      onError(error);
    } finally {
      setRefreshing(false);
    }
  }

  function openEditor(model?: CustomModelRecord) {
    const entry = model?.entry ?? createDefaultModelEntry();
    setActiveModelId(model?.id);
    setDraft(entry);
    setJsonDraft(serializeSingleModelCatalog(entry));
    setMode("form");
    setEditorOpen(true);
  }

  function openDelete(model: CustomModelRecord) {
    setActiveModelId(model.id);
    setDeleteOpen(true);
  }

  function updateDraft(next: ModelCatalogEntry) {
    setDraft(next);
    setJsonDraft(serializeSingleModelCatalog(next));
  }

  function changeMode(nextMode: "form" | "json") {
    if (nextMode === "form") {
      try {
        setDraft(parseSingleModelCatalog(jsonDraft));
      } catch (error) {
        onError(error);
        return;
      }
    } else {
      setJsonDraft(serializeSingleModelCatalog(draft));
    }
    setMode(nextMode);
  }

  async function saveModel() {
    setBusy(true);
    try {
      const entry = mode === "json" ? parseSingleModelCatalog(jsonDraft) : draft;
      setSnapshot(await bridge.saveCustomModel({ id: activeModelId, entry }));
      setEditorOpen(false);
      onSuccess(zh ? "模型已保存" : "Model saved");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function removeModel() {
    if (!activeModelId) return;
    setBusy(true);
    try {
      setSnapshot(await bridge.deleteCustomModel(activeModelId));
      setDeleteOpen(false);
      onSuccess(zh ? "模型已删除" : "Model deleted");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ListPageFrame>
      <ListPageHeader
        title={zh ? "模型" : "Models"}
        subtitle={zh ? "管理服务商发现模型和手动模型；账号模型暴露请在账号页配置" : "Manage discovered and manual models; configure account exposure in Accounts"}
        search={query}
        searchPlaceholder={zh ? "搜索模型、服务商或标识" : "Search models, providers, or ids"}
        onSearchChange={setQuery}
        showFilter={false}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
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
              className="h-8 w-[132px] shrink-0 bg-[#f3f4f6] text-[12px] dark:bg-[#1b2129]"
            />
            <Button size="sm" variant="outline" onClick={() => void refreshDiscoveries()} disabled={refreshing}>
              <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
              {zh ? "刷新发现" : "Refresh discovery"}
            </Button>
            <Button size="sm" onClick={() => openEditor()}>
              <Plus className="size-4" />
              {zh ? "添加模型" : "Add model"}
            </Button>
          </div>
        )}
      />

      <ListStack className="grid grid-cols-1 gap-3 space-y-0 lg:grid-cols-2 2xl:grid-cols-3">
        {loading ? <ListLoadingState rows={3} /> : snapshot.models.length === 0 ? (
          <ListCard className="flex min-h-[150px] items-center justify-center text-[13px] font-medium text-slate-400">
            {zh ? "暂无自定义模型" : "No custom models"}
          </ListCard>
        ) : visibleModels.map((model) => {
          const providerKey = typeof model.entry.provider_model_key === "string" ? model.entry.provider_model_key : undefined;
          const discoveryInfo = providerKey ? discoveryByModelKey.get(providerKey) : undefined;
          const providerId = String(model.entry.provider_id ?? discoveryInfo?.providerId ?? "custom");
          const sourceAccountLabels = (discoveryInfo?.accountKeys ?? []).map((key) => accountLabel(key, accountsByKey));
          const exposedAccountLabels = (exposedAccountKeysByModel.get(model.id) ?? []).map((key) => accountLabel(key, accountsByKey));
          const statusTone = discoveryInfo?.status === "available" ? "success" : discoveryInfo ? "warn" : "neutral";
          return (
            <ListCard key={model.id} className="flex min-h-[226px] flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ProviderIcon providerId={providerId} displayName={providerLabel(providerId, providerCatalog, zh)} size={34} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-neutral-950 dark:text-white">{model.entry.display_name}</h3>
                    <SoftBadge label={providerLabel(providerId, providerCatalog, zh)} className="max-w-[130px] truncate text-[10px]" />
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{model.entry.slug}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <SoftBadge label={model.entry.model_source === "discovered" ? (zh ? "服务商发现" : "Discovered") : (zh ? "手动配置" : "Manual")} />
                    {discoveryInfo ? <SoftBadge tone={statusTone} label={discoveryStatusLabel(discoveryInfo.status, zh)} /> : null}
                  </div>
                </div>
              </div>
                <div className="responsive-actions shrink-0">
                <IconActionButton icon={<Pencil className="size-4" />} label={zh ? "编辑" : "Edit"} onClick={() => openEditor(model)} />
                <IconActionButton icon={<Trash2 className="size-4" />} label={zh ? "删除" : "Delete"} onClick={() => openDelete(model)} tone="danger" />
                </div>
              </div>
              <div className="mt-auto grid gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
                <AccountSourceSummary label={zh ? "发现来源" : "Discovered by"} count={sourceAccountLabels.length} emptyLabel={zh ? "暂无已知来源账号" : "No known source account"} accountLabels={sourceAccountLabels} zh={zh} />
                <AccountSourceSummary label={zh ? "账号暴露" : "Exposed to"} count={exposedAccountLabels.length} emptyLabel={zh ? "未暴露到账号" : "Not exposed to any account"} accountLabels={exposedAccountLabels} zh={zh} />
              </div>
            </ListCard>
          );
        })}
      </ListStack>

      <SidePanel
        open={editorOpen}
        title={activeModel ? (zh ? "编辑模型" : "Edit model") : (zh ? "添加模型" : "Add model")}
        description={zh ? "表单填写核心字段，JSON 可编辑完整目录配置" : "Use the form for core fields or JSON for the complete catalog entry"}
        onClose={() => setEditorOpen(false)}
        closeLabel={zh ? "关闭" : "Close"}
      >
        <div className="mb-5 flex items-center gap-1 rounded-lg bg-neutral-100 p-1">
          <button type="button" onClick={() => changeMode("form")} aria-pressed={mode === "form"} className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[12px] ${mode === "form" ? "ui-selected-control" : "border-transparent text-slate-500"}`}><FilePenLine className="size-3.5" />{zh ? "表单" : "Form"}</button>
          <button type="button" onClick={() => changeMode("json")} aria-pressed={mode === "json"} className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[12px] ${mode === "json" ? "ui-selected-control" : "border-transparent text-slate-500"}`}><Braces className="size-3.5" />JSON</button>
        </div>
        {mode === "form" ? (
          <div className="space-y-4">
            <Field label={zh ? "模型标识（slug）" : "Model slug"}><Input value={draft.slug} onChange={(event) => updateDraft({ ...draft, slug: event.target.value })} placeholder="mimo-v2.5-pro" /></Field>
            <Field label={zh ? "展示名称" : "Display name"}><Input value={draft.display_name} onChange={(event) => updateDraft({ ...draft, display_name: event.target.value })} placeholder="MiMo V2.5 Pro" /></Field>
          </div>
        ) : (
          <Field label="model-catalogs.json"><Textarea className="min-h-[420px] font-mono text-[12px] leading-5" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} /></Field>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditorOpen(false)}>{zh ? "取消" : "Cancel"}</Button>
          <Button onClick={() => void saveModel()} disabled={busy}><Save className="size-4" />{zh ? "保存" : "Save"}</Button>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={deleteOpen}
        title={zh ? "删除模型" : "Delete model"}
        description={zh ? `删除后将从 ${activeModel ? (exposedAccountKeysByModel.get(activeModel.id)?.length ?? 0) : 0} 个账号取消暴露，且无法恢复。` : `This removes the model from ${activeModel ? (exposedAccountKeysByModel.get(activeModel.id)?.length ?? 0) : 0} accounts and cannot be undone.`}
        confirmLabel={zh ? "删除" : "Delete"}
        cancelLabel={zh ? "取消" : "Cancel"}
        onConfirm={() => void removeModel()}
        onCancel={() => setDeleteOpen(false)}
      />
    </ListPageFrame>
  );
}
