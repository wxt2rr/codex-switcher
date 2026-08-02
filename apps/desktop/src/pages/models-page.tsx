import { useEffect, useMemo, useState } from "react";
import { Braces, FilePenLine, Link2, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";

import type { CustomModelRecord, DesktopBridge, ModelCatalogEntry, ModelCatalogSnapshot } from "../bridge";
import type { AccountSummary, OverviewPayload } from "../desktop-model";
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
import { Field, Input, Textarea } from "../components/form-primitives";
import { Button } from "../components/ui/button";
import {
  createDefaultModelEntry,
  parseSingleModelCatalog,
  serializeSingleModelCatalog,
} from "../model-editor";

export function ModelsPage({
  overview,
  language,
  bridge,
  onSuccess,
  onError,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  bridge: DesktopBridge;
  onSuccess: (message: string) => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const [snapshot, setSnapshot] = useState<ModelCatalogSnapshot>({ version: 1, models: [], accountBindings: {} });
  const [activeModelId, setActiveModelId] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [draft, setDraft] = useState<ModelCatalogEntry>(createDefaultModelEntry());
  const [jsonDraft, setJsonDraft] = useState(serializeSingleModelCatalog(createDefaultModelEntry()));
  const [bindingDraft, setBindingDraft] = useState<string[]>([]);
  const [bindingSearch, setBindingSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const activeModel = snapshot.models.find((model) => model.id === activeModelId);
  const visibleAccounts = useMemo(() => {
    const query = bindingSearch.trim().toLowerCase();
    return [...overview.accounts]
      .filter((account) => !query || `${account.envName}/${account.name}`.toLowerCase().includes(query))
      .sort((a, b) => `${a.envName}/${a.name}`.localeCompare(`${b.envName}/${b.name}`));
  }, [bindingSearch, overview.accounts]);
  const accountGroups = useMemo(() => {
    const groups = new Map<string, AccountSummary[]>();
    for (const account of visibleAccounts) {
      groups.set(account.envName, [...(groups.get(account.envName) ?? []), account]);
    }
    return groups;
  }, [visibleAccounts]);
  const knownAccountKeys = useMemo(
    () => new Set(overview.accounts.map((account) => `${account.envName}/${account.name}`)),
    [overview.accounts],
  );

  useEffect(() => {
    void bridge.listCustomModels().then(setSnapshot).catch(onError).finally(() => setLoading(false));
  }, []);

  function bindingCount(modelId: string): number {
    return Object.entries(snapshot.accountBindings)
      .filter(([accountKey, ids]) => knownAccountKeys.has(accountKey) && ids.includes(modelId))
      .length;
  }

  function openEditor(model?: CustomModelRecord) {
    const entry = model?.entry ?? createDefaultModelEntry();
    setActiveModelId(model?.id);
    setDraft(entry);
    setJsonDraft(serializeSingleModelCatalog(entry));
    setMode("form");
    setEditorOpen(true);
  }

  function openBindings(model: CustomModelRecord) {
    setActiveModelId(model.id);
    setBindingDraft(
      Object.entries(snapshot.accountBindings)
        .filter(([accountKey, modelIds]) => knownAccountKeys.has(accountKey) && modelIds.includes(model.id))
        .map(([accountKey]) => accountKey),
    );
    setBindingSearch("");
    setBindingOpen(true);
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

  async function saveBindings() {
    if (!activeModelId) return;
    setBusy(true);
    try {
      setSnapshot(await bridge.setModelAccountBindings(activeModelId, bindingDraft));
      setBindingOpen(false);
      onSuccess(zh ? "账号绑定已保存" : "Account bindings saved");
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
        subtitle={zh ? "维护自定义模型目录，并按账号控制可用模型" : "Manage custom model catalogs and account availability"}
        actions={<Button size="sm" onClick={() => openEditor()}><Plus className="size-4" />{zh ? "添加模型" : "Add model"}</Button>}
      />

      <ListStack>
        {loading ? <ListLoadingState rows={3} /> : snapshot.models.length === 0 ? (
          <ListCard className="flex min-h-[150px] items-center justify-center text-[13px] font-medium text-slate-400">
            {zh ? "暂无自定义模型" : "No custom models"}
          </ListCard>
        ) : snapshot.models.map((model) => {
          const count = bindingCount(model.id);
          return (
            <ListCard key={model.id} className="responsive-model-row responsive-record-row grid min-h-[86px] grid-cols-[minmax(220px,1fr)_minmax(160px,0.8fr)_auto] items-center gap-5">
              <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold text-neutral-950">{model.entry.display_name}</h3>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{model.entry.slug}</p>
              </div>
              <div><SoftBadge label={count ? (zh ? `${count} 个账号` : `${count} accounts`) : (zh ? "未绑定" : "Not bound")} /></div>
              <div className="responsive-actions">
                <IconActionButton icon={<Link2 className="size-4" />} label={zh ? "绑定账号" : "Bind accounts"} onClick={() => openBindings(model)} />
                <IconActionButton icon={<Pencil className="size-4" />} label={zh ? "编辑" : "Edit"} onClick={() => openEditor(model)} />
                <IconActionButton icon={<Trash2 className="size-4" />} label={zh ? "删除" : "Delete"} onClick={() => openDelete(model)} tone="danger" />
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

      <SidePanel
        open={bindingOpen}
        title={zh ? "绑定账号" : "Bind accounts"}
        description={activeModel ? `${activeModel.entry.display_name} · ${activeModel.entry.slug}` : undefined}
        onClose={() => setBindingOpen(false)}
        closeLabel={zh ? "关闭" : "Close"}
      >
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={bindingSearch} onChange={(event) => setBindingSearch(event.target.value)} placeholder={zh ? "搜索账号或环境" : "Search accounts or environments"} className="pl-9" />
        </div>
        <div className="max-h-[430px] space-y-5 overflow-auto pr-1">
          {[...accountGroups.entries()].map(([envName, accounts]) => (
            <section key={envName}>
              <div className="mb-2 text-[11px] font-semibold text-slate-400">{envName}</div>
              <div className="overflow-hidden rounded-lg border border-black/[0.06]">
                {accounts.map((account) => {
                  const key = `${account.envName}/${account.name}`;
                  const checked = bindingDraft.includes(key);
                  return (
                    <label key={key} className="flex cursor-pointer items-center justify-between border-b border-black/[0.05] px-4 py-3 last:border-b-0 hover:bg-neutral-50">
                      <span className="text-[13px] font-medium text-neutral-800">{account.name}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setBindingDraft((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))}
                        className="size-4 accent-[#34C759]"
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-[12px] text-slate-500">{zh ? `已选择 ${bindingDraft.length} 个账号` : `${bindingDraft.length} accounts selected`}</span>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setBindingOpen(false)}>{zh ? "取消" : "Cancel"}</Button><Button onClick={() => void saveBindings()} disabled={busy}>{zh ? "保存绑定" : "Save bindings"}</Button></div>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={deleteOpen}
        title={zh ? "删除模型" : "Delete model"}
        description={zh ? `删除后将从 ${activeModel ? bindingCount(activeModel.id) : 0} 个账号解绑，且无法恢复。` : `This removes the model from ${activeModel ? bindingCount(activeModel.id) : 0} accounts and cannot be undone.`}
        confirmLabel={zh ? "删除" : "Delete"}
        cancelLabel={zh ? "取消" : "Cancel"}
        onConfirm={() => void removeModel()}
        onCancel={() => setDeleteOpen(false)}
      />
    </ListPageFrame>
  );
}
