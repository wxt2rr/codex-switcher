import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  AlertTriangle,
  FileCode2,
  PackageCheck,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";

import { ConfirmDialog, ProgressDialog, SidePanel } from "../components/admin-primitives";
import { ListCard, ListLoadingState, ListPageFrame, ListPageHeader, ListStack, SoftBadge } from "../components/account-list-primitives";
import { Field, Input, Select } from "../components/form-primitives";
import { Button } from "../components/ui/button";
import type { DesktopBridge, ProviderPluginDiagnostic, ProviderPluginInstallRequest, ProviderPluginMarketEntry, ProviderPluginSnapshot } from "../bridge";
import type { UiLanguage } from "../i18n";
import { cn } from "../lib/utils";

type PluginTab = "installed" | "market";
type InstallSource = "local" | "npm" | "git";
type PluginInstallTarget = Pick<ProviderPluginMarketEntry, "id" | "name" | "version">;
type PluginInstallDialogState =
  | { phase: "running"; target: PluginInstallTarget; step: number; startedAt: number }
  | { phase: "success"; target: PluginInstallTarget; result: ProviderPluginSnapshot; elapsedMs: number }
  | { phase: "error"; target: PluginInstallTarget; error: string };

const pluginInstallSteps = [
  { zh: "准备安装", en: "Preparing installation" },
  { zh: "下载并解包插件", en: "Downloading and unpacking the plugin" },
  { zh: "校验插件文件", en: "Verifying plugin files" },
  { zh: "启动插件进程", en: "Starting the plugin process" },
] as const;

