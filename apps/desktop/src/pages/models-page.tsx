import { useEffect, useMemo, useState } from "react";
import { Braces, FilePenLine, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import type { CustomModelRecord, DesktopBridge, GatewayCapabilityObservationEntry, ModelCatalogEntry, ModelCatalogSnapshot, ProviderCatalogItem } from "../bridge";
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
import { Field, Select, Textarea } from "../components/form-primitives";
import { Button } from "../components/ui/button";
import { ProviderIcon } from "../components/provider-icon";
import { ModelCatalogForm } from "../components/model-catalog-form";
import { ModelTestButton } from "../components/model-test-button";
import {
  createDefaultModelEntry,
  normalizeModelEntryForEditor,
  parseSingleModelCatalog,
  serializeSingleModelCatalog,
} from "../model-editor";

function providerLabel(providerId: string, providerCatalog: ProviderCatalogItem[], zh: boolean, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim();
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

function capabilityStatusLabel(status: GatewayCapabilityObservationEntry["status"], zh: boolean): string {
  if (status === "supported") return zh ? "支持" : "Supported";
  if (status === "unsupported") return zh ? "不支持" : "Unsupported";
  if (status === "degraded") return zh ? "降级" : "Degraded";
  return zh ? "未知" : "Unknown";
}

function capabilityLabel(capability: string, zh: boolean): string {
  const labels: Record<string, string> = {
    "tools.hosted.web_search": zh ? "联网搜索" : "Web search",
    "tools.hosted.code_interpreter": zh ? "代码解释器" : "Code interpreter",
    "tools.hosted.computer_use": zh ? "电脑操作" : "Computer use",
    "tools.function": zh ? "函数工具" : "Function tools",
    "tools.parallel": zh ? "并行工具" : "Parallel tools",
    "input.image": zh ? "图片输入" : "Image input",
    "output.reasoning": zh ? "推理" : "Reasoning",
  };
  return labels[capability] ?? capability;
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
          {preview.map((account) => <SoftBadge key={account} label={account} className="h-5 max-w-full truncate rounded-md px-2 text-[10px]" />)}
          {remaining ? <SoftBadge label={`+${remaining}`} className="h-5 rounded-md px-2 text-[10px]" /> : null}
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
  const [capabilityObservations, setCapabilityObservations] = useState<GatewayCapabilityObservationEntry[]>([]);

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
    const result = new Map<string, { providerId: string; status: string; accountKeys: string[]; upstreamModelId?: string }>();
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
          upstreamModelId: current?.upstreamModelId ?? model.upstreamModelId,
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
      return !normalized || `${model.entry.display_name} ${model.entry.slug} ${providerId} ${String(model.entry.provider_display_name ?? "")}`.toLowerCase().includes(normalized);
    });
  }, [discoveryByModelKey, providerFilter, query, snapshot.models]);

  useEffect(() => {
    void Promise.all([bridge.listCustomModels(), bridge.listGatewayCapabilityObservations()])
      .then(([nextSnapshot, observations]) => { setSnapshot(nextSnapshot); setCapabilityObservations(observations); })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [bridge]);

  async function refreshDiscoveries() {
    setRefreshing(true);
    try {
      for (const account of overview.accounts) {
        await bridge.discoverAccountModels(account.envName, account.name);
      }
      setSnapshot(await bridge.listCustomModels());
      setCapabilityObservations(await bridge.listGatewayCapabilityObservations());
      onSuccess(zh ? "账号模型目录已刷新" : "Account model catalogs refreshed");
    } catch (error) {
      onError(error);
    } finally {
      setRefreshing(false);
    }
  }

  function openEditor(model?: CustomModelRecord) {
    const entry = normalizeModelEntryForEditor(model?.entry ?? createDefaultModelEntry());
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
        setDraft(normalizeModelEntryForEditor(parseSingleModelCatalog(jsonDraft)));
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
                  label: providerLabel(
                    providerId,
                    providerCatalog,
                    zh,
                    String(snapshot.models.find((model) => model.entry.provider_id === providerId)?.entry.provider_display_name ?? ""),
                  ),
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

      {loading ? <ListLoadingState rows={3} /> : snapshot.models.length === 0 ? (
          <ListCard className="flex min-h-[150px] items-center justify-center text-[13px] font-medium text-slate-400">
            {zh ? "暂无自定义模型" : "No custom models"}
          </ListCard>
        ) : (
        <ListStack>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleModels.length ? visibleModels.map((model) => {
          const providerKey = typeof model.entry.provider_model_key === "string" ? model.entry.provider_model_key : undefined;
          const discoveryInfo = providerKey ? discoveryByModelKey.get(providerKey) : undefined;
          const fallbackUpstreamModel = providerKey?.includes(":") ? providerKey.slice(providerKey.indexOf(":") + 1) : undefined;
          const providerId = String(model.entry.provider_id ?? discoveryInfo?.providerId ?? "custom");
          const sourceAccountLabels = (discoveryInfo?.accountKeys ?? []).map((key) => accountLabel(key, accountsByKey));
          const exposedAccountLabels = (exposedAccountKeysByModel.get(model.id) ?? []).map((key) => accountLabel(key, accountsByKey));
          const statusTone = discoveryInfo?.status === "available" ? "success" : discoveryInfo ? "warn" : "neutral";
          const testAccountKey = exposedAccountKeysByModel.get(model.id)?.[0] ?? discoveryInfo?.accountKeys?.[0];
          const testAccount = testAccountKey ? accountsByKey.get(testAccountKey) : undefined;
          const modelCapabilityObservations = capabilityObservations.filter((entry) => {
            const upstream = String(model.entry.upstream_model_id ?? "");
            const slug = model.entry.slug;
            return entry.modelId === slug || entry.modelId === upstream || (slug.includes(":") && entry.modelId === slug.slice(slug.indexOf(":") + 1));
          });
          return (
            <ListCard key={model.id} className="flex min-h-[178px] flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ProviderIcon
                    providerId={providerCatalog.find((item) => item.id === providerId)?.iconKey ?? providerId}
                    displayName={providerLabel(providerId, providerCatalog, zh, String(model.entry.provider_display_name ?? ""))}
                    size={32}
                  />
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold text-neutral-950 dark:text-white">{model.entry.display_name}</h3>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{model.entry.slug}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <SoftBadge label={providerLabel(providerId, providerCatalog, zh, String(model.entry.provider_display_name ?? ""))} className="h-5 max-w-[150px] truncate rounded-md px-2 text-[10px]" />
                <SoftBadge label={model.entry.model_source === "discovered" ? (zh ? "服务商发现" : "Discovered") : (zh ? "手动配置" : "Manual")} className="h-5 rounded-md px-2 text-[10px]" />
                {discoveryInfo ? <SoftBadge tone={statusTone} label={discoveryStatusLabel(discoveryInfo.status, zh)} className="h-5 rounded-md px-2 text-[10px]" /> : null}
                {modelCapabilityObservations.slice(0, 3).map((entry) => <SoftBadge key={`${entry.key}/${entry.capability}`} tone={entry.status === "supported" ? "success" : entry.status === "unsupported" ? "warn" : "neutral"} label={`${capabilityLabel(entry.capability, zh)} · ${capabilityStatusLabel(entry.status, zh)}`} className="h-5 max-w-[150px] truncate rounded-md px-2 text-[10px]" />)}
              </div>
              <div className="mt-auto grid grid-cols-2 gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
                <AccountSourceSummary label={zh ? "发现来源" : "Discovered by"} count={sourceAccountLabels.length} emptyLabel={zh ? "暂无已知来源账号" : "No known source account"} accountLabels={sourceAccountLabels} zh={zh} />
                <AccountSourceSummary label={zh ? "账号暴露" : "Exposed to"} count={exposedAccountLabels.length} emptyLabel={zh ? "未暴露到账号" : "Not exposed to any account"} accountLabels={exposedAccountLabels} zh={zh} />
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                  <ModelTestButton
                    bridge={bridge}
                    language={language}
                    request={testAccount ? {
                      envName: testAccount.envName,
                      accountName: testAccount.name,
                      model: model.entry.slug,
                      modelId: model.id,
                      ...(discoveryInfo?.upstreamModelId || fallbackUpstreamModel
                        ? { upstreamModel: discoveryInfo?.upstreamModelId ?? fallbackUpstreamModel }
                        : {}),
                    } : undefined}
                  />
                  <Button size="sm" variant="ghost" onClick={() => openEditor(model)}><Pencil className="size-3.5" />{zh ? "编辑" : "Edit"}</Button>
                  <IconActionButton icon={<Trash2 className="size-3.5" />} label={zh ? "删除" : "Delete"} onClick={() => openDelete(model)} tone="danger" />
                </div>
              </div>
            </ListCard>
          );
          }) : <ListCard className="col-span-full flex min-h-[150px] items-center justify-center text-[13px] font-medium text-slate-400">{zh ? "没有匹配的模型" : "No matching models"}</ListCard>}
          </div>
        </ListStack>
      )}

      <SidePanel
        open={editorOpen}
        title={activeModel ? (zh ? "编辑模型" : "Edit model") : (zh ? "添加模型" : "Add model")}
        description={zh ? "表单填写核心字段，JSON 可编辑完整目录配置" : "Use the form for core fields or JSON for the complete catalog entry"}
        onClose={() => setEditorOpen(false)}
        closeLabel={zh ? "关闭" : "Close"}
        scrollable={false}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-1">
            <button type="button" onClick={() => changeMode("form")} aria-pressed={mode === "form"} className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[12px] ${mode === "form" ? "ui-selected-control" : "border-transparent text-slate-500"}`}><FilePenLine className="size-3.5" />{zh ? "表单" : "Form"}</button>
            <button type="button" onClick={() => changeMode("json")} aria-pressed={mode === "json"} className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[12px] ${mode === "json" ? "ui-selected-control" : "border-transparent text-slate-500"}`}><Braces className="size-3.5" />JSON</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {mode === "form" ? (
              <ModelCatalogForm value={draft} language={language} onChange={updateDraft} />
            ) : (
              <Field label="model-catalogs.json"><Textarea className="min-h-[420px] font-mono text-[12px] leading-5" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} /></Field>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>{zh ? "取消" : "Cancel"}</Button>
            <Button onClick={() => void saveModel()} disabled={busy}><Save className="size-4" />{zh ? "保存" : "Save"}</Button>
          </div>
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
