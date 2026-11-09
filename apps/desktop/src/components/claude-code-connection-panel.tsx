import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, PlugZap, RefreshCw, RotateCcw, Trash2, Unplug } from "lucide-react";

import { ConfirmDialog, SidePanel } from "./admin-primitives";
import { SoftBadge } from "./account-list-primitives";
import { Field, Select } from "./form-primitives";
import { Button } from "./ui/button";
import type { ClaudeCodeConfigHistoryEntry, DesktopBridge } from "../bridge";
import type { ClaudeCodeConnectionState, ClaudeCodeSourceSummary } from "../desktop-model";
import type { UiLanguage } from "../i18n";
import { cn } from "../lib/utils";

export function ClaudeCodeConnectionPanel({
  bridge,
  language,
  open,
  onClose,
  initialEnvironmentName,
  onSuccess,
  onError,
}: {
  bridge: DesktopBridge;
  language: UiLanguage;
  open: boolean;
  onClose: () => void;
  initialEnvironmentName?: string;
  onSuccess?: (message: string) => void;
  onError?: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const [sources, setSources] = useState<ClaudeCodeSourceSummary[]>([]);
  const [connection, setConnection] = useState<ClaudeCodeConnectionState>({ connected: false, configPath: "~/.claude/settings.json" });
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<ClaudeCodeConfigHistoryEntry[]>([]);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [authorizationConfirmOpen, setAuthorizationConfirmOpen] = useState(false);

  const selectedSource = useMemo(() => sources.find((source) => source.id === selectedSourceId), [sources, selectedSourceId]);
  const sourceItems = useMemo(() => sources.map((source) => ({
    value: source.id,
    label: source.kind === "environment_gateway"
      ? `${source.environmentName} · ${zh ? "环境网关" : "Environment gateway"}`
      : `${source.environmentName} · ${source.accountName ?? source.displayName}`,
  })), [sources, zh]);
  const modelItems = useMemo(() => selectedSource?.models.map((model) => ({ value: model.id, label: model.displayName })) ?? [], [selectedSource]);

  async function load() {
    setLoading(true);
    try {
      const [nextSources, nextConnection] = await Promise.all([bridge.listClaudeCodeSources(), bridge.getClaudeCodeConnection()]);
      setSources(nextSources);
      setConnection(nextConnection);
      const preferred = nextConnection.record?.sourceId
        ?? nextSources.find((source) => source.environmentName === initialEnvironmentName && source.state === "ready")?.id
        ?? nextSources.find((source) => source.state === "ready")?.id
        ?? nextSources[0]?.id
        ?? "";
      setSelectedSourceId(preferred);
      const currentModel = nextConnection.record?.modelId ?? nextSources.find((source) => source.id === preferred)?.models[0]?.id ?? "";
      setSelectedModelId(currentModel);
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setHistoryOpen(false);
      setHistorySelection([]);
      void load();
    }
  }, [open, initialEnvironmentName]);

  useEffect(() => {
    if (!selectedSource) return;
    setSelectedModelId((current) => selectedSource.models.some((model) => model.id === current) ? current : selectedSource.models[0]?.id ?? "");
  }, [selectedSource]);

  async function connect(cleanupAuthorization = false) {
    if (!selectedSourceId) return;
    setBusy(true);
    setAuthorizationConfirmOpen(false);
    try {
      const next = await bridge.connectClaudeCode({ sourceId: selectedSourceId, ...(selectedModelId ? { modelId: selectedModelId } : {}), ...(cleanupAuthorization ? { cleanupAuthorization: true } : {}) });
      setConnection(next);
      onSuccess?.(zh ? "Claude Code 已连接，重启 CLI 后生效" : "Claude Code connected; restart the CLI to apply it");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const next = await bridge.disconnectClaudeCode();
      setConnection(next);
      onSuccess?.(zh ? "Claude Code 已断开，原配置已恢复" : "Claude Code disconnected and the previous config was restored");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  async function diagnose() {
    setBusy(true);
    try {
      const result = await bridge.diagnoseClaudeCode();
      setSources(result.sources);
      setConnection(result);
      onSuccess?.(zh ? "连接诊断已刷新" : "Connection diagnostics refreshed");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  async function reapply() {
    setBusy(true);
    try {
      const next = await bridge.reapplyClaudeCode();
      setConnection(next);
      onSuccess?.(zh ? "Claude Code 配置已重新应用，请重启 CLI" : "Claude Code configuration reapplied; restart the CLI");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const raw = await bridge.listClaudeCodeConfigHistory();
      setHistoryEntries(JSON.parse(raw) as ClaudeCodeConfigHistoryEntry[]);
    } catch (error) {
      onError?.(error);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openHistory() {
    setHistorySelection([]);
    setHistoryOpen(true);
    await loadHistory();
  }

  async function restoreHistory(entryId: string) {
    setBusy(true);
    try {
      await bridge.restoreClaudeCodeConfigHistory(entryId);
      await Promise.all([load(), loadHistory()]);
      onSuccess?.(zh ? "Claude Code 配置已回滚，连接状态已重置，请重启 CLI" : "Claude Code configuration rolled back; reconnect state reset; restart the CLI");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistory() {
    if (!historySelection.length) return;
    setBusy(true);
    try {
      await bridge.deleteClaudeCodeConfigHistory(historySelection);
      setHistorySelection([]);
      await loadHistory();
      onSuccess?.(zh ? "历史配置已删除" : "Configuration history deleted");
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  const stateLabel = connection.connected
    ? zh ? "已连接" : "Connected"
    : zh ? "未连接" : "Not connected";
  const nonRemovableAuthorization = connection.authorization?.conflicts.filter((conflict) => !conflict.removable) ?? [];

  return (
    <SidePanel
      open={open}
      title={zh ? "Claude Code" : "Claude Code"}
      description={zh ? "为 Claude Code CLI 选择一个全局账号来源。密钥只在桌面主进程中解析。" : "Choose a global source for the Claude Code CLI. Secrets stay inside the desktop main process."}
      onClose={onClose}
      closeLabel={zh ? "关闭" : "Close"}
    >
      {historyOpen ? (
        <ClaudeCodeHistoryView
          zh={zh}
          loading={historyLoading}
          busy={busy}
          entries={historyEntries}
          selection={historySelection}
          onBack={() => setHistoryOpen(false)}
          onToggle={(entryId, checked) => setHistorySelection((current) => checked ? Array.from(new Set([...current, entryId])) : current.filter((id) => id !== entryId))}
          onRestore={(entryId) => void restoreHistory(entryId)}
          onDelete={() => void deleteHistory()}
        />
      ) : <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.05] bg-muted/50 px-3.5 py-3 dark:border-white/[0.07] dark:bg-[#1a2029]">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", connection.connected ? "bg-primary/10 text-primary" : "bg-accent text-muted-foreground")}>
              {connection.connected ? <CheckCircle2 className="size-4" /> : <PlugZap className="size-4" />}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-neutral-900 dark:text-white">{stateLabel}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={connection.configPath}>{connection.configPath}</div>
            </div>
          </div>
          <SoftBadge tone={connection.connected ? "success" : "neutral"} label={connection.connected ? (zh ? "Global Profile" : "Global Profile") : (zh ? "待配置" : "Setup required")} className="h-5 shrink-0 px-2 text-[10px]" />
        </div>

        {connection.authorization?.hasConflict ? (
          <div className="grid gap-2 rounded-xl border border-warm-200/80 bg-warm-50 px-3.5 py-3 text-[12px] text-warm-800 dark:border-warm-800/50 dark:bg-warm-950/25 dark:text-warm-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">{zh ? "检测到 Claude Code 授权冲突" : "Claude Code authorization conflict detected"}</div>
                <div className="mt-1 leading-5">{zh ? "当前存在 Claude.ai OAuth、外部授权变量或 apiKeyHelper；API Key 模式会产生不确定的认证结果。" : "A Claude.ai OAuth session, external auth variable, or apiKeyHelper is present; API-key mode would be ambiguous."}</div>
              </div>
            </div>
            <div className="grid gap-1 pl-5 text-[11px] text-warm-700 dark:text-warm-300">
              <div>{zh ? "检测到的授权来源：" : "Detected auth sources: "}{connection.authorization.detectedAuthSources.join(", ") || "—"}</div>
              <div>{zh ? "检测到的地址：" : "Detected endpoints: "}{connection.authorization.detectedEndpoints.join(", ") || "—"}</div>
              <div>{zh ? "冲突位置：" : "Conflict locations: "}{connection.authorization.conflicts.map((conflict) => conflict.path).join(", ")}</div>
            </div>
            {connection.authorization.canCleanup ? <div className="flex justify-end"><Button size="sm" variant="outline" className="border-warm-300/80 bg-transparent text-warm-800 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-100 dark:hover:bg-warm-900/40" onClick={() => setAuthorizationConfirmOpen(true)} disabled={busy}>{zh ? "备份并清理冲突授权" : "Back up and clean up"}</Button></div> : <div className="pl-5 text-[11px] font-medium">{zh ? `当前授权来自外部终端环境，请先在启动 Claude Code 的终端清理：${nonRemovableAuthorization.map((conflict) => conflict.kind).join("、")}。` : `The conflicting authorization comes from the shell environment. Unset these sources in the terminal that launches Claude Code: ${nonRemovableAuthorization.map((conflict) => conflict.kind).join(", ")}.`}</div>}
          </div>
        ) : null}

        {connection.record && (connection.drift !== "clean" || !connection.connected) ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-warm-200/80 bg-warm-50 px-3.5 py-3 text-[12px] text-warm-800 dark:border-warm-800/50 dark:bg-warm-950/25 dark:text-warm-200">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{connection.configPathChanged
                ? (zh ? "Claude Code 的配置目录已变化，请切回原目录后重新应用或回滚；当前目录不会被静默覆盖。" : "Claude Code's config directory changed. Switch back to the original directory before re-applying or restoring; the current directory will not be overwritten silently.")
                : !connection.connected
                ? (zh ? "当前来源已不可用，请选择其他来源重新连接。" : "The previous source is no longer available. Choose another source to reconnect.")
                : connection.drift === "missing"
                  ? (zh ? "Claude Code 配置文件不存在。" : "The Claude Code configuration file is missing.")
                  : (zh ? "Claude Code 配置已被外部修改。" : "The Claude Code configuration was changed outside Switcher.")}</span>
            </div>
            {connection.connected && connection.drift !== "clean" ? <Button size="sm" variant="outline" className="h-7 shrink-0 border-warm-300/80 bg-transparent px-2.5 text-[11px] text-warm-800 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-100 dark:hover:bg-warm-900/40" onClick={() => void reapply()} disabled={busy}>{zh ? "重新应用" : "Re-apply"}</Button> : null}
          </div>
        ) : null}

        <Field label={zh ? "连接来源" : "Connection source"} hint={zh ? "环境网关适合统一路由；API Key 账号直接使用 Anthropic Base URL。" : "Use an environment gateway for routing, or an API key account with an Anthropic base URL."}>
          <Select
            value={selectedSourceId}
            onValueChange={setSelectedSourceId}
            items={sourceItems}
            placeholder={loading ? (zh ? "加载来源…" : "Loading sources…") : (zh ? "选择来源" : "Select a source")}
            disabled={loading || busy || !sourceItems.length}
            openOnHover={false}
          />
        </Field>

        {selectedSource ? (
          <div className="grid gap-3 rounded-xl border border-black/[0.05] bg-white p-3.5 dark:border-white/[0.07] dark:bg-[#141a22]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-neutral-900 dark:text-white">{selectedSource.displayName}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{selectedSource.kind === "environment_gateway" ? (zh ? "由本地网关提供 Anthropic Messages 入口" : "Anthropic Messages endpoint provided by the local gateway") : (zh ? `${selectedSource.providerDisplayName ?? "Provider"} API Key 账号` : `${selectedSource.providerDisplayName ?? "Provider"} API key account`)}</div>
              </div>
              <SoftBadge tone={selectedSource.state === "ready" ? "success" : "warn"} label={selectedSource.state === "ready" ? (zh ? "可用" : "Ready") : selectedSource.state === "needs_gateway" ? (zh ? "需开启网关" : "Gateway off") : selectedSource.state === "needs_local_agent" ? (zh ? "需开启本地调用" : "Local calls off") : (zh ? "不可用" : "Unavailable")} className="h-5 shrink-0 px-2 text-[10px]" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg bg-muted/70 px-2.5 py-2 dark:bg-[#1a2029]"><div className="text-[11px] text-muted-foreground">Base URL</div><div className="mt-1 truncate font-mono text-[11px] text-neutral-700 dark:text-slate-200" title={selectedSource.baseUrl}>{selectedSource.baseUrl ?? "—"}</div></div>
              <div className="min-w-0 rounded-lg bg-muted/70 px-2.5 py-2 dark:bg-[#1a2029]"><div className="text-[11px] text-muted-foreground">API Key</div><div className="mt-1 truncate font-mono text-[11px] text-neutral-700 dark:text-slate-200">{selectedSource.apiKeyPreview ?? "—"}</div></div>
            </div>
            {selectedSource.reason ? <div className="flex items-start gap-2 rounded-lg bg-warm-50 px-2.5 py-2 text-[12px] text-warm-700 dark:bg-warm-950/30 dark:text-warm-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{selectedSource.reason}</span></div> : null}
          </div>
        ) : null}

        {selectedSource && modelItems.length ? <Field label={zh ? "默认模型（可选）" : "Default model (optional)"} hint={zh ? "只写入 Claude Code 的 ANTHROPIC_MODEL，不会修改环境路由。" : "Only sets ANTHROPIC_MODEL for Claude Code; environment routing remains unchanged."}><Select value={selectedModelId} onValueChange={setSelectedModelId} items={modelItems} disabled={busy} openOnHover={false} /></Field> : null}

        {!sources.length && !loading ? <div className="rounded-xl border border-dashed border-black/[0.08] bg-muted/40 px-3.5 py-4 text-[13px] text-muted-foreground dark:border-white/[0.1] dark:bg-[#1a2029]">{zh ? "暂无可用来源。请先在环境中开启网关和本地调用，或添加兼容 Anthropic 的 API Key 账号。" : "No eligible sources yet. Enable a gateway and local calls, or add an Anthropic-compatible API key account first."}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.07]">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void diagnose()} disabled={busy || loading}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />{zh ? "诊断" : "Diagnose"}</Button>
            <Button size="sm" variant="ghost" onClick={() => void openHistory()} disabled={busy}><RotateCcw className="size-3.5" />{zh ? "配置历史" : "Config history"}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection.connected ? <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}><Unplug className="size-3.5" />{zh ? "断开并恢复" : "Disconnect & restore"}</Button> : null}
            <Button size="sm" onClick={() => connection.authorization?.hasConflict ? setAuthorizationConfirmOpen(true) : void connect()} disabled={busy || loading || !selectedSource || selectedSource.state !== "ready" || Boolean(connection.authorization?.hasConflict && !connection.authorization.canCleanup)}><PlugZap className="size-3.5" />{connection.connected ? (zh ? "切换来源" : "Switch source") : (zh ? "连接 Claude Code" : "Connect Claude Code")}</Button>
          </div>
        </div>
      </div>}
      <ConfirmDialog
        open={authorizationConfirmOpen}
        title={zh ? "备份并清理 Claude Code 授权？" : "Back up and clean up Claude Code authorization?"}
        description={zh ? "会先把冲突文件保存到配置历史，再移除 Claude.ai OAuth、OAuth token、WIF 和 apiKeyHelper 等可管理冲突配置；不会删除 API Key。" : "The conflicting files will be saved to configuration history before removing managed Claude.ai OAuth, OAuth-token, WIF, and apiKeyHelper settings. The API key will be kept."}
        impact={connection.authorization ? <div className="grid gap-1 text-[12px] text-muted-foreground">{connection.authorization.conflicts.map((conflict) => <div key={`${conflict.kind}-${conflict.path}`}>{conflict.path}</div>)}</div> : null}
        confirmLabel={zh ? "备份并清理" : "Back up and clean up"}
        cancelLabel={zh ? "取消" : "Cancel"}
        tone="default"
        confirmDisabled={busy}
        onConfirm={() => void connect(true)}
        onCancel={() => setAuthorizationConfirmOpen(false)}
      />
    </SidePanel>
  );
}

function ClaudeCodeHistoryView({
  zh,
  loading,
  busy,
  entries,
  selection,
  onBack,
  onToggle,
  onRestore,
  onDelete,
}: {
  zh: boolean;
  loading: boolean;
  busy: boolean;
  entries: ClaudeCodeConfigHistoryEntry[];
  selection: string[];
  onBack: () => void;
  onToggle: (entryId: string, checked: boolean) => void;
  onRestore: (entryId: string) => void;
  onDelete: () => void;
}) {
  return <div className="grid gap-4">
    <div className="flex items-center justify-between gap-3">
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="size-3.5" />{zh ? "返回连接" : "Back to connection"}</Button>
      <SoftBadge tone="neutral" label={zh ? `${entries.length} 个快照` : `${entries.length} snapshots`} className="h-5 px-2 text-[10px]" />
    </div>
    <div className="text-[12px] leading-5 text-muted-foreground">{zh ? "每次覆盖 Claude Code 配置前都会保留一个快照。密钥值在历史预览中已脱敏，回滚由桌面主进程完成。" : "A snapshot is kept before each managed overwrite. Secrets are redacted in previews; rollback runs in the desktop main process."}</div>
    <div className="max-h-[500px] space-y-2.5 overflow-auto pr-1">
      {loading ? <div className="rounded-xl bg-muted px-4 py-10 text-center text-[13px] text-muted-foreground">{zh ? "加载历史…" : "Loading history…"}</div> : null}
      {!loading && !entries.length ? <div className="rounded-xl border border-dashed border-black/[0.08] bg-muted/40 px-4 py-10 text-center text-[13px] text-muted-foreground dark:border-white/[0.1] dark:bg-[#1a2029]">{zh ? "暂无配置历史" : "No configuration history"}</div> : null}
      {!loading ? entries.map((entry) => <div key={entry.id} className="rounded-xl border border-black/[0.05] bg-muted/40 p-3 dark:border-white/[0.07] dark:bg-[#1a2029]">
        <div className="flex items-start gap-2.5">
          <input type="checkbox" checked={selection.includes(entry.id)} onChange={(event) => onToggle(entry.id, event.target.checked)} className="mt-1" aria-label={zh ? "选择历史快照" : "Select history snapshot"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-neutral-900 dark:text-white">
              <span>{formatClaudeHistoryTimestamp(entry.createdAt)}</span>
              <SoftBadge tone={entry.source === "restore" ? "warn" : "neutral"} label={localizeClaudeHistorySource(entry.source, zh)} className="h-5 px-2 text-[10px]" />
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={entry.configPath}>{entry.configPath}</div>
            <pre className="mt-2 max-h-[170px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground dark:bg-[#141a22]">{entry.contentPreview || (zh ? "空配置" : "Empty configuration")}</pre>
          </div>
          <Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={() => onRestore(entry.id)} disabled={busy} title={zh ? "回滚到此版本" : "Roll back to this version"} aria-label={zh ? "回滚到此版本" : "Roll back to this version"}><RotateCcw className="size-3.5" /></Button>
        </div>
      </div>) : null}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.07]">
      <Button size="sm" variant="outline" onClick={onBack}>{zh ? "返回" : "Back"}</Button>
      <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy || !selection.length}><Trash2 className="size-3.5" />{zh ? `删除所选 (${selection.length})` : `Delete selected (${selection.length})`}</Button>
    </div>
  </div>;
}

function formatClaudeHistoryTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", "");
}

function localizeClaudeHistorySource(source: ClaudeCodeConfigHistoryEntry["source"], zh: boolean): string {
  if (source === "connect") return zh ? "连接前备份" : "Before connect";
  if (source === "disconnect") return zh ? "断开前备份" : "Before disconnect";
  if (source === "authorization_cleanup") return zh ? "授权冲突备份" : "Authorization conflict backup";
  if (source === "migration") return zh ? "已有快照" : "Existing snapshot";
  return zh ? "回滚前备份" : "Before rollback";
}