export function PluginsPage({
  bridge,
  language,
  onSuccess,
  onError,
}: {
  bridge: DesktopBridge;
  language: UiLanguage;
  onSuccess: (message: string) => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const [tab, setTab] = useState<PluginTab>("installed");
  const [query, setQuery] = useState("");
  const [installed, setInstalled] = useState<ProviderPluginSnapshot[]>([]);
  const [market, setMarket] = useState<ProviderPluginMarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [selected, setSelected] = useState<ProviderPluginSnapshot>();
  const [pendingInstall, setPendingInstall] = useState<ProviderPluginMarketEntry>();
  const [installDialog, setInstallDialog] = useState<PluginInstallDialogState>();
  const [pendingAction, setPendingAction] = useState<{ kind: "remove" | "rollback"; plugin: ProviderPluginSnapshot }>();
  const [localOpen, setLocalOpen] = useState(false);
  const [source, setSource] = useState<InstallSource>("local");
  const [sourceValue, setSourceValue] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [manifestJson, setManifestJson] = useState("");
  const [marketUrl, setMarketUrl] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [nextInstalled, nextMarket] = await Promise.all([
        bridge.loadProviderPluginSnapshot(),
        bridge.loadProviderPluginMarket(),
      ]);
      setInstalled(nextInstalled);
      setMarket(nextMarket);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (installDialog?.phase !== "running") return;
    const timer = window.setInterval(() => {
      setInstallDialog((current) => {
        if (!current || current.phase !== "running") return current;
        return { ...current, step: Math.min(current.step + 1, pluginInstallSteps.length - 1) };
      });
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [installDialog?.phase]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredInstalled = useMemo(() => installed.filter((plugin) =>
    !normalizedQuery || `${plugin.id} ${plugin.name} ${plugin.description ?? ""} ${plugin.provider?.displayName ?? ""}`.toLowerCase().includes(normalizedQuery)),
  [installed, normalizedQuery]);
  const filteredMarket = useMemo(() => market.filter((plugin) =>
    !normalizedQuery || `${plugin.id} ${plugin.name} ${plugin.description ?? ""}`.toLowerCase().includes(normalizedQuery)),
  [market, normalizedQuery]);
  const latestMarketById = useMemo(() => {
    const result = new Map<string, ProviderPluginMarketEntry>();
    for (const entry of market) {
      const current = result.get(entry.id);
      if (!current || comparePluginVersions(entry.version, current.version) > 0) result.set(entry.id, entry);
    }
    return result;
  }, [market]);

  async function withBusy(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try { await action(); } catch (error) { onError(error); } finally { setBusyId(undefined); }
  }

  async function refreshMarket() {
    if (!marketUrl.trim()) { await load(); return; }
    await withBusy("market", async () => {
      const next = await bridge.refreshProviderPluginMarket(marketUrl.trim());
      setMarket(next);
      onSuccess(zh ? "插件市场已刷新" : "Plugin market refreshed");
    });
  }

  async function installMarketPlugin(plugin: ProviderPluginMarketEntry) {
    if (!plugin.source) {
      onError(new Error(zh ? "该市场条目没有明确的安装来源" : "This market entry has no explicit install source"));
      return;
    }
    setPendingInstall(undefined);
    await runPluginInstall(
      { id: plugin.id, name: plugin.name, version: plugin.version },
      () => bridge.installProviderPluginFromMarket({ id: plugin.id, version: plugin.version }),
    );
  }

  async function installLocalPlugin() {
    if (!sourceValue.trim()) throw new Error(zh ? "请填写安装来源" : "Install source is required");
    if (source === "git" && !gitRef.trim()) throw new Error(zh ? "Git 插件必须填写固定 Tag 或 Commit" : "Git plugins require a pinned tag or commit");
    let manifest: ProviderPluginInstallRequest["manifest"];
    try {
      manifest = JSON.parse(manifestJson) as ProviderPluginInstallRequest["manifest"];
    } catch {
      throw new Error(zh ? "Manifest JSON 无效" : "Manifest JSON is invalid");
    }
    const installSource: ProviderPluginInstallRequest["source"] = source === "local"
      ? { kind: "local", path: sourceValue.trim() }
      : source === "npm"
        ? { kind: "npm", spec: sourceValue.trim() }
        : { kind: "git", url: sourceValue.trim(), ref: gitRef.trim() };
    setLocalOpen(false);
    await runPluginInstall(
      { id: manifest.id, name: manifest.name, version: manifest.version },
      () => bridge.installProviderPlugin({ manifest, source: installSource }),
    );
  }

  async function runPluginInstall(target: PluginInstallTarget, task: () => Promise<ProviderPluginSnapshot>) {
    const startedAt = Date.now();
    setBusyId(target.id);
    setInstallDialog({ phase: "running", target, step: 0, startedAt });
    try {
      const result = await task();
      setTab("installed");
      await load();
      setInstallDialog({ phase: "success", target, result, elapsedMs: Date.now() - startedAt });
    } catch (error) {
      setInstallDialog({
        phase: "error",
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(undefined);
    }
  }

  async function togglePlugin(plugin: ProviderPluginSnapshot) {
    await withBusy(plugin.id, async () => {
      if (plugin.active) await bridge.deactivateProviderPlugin(plugin.id);
      else await bridge.activateProviderPlugin(plugin.id);
      await load();
      setSelected((current) => current?.id === plugin.id ? undefined : current);
      onSuccess(plugin.active ? (zh ? "插件已停用" : "Plugin deactivated") : (zh ? "插件已启用" : "Plugin activated"));
    });
  }

  async function confirmAction() {
    if (!pendingAction) return;
    const { kind, plugin } = pendingAction;
    await withBusy(plugin.id, async () => {
      if (kind === "remove") await bridge.removeProviderPlugin(plugin.id);
      else await bridge.rollbackProviderPlugin(plugin.id);
      setPendingAction(undefined);
      setSelected(undefined);
      await load();
      onSuccess(kind === "remove" ? (zh ? "插件已卸载" : "Plugin removed") : (zh ? "插件已回滚" : "Plugin rolled back"));
    });
  }

  return (
    <ListPageFrame>
      <ListPageHeader
        title={zh ? "插件" : "Plugins"}
        subtitle={zh ? "扩展服务商、网关中间件和模型能力；每个插件都在独立进程和权限边界内运行。" : "Extend providers, gateway middleware, and model capabilities inside an isolated permission boundary."}
        search={query}
        searchPlaceholder={zh ? "搜索插件、服务商或能力" : "Search plugins, providers, or capabilities"}
        onSearchChange={setQuery}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="hidden text-[11px] text-slate-400 xl:inline">{(tab === "installed" ? filteredInstalled.length : filteredMarket.length)} / {tab === "installed" ? installed.length : market.length}</span>
            <Button size="sm" variant="outline" onClick={() => setLocalOpen(true)}>
              <FileCode2 className="size-3.5" />{zh ? "本地安装" : "Install"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refreshMarket()} disabled={busyId === "market"}>
              <RefreshCw className={cn("size-3.5", busyId === "market" && "animate-spin")} />{zh ? "刷新市场" : "Refresh market"}
            </Button>
          </div>
        )}
      />

      <div className="flex items-center justify-between gap-3" role="tablist">
        <div className="inline-flex items-center gap-1 rounded-lg bg-[#eef1f5] p-1 dark:bg-[#1b2129]">
          {(["installed", "market"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}
              className={cn("rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors", tab === item ? "bg-white text-neutral-900 shadow-sm dark:bg-[#2a333f] dark:text-white" : "text-slate-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white")}>
              {item === "installed" ? (zh ? "已安装" : "Installed") : (zh ? "插件市场" : "Market")}
            </button>
          ))}
        </div>
        {tab === "market" ? (
          <div className="hidden items-center gap-2 md:flex">
            <Input value={marketUrl} onChange={(event) => setMarketUrl(event.target.value)} placeholder={zh ? "市场索引 URL（可选）" : "Market index URL (optional)"} className="h-7 w-[250px] rounded-lg bg-white/70 text-[11px] dark:bg-[#222a34]" />
          </div>
        ) : null}
      </div>

      {loading ? <ListLoadingState rows={4} /> : tab === "installed" ? (
        <ListStack>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredInstalled.length ? filteredInstalled.map((plugin) => (
            <InstalledPluginCard key={plugin.id} plugin={plugin} zh={zh} busy={busyId === plugin.id}
              update={latestMarketById.get(plugin.id) && comparePluginVersions(latestMarketById.get(plugin.id)!.version, plugin.version) > 0 ? latestMarketById.get(plugin.id) : undefined}
              onToggle={() => void togglePlugin(plugin)} onSelect={() => setSelected(plugin)} onRollback={() => setPendingAction({ kind: "rollback", plugin })} onRemove={() => setPendingAction({ kind: "remove", plugin })} onUpdate={(entry) => setPendingInstall(entry)} />
          )) : <div className="col-span-full"><EmptyState label={zh ? "还没有安装插件" : "No plugins installed"} /></div>}
          </div>
        </ListStack>
      ) : (
        <ListStack>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredMarket.length ? filteredMarket.map((plugin) => (
            <MarketPluginCard key={`${plugin.id}@${plugin.version}`} plugin={plugin} zh={zh} busy={busyId === plugin.id} onInstall={() => setPendingInstall(plugin)} onSelect={() => setSelected({ ...plugin, active: false, permissions: plugin.permissions, kind: plugin.kind })} />
          )) : <div className="col-span-full"><EmptyState label={zh ? "市场为空，请先刷新索引" : "The market is empty; refresh an index first"} /></div>}
          </div>
        </ListStack>
      )}

      <SidePanel open={Boolean(selected)} title={selected ? `${zh ? "插件详情 · " : "Plugin details · "}${selected.name}` : ""} description={zh ? "查看能力、权限、信任状态和运行端点。插件的账号与模型仍由账号/模型页面统一管理。" : "Review capabilities, permissions, trust, and endpoints. Accounts and model exposure remain managed by Accounts and Models."} onClose={() => setSelected(undefined)} closeLabel={zh ? "关闭" : "Close"}>
        {selected ? <PluginDetails bridge={bridge} plugin={selected} zh={zh} onToggle={() => void togglePlugin(selected)} onRollback={() => setPendingAction({ kind: "rollback", plugin: selected })} onRemove={() => setPendingAction({ kind: "remove", plugin: selected })} onSuccess={onSuccess} onError={onError} /> : null}
      </SidePanel>

      <SidePanel open={localOpen} title={zh ? "安装插件" : "Install plugin"} description={zh ? "安装前会校验 Manifest、路径安全、校验和与签名；本地插件默认标记为本地信任。" : "Manifest, path safety, checksum, and signatures are verified before activation; local plugins are marked local trust by default."} onClose={() => setLocalOpen(false)} closeLabel={zh ? "关闭" : "Close"}>
        <div className="grid gap-4">
          <Field label={zh ? "来源类型" : "Source type"}>
            <Select value={source} onValueChange={(value) => setSource(value as InstallSource)} items={[{ value: "local", label: zh ? "本地目录" : "Local directory" }, { value: "npm", label: "npm" }, { value: "git", label: "Git" }]} openOnHover={false} />
          </Field>
          <Field label={source === "local" ? (zh ? "插件目录" : "Plugin directory") : source === "npm" ? "npm spec" : "Git URL"}>
            <Input value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder={source === "local" ? "/path/to/plugin" : source === "npm" ? "@scope/plugin" : "https://github.com/..."} />
          </Field>
          {source === "git" ? <Field label={zh ? "固定版本（Tag / Commit）" : "Pinned ref (tag / commit)"} hint={zh ? "Git 插件必须固定版本，避免远端分支漂移导致供应链风险。" : "Git plugins must pin a tag or commit to avoid drifting remote branches."}>
            <Input value={gitRef} onChange={(event) => setGitRef(event.target.value)} placeholder="v1.0.0 or 0123456" />
          </Field> : null}
          <Field label="plugin.json" hint={zh ? "Manifest 必须声明 provider 或 middleware 权限；不要把密钥放进插件目录。" : "The manifest must declare provider or middleware permission; never put secrets in the plugin directory."}>
            <textarea value={manifestJson} onChange={(event) => setManifestJson(event.target.value)} className="min-h-[220px] w-full rounded-lg border border-transparent bg-[#f1f4f8] p-3 font-mono text-[11px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:bg-[#19212b]" placeholder={'{\n  "id": "my-plugin",\n  "name": "My plugin",\n  "version": "1.0.0",\n  "apiVersion": 2,\n  "entry": "plugin.mjs",\n  "permissions": ["provider"]\n}'} />
          </Field>
          <Button onClick={() => void installLocalPlugin()} disabled={Boolean(busyId)}><Download className="mr-1.5 size-4" />{zh ? "校验并安装" : "Verify and install"}</Button>
        </div>
      </SidePanel>

      <PluginInstallDialog
        state={installDialog}
        zh={zh}
        onClose={() => setInstallDialog(undefined)}
        onSuccess={onSuccess}
      />

      <ConfirmDialog open={Boolean(pendingInstall)} title={pendingInstall ? (zh ? `安装 ${pendingInstall.name}？` : `Install ${pendingInstall.name}?`) : ""} description={zh ? "插件将在隔离进程中运行。请确认来源、信任级别和权限后再安装。" : "The plugin will run in an isolated process. Review its source, trust level, and permissions before installing."} impact={pendingInstall ? <PermissionSummary plugin={pendingInstall} zh={zh} /> : null} confirmLabel={zh ? "确认安装" : "Install"} cancelLabel={zh ? "取消" : "Cancel"} tone="default" onConfirm={() => pendingInstall && void installMarketPlugin(pendingInstall)} onCancel={() => setPendingInstall(undefined)} />
      <ConfirmDialog open={Boolean(pendingAction)} title={pendingAction ? (pendingAction.kind === "remove" ? (zh ? `卸载 ${pendingAction.plugin.name}？` : `Remove ${pendingAction.plugin.name}?`) : (zh ? `回滚 ${pendingAction.plugin.name}？` : `Roll back ${pendingAction.plugin.name}?`)) : ""} description={pendingAction?.kind === "remove" ? (zh ? "卸载会停止插件并删除已安装版本，但不会删除账号凭据。" : "Removing stops the plugin and deletes installed versions; account credentials are not deleted.") : (zh ? "回滚会切换到上一个已验证版本。" : "Rollback switches to the last verified version.")} confirmLabel={pendingAction?.kind === "remove" ? (zh ? "卸载" : "Remove") : (zh ? "回滚" : "Roll back")} cancelLabel={zh ? "取消" : "Cancel"} onConfirm={() => void confirmAction()} onCancel={() => setPendingAction(undefined)} />
    </ListPageFrame>
  );
}

function PluginInstallDialog({
  state,
  zh,
  onClose,
  onSuccess,
}: {
  state?: PluginInstallDialogState;
  zh: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  if (!state) return null;
  return (
    <ProgressDialog
      open
      phase={state.phase}
      title={state.phase === "running"
        ? (zh ? `正在安装 ${state.target.name}` : `Installing ${state.target.name}`)
        : state.phase === "success"
          ? (zh ? "插件安装完成" : "Plugin installed")
          : (zh ? "插件安装失败" : "Plugin installation failed")}
      confirmLabel={zh ? "确定" : "OK"}
      showRunningIcon={false}
      showBusyLabel={false}
      onConfirm={() => {
        onClose();
        if (state.phase === "success") onSuccess(zh ? `${state.target.name} 已安装` : `${state.target.name} installed`);
      }}
    >
      {state.phase === "running" ? (
        <div className="space-y-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-800 dark:text-white">
                {pluginInstallSteps[state.step]?.[zh ? "zh" : "en"]}
              </div>
              <div className="mt-1 truncate text-[12px] text-slate-500">{state.target.id}@{state.target.version}</div>
            </div>
            <span className="ml-auto shrink-0 text-[12px] font-medium text-slate-500">{pluginInstallProgressPercent(state.step)}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={zh ? "插件安装进度" : "Plugin installation progress"}
            aria-valuetext={pluginInstallSteps[state.step]?.[zh ? "zh" : "en"]}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pluginInstallProgressPercent(state.step)}
            className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
              style={{ width: `${pluginInstallProgressPercent(state.step)}%` }}
            />
          </div>
          <p className="text-[12px] leading-5 text-slate-500">
            {zh ? "正在完成来源下载、文件校验和隔离进程启动，请稍候。" : "The source is being downloaded, verified, and started in an isolated process. Please wait."}
          </p>
        </div>
      ) : state.phase === "success" ? (
        <div className="space-y-4" aria-live="polite">
          <div className="flex items-start gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{zh ? "插件已完成校验并启动，可以在“已安装”中管理。" : "The plugin was verified and started. Manage it from Installed."}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-lg bg-white px-3 py-2.5 dark:bg-slate-900"><div className="text-slate-400">{zh ? "版本" : "Version"}</div><div className="mt-1 font-medium text-neutral-800 dark:text-white">v{state.result.version}</div></div>
            <div className="rounded-lg bg-white px-3 py-2.5 dark:bg-slate-900"><div className="text-slate-400">{zh ? "耗时" : "Elapsed"}</div><div className="mt-1 font-medium text-neutral-800 dark:text-white">{formatElapsed(state.elapsedMs)}</div></div>
            <div className="col-span-2 rounded-lg bg-white px-3 py-2.5 dark:bg-slate-900"><div className="text-slate-400">{zh ? "运行状态" : "Runtime"}</div><div className="mt-1 font-medium text-emerald-700 dark:text-emerald-400">{state.result.active ? (zh ? "运行中" : "Active") : (zh ? "已安装，待启用" : "Installed, inactive")}</div></div>
          </div>
        </div>
      ) : (
        <div className="space-y-4" aria-live="assertive">
          <div className="flex items-start gap-2 text-sm font-medium text-rose-700 dark:text-rose-400">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{zh ? "安装未完成，原有插件版本已保留。" : "Installation did not complete. The previous plugin version was preserved."}</span>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-rose-50 px-3 py-2.5 font-mono text-[11px] leading-5 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">{state.error}</pre>
          <p className="text-[12px] leading-5 text-slate-500">{zh ? "关闭提示后可以重新安装；如果问题持续，请查看插件详情中的运行诊断。" : "Close this message and try again. If it persists, review Runtime diagnostics in the plugin details."}</p>
        </div>
      )}
    </ProgressDialog>
  );
}

function pluginInstallProgressPercent(step: number): number {
  const completedStep = Math.max(0, Math.min(step, pluginInstallSteps.length - 1));
  return Math.min(90, Math.max(10, Math.round(((completedStep + 1) / pluginInstallSteps.length) * 90)));
}

function InstalledPluginCard({ plugin, update, zh, busy, onToggle, onSelect, onRollback, onRemove, onUpdate }: { plugin: ProviderPluginSnapshot; update?: ProviderPluginMarketEntry; zh: boolean; busy: boolean; onToggle: () => void; onSelect: () => void; onRollback: () => void; onRemove: () => void; onUpdate: (entry: ProviderPluginMarketEntry) => void }) {
  return <ListCard className="group flex min-h-[208px] cursor-pointer flex-col gap-3 p-4 transition-[border-color,box-shadow] hover:border-emerald-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]" onClick={onSelect}>
    <div className="flex min-w-0 items-start gap-3">
      <PluginIcon plugin={plugin} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[14px] font-semibold text-neutral-900 dark:text-white">{plugin.name}</h3><SoftBadge label={`v${plugin.version}`} /><SoftBadge label={trustLabel(plugin.trust, zh)} tone={plugin.trust === "official" || plugin.trust === "verified" ? "success" : "neutral"} /></div>
        <div className="mt-1 truncate font-mono text-[11px] text-slate-400">{plugin.id}</div>
      </div>
    </div>
    {plugin.description ? <p className="line-clamp-2 text-[12px] leading-5 text-slate-500">{plugin.description}</p> : <p className="text-[12px] text-slate-400">{zh ? "暂无插件描述" : "No description"}</p>}
    <div className="flex flex-wrap gap-1.5">
      {plugin.kind?.includes("provider") || plugin.permissions.includes("provider") ? <SoftBadge label="Provider" /> : null}
      {plugin.kind?.includes("middleware") || plugin.permissions.includes("middleware") ? <SoftBadge label="Middleware" /> : null}
      {plugin.error ? <SoftBadge label={zh ? "启动失败" : "Activation failed"} tone="warn" /> : null}
    </div>
    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]" onClick={(event) => event.stopPropagation()}>
      <Button size="sm" variant="ghost" onClick={onSelect}>{zh ? "详情" : "Details"}</Button>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {update?.source ? <Button size="sm" variant="outline" onClick={() => onUpdate(update)} disabled={busy}><Download className="size-3.5" />{zh ? "更新" : "Update"}</Button> : null}
        <Button size="sm" variant={plugin.active ? "outline" : "default"} onClick={onToggle} disabled={busy}>{plugin.active ? <><CheckCircle2 className="size-3.5 text-emerald-600" />{zh ? "运行中" : "Active"}</> : <><XCircle className="size-3.5" />{zh ? "已停用" : "Inactive"}</>}</Button>
        <Button size="sm" variant="ghost" className="px-2 text-slate-500" title={zh ? "回滚" : "Rollback"} aria-label={zh ? "回滚" : "Rollback"} onClick={onRollback}><RotateCcw className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" className="px-2 text-rose-600 hover:text-rose-700" title={zh ? "卸载" : "Remove"} aria-label={zh ? "卸载" : "Remove"} onClick={onRemove}><Trash2 className="size-3.5" /></Button>
      </div>
    </div>
  </ListCard>;
}

function MarketPluginCard({ plugin, zh, busy, onInstall, onSelect }: { plugin: ProviderPluginMarketEntry; zh: boolean; busy: boolean; onInstall: () => void; onSelect: () => void }) {
  return <ListCard className="flex min-h-[190px] cursor-pointer flex-col gap-3 p-4 transition-[border-color,box-shadow] hover:border-emerald-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]" onClick={onSelect}>
    <div className="flex min-w-0 items-start gap-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-[#202733]"><PackageCheck className="size-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[14px] font-semibold text-neutral-900 dark:text-white">{plugin.name}</h3><SoftBadge label={`v${plugin.version}`} /><SoftBadge label={trustLabel(plugin.trust, zh)} tone={plugin.trust === "official" || plugin.trust === "verified" ? "success" : "neutral"} /></div><div className="mt-1 truncate font-mono text-[11px] text-slate-400">{plugin.id}</div></div></div>
    <p className="line-clamp-2 text-[12px] leading-5 text-slate-500">{plugin.description ?? (zh ? "暂无插件描述" : "No description")}</p>
    <div className="flex flex-wrap gap-1.5">{plugin.permissions.map((permission) => <SoftBadge key={permission} label={permission} />)}</div>
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]" onClick={(event) => event.stopPropagation()}><Button size="sm" variant="ghost" onClick={onSelect}>{zh ? "详情" : "Details"}</Button><Button size="sm" onClick={onInstall} disabled={busy || !plugin.source}><Download className="size-3.5" />{zh ? "安装" : "Install"}</Button></div>
  </ListCard>;
}

function PluginDetails({ bridge, plugin, zh, onToggle, onRollback, onRemove, onSuccess, onError }: { bridge: DesktopBridge; plugin: ProviderPluginSnapshot; zh: boolean; onToggle: () => void; onRollback: () => void; onRemove: () => void; onSuccess: (message: string) => void; onError: (error: unknown) => void }) {
  const schema = pluginSettingsSchema(plugin.settingsSchema);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [diagnostics, setDiagnostics] = useState<ProviderPluginDiagnostic[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void bridge.loadProviderPluginDiagnostics(plugin.id).then((entries) => { if (active) setDiagnostics(entries); }).catch(onError);
    if (!schema) { setSettings({}); return () => { active = false; }; }
    void bridge.loadProviderPluginSettings(plugin.id).then((snapshot) => { if (active) setSettings(snapshot.values); }).catch(onError);
    return () => { active = false; };
  }, [bridge, plugin.id, schema, onError]);
  async function saveSettings() {
    setSaving(true);
    try {
      await bridge.saveProviderPluginSettings(plugin.id, settings);
      onSuccess(zh ? "插件设置已保存" : "Plugin settings saved");
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  return <div className="grid gap-4"><div className="flex items-center gap-3 rounded-xl border border-black/[0.05] bg-slate-50 p-3 dark:border-white/[0.06] dark:bg-[#1a2029]"><PluginIcon plugin={plugin} /><div className="min-w-0"><div className="text-sm font-semibold text-neutral-900 dark:text-white">{plugin.name}</div><div className="font-mono text-[11px] text-slate-400">{plugin.id}@{plugin.version}</div></div></div><PermissionSummary plugin={plugin} zh={zh} /><div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600 dark:bg-[#1a2029] dark:text-slate-300"><DetailRow label={zh ? "状态" : "Status"} value={plugin.active ? (zh ? "运行中" : "Active") : (zh ? "已停用" : "Inactive")} /><DetailRow label={zh ? "Provider" : "Provider"} value={plugin.provider?.displayName ?? "—"} /><DetailRow label="Middleware" value={plugin.middleware ? `${plugin.middleware.hooks.join(", ")} · priority ${plugin.middleware.priority}` : "—"} /><DetailRow label={zh ? "错误" : "Error"} value={plugin.error ?? "—"} /></div><div className="grid gap-2 rounded-xl border border-black/[0.05] bg-white p-3 dark:border-white/[0.06] dark:bg-[#141a22]"><div className="flex items-center gap-2 text-[12px] font-semibold text-neutral-800 dark:text-white"><AlertTriangle className="size-3.5 text-amber-600" />{zh ? "运行诊断" : "Runtime diagnostics"}</div>{diagnostics.length ? <div className="max-h-44 space-y-2 overflow-auto">{diagnostics.slice(0, 12).map((entry, index) => <div key={`${entry.at}-${index}`} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] dark:bg-[#1a2029]"><div className="flex items-center justify-between gap-2"><span className={cn("font-medium", entry.level === "error" ? "text-rose-600" : "text-slate-500")}>{entry.phase}</span><time className="text-slate-400">{new Date(entry.at).toLocaleString()}</time></div><div className="mt-1 break-words text-slate-600 dark:text-slate-300">{entry.message}</div></div>)}</div> : <div className="text-[11px] text-slate-400">{zh ? "暂无诊断记录" : "No diagnostics recorded"}</div>}</div>{schema ? <div className="grid gap-3 rounded-xl border border-black/[0.05] bg-white p-3 dark:border-white/[0.06] dark:bg-[#141a22]"><div><div className="text-[12px] font-semibold text-neutral-800 dark:text-white">{zh ? "插件设置" : "Plugin settings"}</div><div className="mt-1 text-[11px] text-slate-500">{zh ? "设置按插件隔离保存；密钥字段加密存储且不会回显。" : "Settings are isolated per plugin; secret fields are encrypted and never echoed."}</div></div>{Object.entries(schema.properties).map(([key, property]) => <Field key={key} label={property.title} hint={property.description}>{property.type === "boolean" ? <label className="flex h-9 items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={settings[key] === true} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))} />{zh ? "启用" : "Enabled"}</label> : property.type === "select" ? <Select value={String(settings[key] ?? property.default ?? "")} onValueChange={(value) => setSettings((current) => ({ ...current, [key]: value }))} items={(property.options ?? []).map((option) => ({ value: option.value, label: option.label }))} /> : <Input type={property.secret ? "password" : property.type === "number" || property.type === "integer" ? "number" : "text"} value={String(settings[key] ?? "")} onChange={(event) => setSettings((current) => ({ ...current, [key]: property.type === "number" || property.type === "integer" ? Number(event.target.value) : event.target.value }))} placeholder={property.secret ? (zh ? "留空保持已保存的密钥" : "Leave empty to keep the saved secret") : undefined} />}</Field>)}<div className="flex justify-end"><Button onClick={() => void saveSettings()} disabled={saving}>{saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存设置" : "Save settings")}</Button></div></div> : null}{plugin.provider?.endpoints.length ? <div><div className="mb-2 text-[12px] font-semibold text-slate-500">{zh ? "服务端点" : "Endpoints"}</div><div className="grid gap-2">{plugin.provider.endpoints.map((endpoint) => <div key={`${endpoint.protocol}-${endpoint.baseUrl}`} className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-[#1a2029]"><span className="font-medium text-slate-700 dark:text-slate-200">{endpoint.protocol}</span><span className="ml-2 break-all">{endpoint.baseUrl}{endpoint.modelsPath}</span></div>)}</div></div> : null}{plugin.provider?.managementUrl ? <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"><span>{zh ? "账号管理控制台" : "Account management console"}</span><a className="font-medium underline underline-offset-2" href={plugin.provider.managementUrl} target="_blank" rel="noreferrer">{zh ? "打开控制台" : "Open console"}</a></div> : null}<div className="flex flex-wrap gap-2"><Button onClick={onToggle}>{plugin.active ? (zh ? "停用插件" : "Deactivate") : (zh ? "启用插件" : "Activate")}</Button><Button variant="outline" onClick={onRollback}><RotateCcw className="mr-1.5 size-3.5" />{zh ? "回滚" : "Rollback"}</Button><Button variant="destructive" onClick={onRemove}><Trash2 className="mr-1.5 size-3.5" />{zh ? "卸载" : "Remove"}</Button></div></div>;
}

type PluginSettingProperty = { type: "string" | "number" | "integer" | "boolean" | "select"; title: string; description?: string; secret?: boolean; default?: string | number | boolean; options?: Array<{ label: string; value: string }> };
function pluginSettingsSchema(value: unknown): { properties: Record<string, PluginSettingProperty> } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const properties = (value as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  const normalized = Object.fromEntries(Object.entries(properties).filter(([, item]) => item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string" && typeof (item as { title?: unknown }).title === "string")) as Record<string, PluginSettingProperty>;
  return Object.keys(normalized).length ? { properties: normalized } : undefined;
}

function PermissionSummary({ plugin, zh }: { plugin: Pick<ProviderPluginSnapshot, "permissions" | "trust" | "kind">; zh: boolean }) {
  return <div className="rounded-xl border border-black/[0.05] bg-white p-3 dark:border-white/[0.06] dark:bg-[#141a22]"><div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-neutral-800 dark:text-white"><ShieldCheck className="size-4 text-emerald-600" />{zh ? "权限与信任" : "Permissions and trust"}</div><div className="flex flex-wrap gap-1.5">{plugin.permissions.map((permission) => <SoftBadge key={permission} label={permission} />)}<SoftBadge label={trustLabel(plugin.trust, zh)} tone={plugin.trust === "official" || plugin.trust === "verified" ? "success" : "neutral"} /></div></div>;
}

function PluginIcon({ plugin }: { plugin: Pick<ProviderPluginSnapshot, "icon" | "name"> }) {
  return plugin.icon ? <img src={plugin.icon} alt="" className="size-8 shrink-0 rounded-lg object-contain" /> : <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-[#202733]"><Puzzle className="size-4" /></div>;
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span>{label}</span><span className="max-w-[280px] break-words text-right font-medium text-slate-700 dark:text-slate-200">{value}</span></div>; }
function EmptyState({ label }: { label: string }) { return <div className="rounded-[14px] border border-dashed border-black/[0.08] bg-white px-5 py-12 text-center text-[13px] text-slate-400 dark:border-white/[0.08] dark:bg-[#141a22]">{label}</div>; }
function trustLabel(value: string | undefined, zh: boolean) { if (value === "official") return zh ? "官方" : "Official"; if (value === "verified") return zh ? "已验证" : "Verified"; if (value === "community") return zh ? "社区" : "Community"; return zh ? "本地" : "Local"; }

function comparePluginVersions(left: string, right: string): number {
  const normalize = (value: string) => value.trim().replace(/^v/i, "").split(/[+-]/, 1)[0].split(".").map((part) => Number.parseInt(part, 10)).map((part) => Number.isFinite(part) ? part : 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1_000) return "<1s";
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}
