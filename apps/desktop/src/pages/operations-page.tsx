import { useEffect, useState } from "react";
import {
  Activity,
  FileSearch,
  RefreshCw,
  RotateCcw,
  Save,
  Wrench,
} from "lucide-react";
import {
  IconActionButton,
  ListCard,
  ListPageFrame,
  ListPageHeader,
  ListStack,
} from "../components/account-list-primitives";
import { Field, Input, Select, Textarea } from "../components/form-primitives";
import { ConfirmDialog, SidePanel } from "../components/admin-primitives";
import { getDesktopCopy } from "../desktop-copy";
import { localizeLogKind } from "../desktop-utils";
import type { UiLanguage } from "../i18n";
import { GatewayAdminStructuredEditor } from "./gateway-admin-editor";
import type { AppEnvironmentBadgeStatus, CliAutoResumeSettings, CliTerminalId, CliTerminalSettings, CodexToolStatus, DesktopAutoUpdateStatus, EnvHistoryRetentionSettings, GatewayAdminConfiguration, GatewayAdminEnvironment, GeneratedImageRecoveryStatus, LaunchAtLoginStatus, ProviderPluginInstallRequest, ProviderPluginMarketEntry, ProviderPluginSnapshot, RouterLifecycleSettings, RouterPortSettings, SaveGatewayAdminConfigurationRequest } from "../bridge";

function pageTitle(language: UiLanguage) {
  if (language === "zh") return "设置";
  if (language === "ja") return "設定";
  return "Settings";
}

function pageSubtitle(language: UiLanguage) {
  if (language === "zh") return "管理 Codex 安装路径、网络代理和运行日志";
  if (language === "ja") return "Codex のインストールパス、ネットワークプロキシ、実行ログを管理";
  return "Manage Codex installation paths, network proxy, and runtime logs";
}

function OperationCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <ListCard className="responsive-record-row grid min-h-[106px] grid-cols-[minmax(180px,0.62fr)_minmax(0,1.55fr)] items-center gap-5">
      <div className="flex min-w-0 items-center">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">{title}</h3>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </ListCard>
  );
}

export function OperationsPage({
  language,
  languageOptions,
  onLanguageChange,
  busy,
  proxyDraft,
  logKind,
  logContent,
  onProxyDraftChange,
  onLogKindChange,
  onProxyAutoDetect,
  onProxySet,
  onReadLog,
  toolStatuses,
  toolDrafts,
  onToolDraftChange,
  onToolSave,
  onToolReset,
  cliAutoResume,
  autoResumeSaving,
  onCliAutoResumeChange,
  cliTerminalSettings,
  cliTerminalSaving,
  onCliTerminalChange,
  onCliTerminalScan,
  routerLifecycle,
  routerLifecycleSaving,
  onRouterLifecycleChange,
  routerPort,
  routerPortSaving,
  onRouterPortChange,
  launchAtLogin,
  launchAtLoginSaving,
  onLaunchAtLoginChange,
  envHistoryRetention,
  envHistoryRetentionSaving,
  onEnvHistoryRetentionChange,
  generatedImageRecovery,
  generatedImageRecoverySaving,
  onGeneratedImageRecoveryChange,
  appEnvironmentBadges,
  appEnvironmentBadgesSaving,
  onAppEnvironmentBadgesChange,
  onRequestAppEnvironmentBadgePermission,
  gatewayAdminSnapshot,
  providerPlugins,
  providerPluginMarket,
  onInstallProviderPlugin,
  onRefreshProviderPluginMarket,
  onInstallProviderPluginFromMarket,
  onDeactivateProviderPlugin,
  onRollbackProviderPlugin,
  onRemoveProviderPlugin,
  autoUpdateStatus,
  onCheckForAutoUpdate,
  onInstallDownloadedUpdate,
  loadGatewayAdminConfiguration,
  saveGatewayAdminConfiguration,
  onGatewayConfigurationSaved,
  onDiscoverGatewayModels,
}: {
  language: UiLanguage;
  languageOptions: Array<{ value: UiLanguage; label: string }>;
  onLanguageChange: (language: UiLanguage) => void;
  busy: boolean;
  proxyDraft: string;
  logKind: string;
  logContent: string;
  onProxyDraftChange: (value: string) => void;
  onLogKindChange: (value: string) => void;
  onProxyAutoDetect: () => void;
  onProxySet: () => void;
  onReadLog: () => void;
  toolStatuses: CodexToolStatus[];
  toolDrafts: Record<"cli" | "app", string>;
  onToolDraftChange: (kind: "cli" | "app", value: string) => void;
  onToolSave: (kind: "cli" | "app") => void;
  onToolReset: (kind: "cli" | "app") => void;
  cliAutoResume: CliAutoResumeSettings;
  autoResumeSaving: boolean;
  onCliAutoResumeChange: (value: CliAutoResumeSettings) => void;
  cliTerminalSettings: CliTerminalSettings | null;
  cliTerminalSaving: boolean;
  onCliTerminalChange: (id: CliTerminalId) => void;
  onCliTerminalScan: () => void;
  routerLifecycle: RouterLifecycleSettings;
  routerLifecycleSaving: boolean;
  onRouterLifecycleChange: (value: RouterLifecycleSettings) => void;
  routerPort: RouterPortSettings;
  routerPortSaving: boolean;
  onRouterPortChange: (value: RouterPortSettings) => void;
  launchAtLogin: LaunchAtLoginStatus;
  launchAtLoginSaving: boolean;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  envHistoryRetention: EnvHistoryRetentionSettings;
  envHistoryRetentionSaving: boolean;
  onEnvHistoryRetentionChange: (value: EnvHistoryRetentionSettings) => void;
  generatedImageRecovery: GeneratedImageRecoveryStatus;
  generatedImageRecoverySaving: boolean;
  onGeneratedImageRecoveryChange: (enabled: boolean) => void;
  appEnvironmentBadges: AppEnvironmentBadgeStatus;
  appEnvironmentBadgesSaving: boolean;
  onAppEnvironmentBadgesChange: (enabled: boolean) => void;
  onRequestAppEnvironmentBadgePermission: () => void;
  gatewayAdminSnapshot: GatewayAdminEnvironment[];
  providerPlugins: ProviderPluginSnapshot[];
  providerPluginMarket: ProviderPluginMarketEntry[];
  onInstallProviderPlugin: (request: ProviderPluginInstallRequest) => Promise<void>;
  onRefreshProviderPluginMarket: (url: string) => Promise<void>;
  onInstallProviderPluginFromMarket: (input: { id: string; version?: string }) => Promise<void>;
  onDeactivateProviderPlugin: (id: string) => void;
  onRollbackProviderPlugin: (id: string) => void;
  onRemoveProviderPlugin: (id: string) => void;
  autoUpdateStatus: DesktopAutoUpdateStatus;
  onCheckForAutoUpdate: () => void;
  onInstallDownloadedUpdate: () => void;
  loadGatewayAdminConfiguration: (envName: string) => Promise<GatewayAdminConfiguration | null>;
  saveGatewayAdminConfiguration: (request: SaveGatewayAdminConfigurationRequest) => Promise<GatewayAdminConfiguration>;
  onGatewayConfigurationSaved: () => void;
  onDiscoverGatewayModels: (request: { envName: string; providerId: string }) => Promise<void>;
}) {
  const pageCopy = getDesktopCopy(language);
  const [sessionNumberDraft, setSessionNumberDraft] = useState(String(cliAutoResume.sessionNumber));
  const [retentionDaysDraft, setRetentionDaysDraft] = useState(String(envHistoryRetention.retentionDays));
  const [routerPortDraft, setRouterPortDraft] = useState(String(routerPort.preferredPort));
  const [showBadgePermissionDialog, setShowBadgePermissionDialog] = useState(false);
  const [gatewayConfigOpen, setGatewayConfigOpen] = useState(false);
  const [gatewayConfigEnv, setGatewayConfigEnv] = useState<string>();
  const [gatewayConfigJson, setGatewayConfigJson] = useState("");
  const [gatewayConfigBusy, setGatewayConfigBusy] = useState(false);
  const [gatewayDiscoveryKey, setGatewayDiscoveryKey] = useState<string>();
  const [gatewayEditorMode, setGatewayEditorMode] = useState<"structured" | "json">("structured");
  const [pluginInstallOpen, setPluginInstallOpen] = useState(false);
  const [pluginInstallJson, setPluginInstallJson] = useState("");
  const [pluginInstallBusy, setPluginInstallBusy] = useState(false);
  const [pluginMarketUrl, setPluginMarketUrl] = useState("");
  const [pluginMarketBusy, setPluginMarketBusy] = useState(false);
  const [pluginMarketInstalling, setPluginMarketInstalling] = useState<string>();

  useEffect(() => {
    setSessionNumberDraft(String(cliAutoResume.sessionNumber));
  }, [cliAutoResume.sessionNumber]);

  useEffect(() => {
    setRetentionDaysDraft(String(envHistoryRetention.retentionDays));
  }, [envHistoryRetention.retentionDays]);

  useEffect(() => {
    setRouterPortDraft(String(routerPort.preferredPort));
  }, [routerPort.preferredPort]);

  function commitSessionNumber() {
    const nextSessionNumber = Math.max(1, Math.trunc(Number(sessionNumberDraft) || 1));
    setSessionNumberDraft(String(nextSessionNumber));
    if (nextSessionNumber !== cliAutoResume.sessionNumber) {
      onCliAutoResumeChange({ ...cliAutoResume, sessionNumber: nextSessionNumber });
    }
  }

  function commitRetentionDays() {
    const nextRetentionDays = Math.min(365, Math.max(1, Math.trunc(Number(retentionDaysDraft) || 1)));
    setRetentionDaysDraft(String(nextRetentionDays));
    if (nextRetentionDays !== envHistoryRetention.retentionDays) {
      onEnvHistoryRetentionChange({ ...envHistoryRetention, retentionDays: nextRetentionDays });
    }
  }

  function commitRouterPort() {
    const nextPort = Math.min(65535, Math.max(1024, Math.trunc(Number(routerPortDraft) || 17832)));
    setRouterPortDraft(String(nextPort));
    if (nextPort !== routerPort.preferredPort) onRouterPortChange({ preferredPort: nextPort });
  }

  async function openGatewayConfiguration(envName: string) {
    setGatewayConfigBusy(true);
    try {
      const configuration = await loadGatewayAdminConfiguration(envName);
      if (!configuration) throw new Error(`Gateway configuration for '${envName}' was not found`);
      setGatewayConfigEnv(envName);
      setGatewayConfigJson(JSON.stringify({ gateway: configuration.gateway, agentBindings: configuration.agentBindings }, null, 2));
      setGatewayEditorMode("structured");
      setGatewayConfigOpen(true);
    } catch (error) {
      console.error(error);
    } finally {
      setGatewayConfigBusy(false);
    }
  }

  async function saveGatewayConfiguration() {
    if (!gatewayConfigEnv) return;
    let gateway: Record<string, unknown>;
    let agentBindings: Record<string, Record<string, unknown>> | undefined;
    try {
      const parsed = JSON.parse(gatewayConfigJson) as Record<string, unknown>;
      gateway = parsed.gateway && typeof parsed.gateway === "object" && !Array.isArray(parsed.gateway) ? parsed.gateway as Record<string, unknown> : parsed;
      agentBindings = parsed.agentBindings && typeof parsed.agentBindings === "object" && !Array.isArray(parsed.agentBindings) ? parsed.agentBindings as Record<string, Record<string, unknown>> : undefined;
    } catch (error) {
      console.error(error);
      return;
    }
    setGatewayConfigBusy(true);
    try {
      await saveGatewayAdminConfiguration({ envName: gatewayConfigEnv, gateway, agentBindings });
      setGatewayConfigOpen(false);
      onGatewayConfigurationSaved();
    } catch (error) {
      console.error(error);
    } finally {
      setGatewayConfigBusy(false);
    }
  }

  async function discoverGatewayModels(envName: string, providerId: string) {
    const key = `${envName}:${providerId}`;
    setGatewayDiscoveryKey(key);
    try {
      await onDiscoverGatewayModels({ envName, providerId });
    } catch (error) {
      console.error(error);
    } finally {
      setGatewayDiscoveryKey(undefined);
    }
  }

  async function installProviderPluginFromJson() {
    try {
      const request = JSON.parse(pluginInstallJson) as ProviderPluginInstallRequest;
      setPluginInstallBusy(true);
      await onInstallProviderPlugin(request);
      setPluginInstallOpen(false);
      setPluginInstallJson("");
    } catch (error) {
      console.error(error);
    } finally {
      setPluginInstallBusy(false);
    }
  }

  async function refreshProviderPluginMarketFromUrl() {
    const url = pluginMarketUrl.trim();
    if (!url) return;
    setPluginMarketBusy(true);
    try {
      await onRefreshProviderPluginMarket(url);
    } catch (error) {
      console.error(error);
    } finally {
      setPluginMarketBusy(false);
    }
  }

  async function installProviderPluginFromMarketEntry(entry: ProviderPluginMarketEntry) {
    if (!entry.source) return;
    const key = `${entry.id}@${entry.version}`;
    setPluginMarketInstalling(key);
    try {
      await onInstallProviderPluginFromMarket({ id: entry.id, version: entry.version });
    } catch (error) {
      console.error(error);
    } finally {
      setPluginMarketInstalling(undefined);
    }
  }

  return (
    <ListPageFrame>
      <ListPageHeader title={pageTitle(language)} subtitle={pageSubtitle(language)} />

      <ListStack>
        <OperationCard
          title={language === "zh" ? "自动更新" : "Automatic updates"}
          subtitle={language === "zh" ? "仅在配置更新源后检查；下载完成后可回滚到安装前版本。" : "Checks only when an update feed is configured; install is enabled after download."}
        >
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <span className="text-[12px] text-slate-600">{autoUpdateStatus.enabled ? autoUpdateStatus.state : (language === "zh" ? "未配置更新源" : "Feed not configured")}{autoUpdateStatus.version ? ` · ${autoUpdateStatus.version}` : ""}</span>
            {autoUpdateStatus.message ? <span className="text-[11px] text-slate-400">{autoUpdateStatus.message}</span> : null}
            <div className="ml-auto flex gap-2">
              <button type="button" className="rounded-md bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 ring-1 ring-black/[0.06] disabled:opacity-50" disabled={!autoUpdateStatus.enabled || autoUpdateStatus.state === "checking"} onClick={onCheckForAutoUpdate}>{language === "zh" ? "检查更新" : "Check"}</button>
              <button type="button" className="rounded-md bg-[#34C759] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50" disabled={autoUpdateStatus.state !== "downloaded"} onClick={onInstallDownloadedUpdate}>{language === "zh" ? "安装" : "Install"}</button>
            </div>
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "Gateway 运营视图" : "Gateway operations"}
          subtitle={language === "zh" ? "集中查看 Provider、Credential、模型目录、路由组、Agent 绑定和配额状态。" : "Inspect providers, credentials, model catalog, route groups, agent bindings, and quota state."}
        >
          <div className="space-y-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            {gatewayAdminSnapshot.length ? gatewayAdminSnapshot.map((item) => (
              <div key={item.envName} className="rounded-xl bg-white px-3 py-3 ring-1 ring-black/[0.04]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-neutral-900">{item.envName}</div><div className="mt-0.5 text-[11px] text-slate-500">{item.gatewayId} · {item.mode === "gateway" ? (language === "zh" ? "网关模式" : "Gateway") : (language === "zh" ? "手动模式" : "Manual")}</div></div>
                  <div className="flex items-center gap-2"><IconActionButton icon={<Wrench className="size-4" />} label={language === "zh" ? "编辑 Gateway 配置" : "Edit Gateway configuration"} onClick={() => void openGatewayConfiguration(item.envName)} disabled={gatewayConfigBusy} /><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${item.gatewayEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.gatewayEnabled ? (language === "zh" ? "运行中" : "Running") : (language === "zh" ? "未运行" : "Stopped")}</span></div>
                </div>
                <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-4"><span>Provider {item.providers.length}</span><span>Credential {item.credentials.length}</span><span>Model {item.models.length}</span><span>RouteGroup {item.routeGroups.length}</span><span>Agent {item.agents.length}</span><span>{language === "zh" ? "已路由账号" : "Routed accounts"} {item.routedAccounts}</span><span className="truncate" title={item.localGatewayBaseUrl}>{item.localGatewayBaseUrl ?? "-"}</span><span>{item.quota ? `${language === "zh" ? "Quota" : "Quota"} ${item.quota.maxRequests ?? "∞"}/${item.quota.windowMinutes}m` : "Quota -"}</span></div>
                {item.providers.length ? <div className="mt-3 flex flex-wrap gap-2">{item.providers.map((provider) => <button key={provider.id} type="button" className="rounded-md border border-black/[0.07] bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-wait disabled:opacity-50" disabled={gatewayDiscoveryKey !== undefined} onClick={() => void discoverGatewayModels(item.envName, provider.id)}>{gatewayDiscoveryKey === `${item.envName}:${provider.id}` ? (language === "zh" ? `发现 ${provider.displayName}…` : `Discovering ${provider.displayName}…`) : (language === "zh" ? `发现 ${provider.displayName} 模型` : `Discover ${provider.displayName} models`)}</button>)}</div> : null}
                {item.routeGroups.length ? <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-[#fafbfc]">{item.routeGroups.map((group) => <div key={group.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"><span className="font-medium text-neutral-800">{group.exposedModelId}</span><span className="text-slate-500">{group.strategy} · {group.memberCount} {language === "zh" ? "成员" : "members"}{group.fallbackEnabled ? " · fallback" : ""}</span></div>)}</div> : null}
                {item.agents.length ? <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-[#fafbfc]">{item.agents.map((agent) => {
                  const stateLabel = agent.state === "clean" ? (language === "zh" ? "正常" : "Clean") : agent.state === "drifted" ? (language === "zh" ? "已漂移" : "Drifted") : agent.state === "missing" ? (language === "zh" ? "配置缺失" : "Missing") : agent.state === "disabled" ? (language === "zh" ? "未连接" : "Disabled") : (language === "zh" ? "未接入" : "Unwired");
                  const stateClass = agent.state === "clean" ? "text-emerald-600" : agent.state === "drifted" || agent.state === "missing" ? "text-amber-600" : "text-slate-500";
                  return <div key={agent.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"><div className="min-w-0"><span className="font-medium text-neutral-800">{agent.displayName}</span><span className="ml-2 text-slate-400">{agent.defaultModelId ?? agent.defaultRouteGroupId ?? "-"}</span>{agent.configPath ? <div className="truncate text-[10px] text-slate-400">{agent.configPath}</div> : null}</div><span className={stateClass}>{stateLabel}</span></div>;
                })}</div> : null}
              </div>
            )) : <div className="py-3 text-center text-[12px] text-slate-400">{language === "zh" ? "暂无 Gateway 配置" : "No Gateway configuration"}</div>}
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "Provider 插件运行时" : "Provider plugin runtime"}
          subtitle={language === "zh" ? "插件按受限 Host 启动，并可安全停用、回滚或删除；插件只提供显式 Provider/模型能力。" : "Plugins run behind the restricted host and can be deactivated, rolled back, or removed; providers expose explicit model capabilities only."}
        >
          <div className="space-y-2 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <div className="flex justify-end"><button type="button" className="rounded-md bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 ring-1 ring-black/[0.06]" onClick={() => { setPluginInstallJson(JSON.stringify({ manifest: { id: "provider-plugin", name: "Provider plugin", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] }, source: { kind: "local", path: "/path/to/plugin" } }, null, 2)); setPluginInstallOpen(true); }}>{language === "zh" ? "安装插件" : "Install plugin"}</button></div>
            <div className="rounded-lg bg-white px-3 py-3 ring-1 ring-black/[0.04]">
              <div className="mb-2 text-[11px] font-medium text-slate-700">{language === "zh" ? "Provider 插件市场" : "Provider plugin market"}</div>
              <div className="flex gap-2">
                <Input aria-label={language === "zh" ? "Provider 插件市场地址" : "Provider plugin market URL"} className="h-8 min-w-0 flex-1 bg-[#fafbfc] text-[11px]" value={pluginMarketUrl} onChange={(event) => setPluginMarketUrl(event.target.value)} placeholder="https://example.com/provider-plugins.json" />
                <button type="button" className="rounded-md bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 ring-1 ring-black/[0.06] disabled:opacity-50" disabled={pluginMarketBusy || !pluginMarketUrl.trim()} onClick={() => void refreshProviderPluginMarketFromUrl()}>{pluginMarketBusy ? (language === "zh" ? "刷新中…" : "Refreshing…") : (language === "zh" ? "刷新" : "Refresh")}</button>
              </div>
              <div className="mt-2 text-[10px] text-slate-400">{language === "zh" ? "市场条目必须声明明确的 local/npm/git 安装源；签名条目在未配置受信校验器时会被拒绝。" : "Entries must declare an explicit local/npm/git source; signed entries fail closed without a trusted verifier."}</div>
              {providerPluginMarket.length ? <div className="mt-3 space-y-2">{providerPluginMarket.map((entry) => {
                const key = `${entry.id}@${entry.version}`;
                const installed = providerPlugins.some((plugin) => plugin.id === entry.id && plugin.version === entry.version);
                return <div key={key} className="flex flex-wrap items-center gap-2 rounded-md bg-[#fafbfc] px-2.5 py-2 ring-1 ring-slate-100">
                  <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium text-neutral-800">{entry.name} <span className="font-mono text-[10px] text-slate-400">{key}</span></div><div className="mt-0.5 truncate text-[10px] text-slate-500">{entry.description ?? entry.downloadUrl ?? (language === "zh" ? "无描述" : "No description")}</div></div>
                  <button type="button" className="rounded-md border border-black/[0.07] bg-white px-2 py-1 text-[10px] text-slate-600 disabled:opacity-50" disabled={!entry.source || installed || pluginMarketInstalling !== undefined} onClick={() => void installProviderPluginFromMarketEntry(entry)}>{installed ? (language === "zh" ? "已安装" : "Installed") : !entry.source ? (language === "zh" ? "无安装源" : "No source") : pluginMarketInstalling === key ? (language === "zh" ? "安装中…" : "Installing…") : (language === "zh" ? "安装" : "Install")}</button>
                </div>;
              })}</div> : <div className="mt-3 text-center text-[10px] text-slate-400">{language === "zh" ? "暂无缓存市场条目" : "No cached market entries"}</div>}
            </div>
            {providerPlugins.length ? providerPlugins.map((plugin) => <div key={plugin.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-black/[0.04]">
              <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-neutral-800">{plugin.name} <span className="font-mono text-[10px] text-slate-400">{plugin.id}@{plugin.version}</span></div><div className="mt-0.5 text-[10px] text-slate-500">{plugin.provider?.displayName ?? (language === "zh" ? "未激活" : "Inactive")} · {plugin.permissions.join(", ") || "provider"}{plugin.error ? ` · ${plugin.error}` : ""}</div></div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${plugin.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{plugin.active ? (language === "zh" ? "运行中" : "Active") : (language === "zh" ? "已停用" : "Inactive")}</span>
              {plugin.active ? <button type="button" className="rounded-md border border-black/[0.07] bg-white px-2 py-1 text-[10px] text-slate-600" onClick={() => onDeactivateProviderPlugin(plugin.id)}>{language === "zh" ? "停用" : "Deactivate"}</button> : null}
              <button type="button" className="rounded-md border border-black/[0.07] bg-white px-2 py-1 text-[10px] text-slate-600" onClick={() => onRollbackProviderPlugin(plugin.id)}>{language === "zh" ? "回滚" : "Rollback"}</button>
              <button type="button" className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] text-rose-600" onClick={() => onRemoveProviderPlugin(plugin.id)}>{language === "zh" ? "删除" : "Remove"}</button>
            </div>) : <div className="py-2 text-center text-[11px] text-slate-400">{language === "zh" ? "暂无已安装 Provider 插件" : "No installed Provider plugins"}</div>}
          </div>
        </OperationCard>

        <SidePanel
          open={pluginInstallOpen}
          title={language === "zh" ? "安装 Provider 插件" : "Install Provider plugin"}
          description={language === "zh" ? "输入 manifest 和 local/npm/git source。签名插件必须通过校验后才能启动；插件不会获得未声明的 Secret、网络或文件权限。" : "Provide a manifest and a local/npm/git source. Signed plugins are verified before activation and receive no undeclared secret, network, or filesystem permissions."}
          onClose={() => setPluginInstallOpen(false)}
          closeLabel={language === "zh" ? "关闭" : "Close"}
        >
          <Textarea className="min-h-[360px] font-mono text-[11px] leading-5" value={pluginInstallJson} onChange={(event) => setPluginInstallJson(event.target.value)} spellCheck={false} />
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-md border border-black/[0.08] bg-white px-3 py-2 text-[12px] font-medium text-slate-600" onClick={() => setPluginInstallOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</button><button type="button" className="rounded-md bg-[#34C759] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50" disabled={pluginInstallBusy || !pluginInstallJson.trim()} onClick={() => void installProviderPluginFromJson()}>{pluginInstallBusy ? (language === "zh" ? "安装中…" : "Installing…") : (language === "zh" ? "安装并启动" : "Install and activate")}</button></div>
        </SidePanel>

        <SidePanel
          open={gatewayConfigOpen}
          title={language === "zh" ? `编辑 ${gatewayConfigEnv ?? ""} Gateway` : `Edit ${gatewayConfigEnv ?? ""} Gateway`}
          description={language === "zh" ? "编辑 Provider、Credential 引用、模型目录和显式 RouteGroup。不会保存明文密钥，也不支持意图路由字段。" : "Edit providers, credential references, models, and explicit route groups. Plaintext secrets and intent-routing fields are not accepted."}
          onClose={() => setGatewayConfigOpen(false)}
          closeLabel={language === "zh" ? "关闭" : "Close"}
        >
          <div className="mb-4 flex gap-1 rounded-lg bg-[#f7f8fa] p-1"><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${gatewayEditorMode === "structured" ? "bg-white text-neutral-900 shadow-sm" : "text-slate-500"}`} onClick={() => setGatewayEditorMode("structured")}>{language === "zh" ? "结构化表单" : "Structured"}</button><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${gatewayEditorMode === "json" ? "bg-white text-neutral-900 shadow-sm" : "text-slate-500"}`} onClick={() => setGatewayEditorMode("json")}>{language === "zh" ? "高级 JSON" : "Advanced JSON"}</button></div>
          {gatewayEditorMode === "structured" ? <GatewayAdminStructuredEditor value={gatewayConfigJson} onChange={setGatewayConfigJson} language={language} /> : <Field label={language === "zh" ? "Gateway + Agent JSON" : "Gateway + Agent JSON"} hint={language === "zh" ? "保存时由 Core 校验 schema；路由只按显式模型、RouteGroup、能力、健康度、配额和策略选择。agentBindings 只保存配置绑定，不包含密钥。" : "Core validates the schema on save; routing uses explicit models, RouteGroups, capabilities, health, quota, and strategy. agentBindings contain configuration bindings only, never secrets."}>
            <Textarea className="min-h-[520px] font-mono text-[11px] leading-5" value={gatewayConfigJson} onChange={(event) => setGatewayConfigJson(event.target.value)} spellCheck={false} />
          </Field>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-md border border-black/[0.08] bg-white px-3 py-2 text-[12px] font-medium text-slate-600" onClick={() => setGatewayConfigOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</button><button type="button" className="rounded-md bg-[#34C759] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50" disabled={gatewayConfigBusy} onClick={() => void saveGatewayConfiguration()}>{language === "zh" ? "保存配置" : "Save configuration"}</button></div>
        </SidePanel>

        <OperationCard
          title={language === "zh" ? "界面语言" : language === "ja" ? "表示言語" : "Interface language"}
          subtitle={language === "zh" ? "选择应用界面的显示语言" : language === "ja" ? "アプリで使用する言語を選択" : "Choose the language used throughout the app"}
        >
          <div className="rounded-lg bg-[#f7f8fa] px-4 py-3">
            <Select
              value={language}
              onValueChange={(value) => onLanguageChange(value as UiLanguage)}
              items={languageOptions}
              openOnHover={false}
              className="h-9 max-w-[260px] bg-white"
            />
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "环境历史" : language === "ja" ? "環境履歴" : "Environment history"}
          subtitle={language === "zh" ? "每天自动清理过期的环境配置记录" : language === "ja" ? "期限切れの環境設定履歴を毎日自動削除" : "Delete expired environment configuration history each day"}
        >
          <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "自动清理历史" : language === "ja" ? "履歴を自動削除" : "Clean history automatically"}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "后台异步执行，不影响应用启动和使用" : language === "ja" ? "バックグラウンドで実行され、起動や操作を妨げません" : "Runs in the background without delaying app startup"}</div>
            </div>
            {envHistoryRetention.enabled ? (
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                <span>{language === "zh" ? "保留" : language === "ja" ? "保持" : "Keep"}</span>
                <Input
                  aria-label={language === "zh" ? "环境历史保留天数" : "Environment history retention days"}
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={retentionDaysDraft}
                  onChange={(event) => setRetentionDaysDraft(event.target.value)}
                  onBlur={commitRetentionDays}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  disabled={envHistoryRetentionSaving}
                  className="h-8 w-16 rounded-md bg-white px-2 text-center tabular-nums"
                />
                <span>{language === "zh" ? "天" : language === "ja" ? "日" : "days"}</span>
              </label>
            ) : null}
            <button
              type="button"
              role="switch"
              aria-label={language === "zh" ? "自动清理环境历史" : "Clean environment history automatically"}
              aria-checked={envHistoryRetention.enabled}
              disabled={envHistoryRetentionSaving}
              onClick={() => onEnvHistoryRetentionChange({ ...envHistoryRetention, enabled: !envHistoryRetention.enabled })}
              className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-wait disabled:opacity-60 ${envHistoryRetention.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}
            >
              <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${envHistoryRetention.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
            </button>
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "生图兼容修复" : language === "ja" ? "画像生成の互換性修復" : "Image generation compatibility"}
          subtitle={language === "zh" ? "临时修复第三方中转站生成图片后无法展示或保存的问题" : language === "ja" ? "サードパーティ中継で生成画像を表示・保存できない問題を一時修復" : "Temporary fix for images not displayed or saved through third-party relays"}
        >
          <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-neutral-800">
                {language === "zh" ? "恢复 Codex 生成图片" : language === "ja" ? "Codex 生成画像を復元" : "Recover Codex generated images"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {language === "zh"
                  ? `开启后自动安装到全部 Codex 环境（${generatedImageRecovery.installedEnvironments}/${generatedImageRecovery.totalEnvironments}）`
                  : language === "ja"
                    ? `有効にすると全 Codex 環境へ自動インストール（${generatedImageRecovery.installedEnvironments}/${generatedImageRecovery.totalEnvironments}）`
                    : `Installs automatically in every Codex environment (${generatedImageRecovery.installedEnvironments}/${generatedImageRecovery.totalEnvironments})`}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={language === "zh" ? "修复第三方中转站生图不展示" : "Fix generated images not displaying through third-party relays"}
              aria-checked={generatedImageRecovery.enabled}
              disabled={generatedImageRecoverySaving}
              onClick={() => onGeneratedImageRecoveryChange(!generatedImageRecovery.enabled)}
              className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-wait disabled:opacity-60 ${generatedImageRecovery.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}
            >
              <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${generatedImageRecovery.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
            </button>
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "Codex App 环境标识" : language === "ja" ? "Codex App 環境バッジ" : "Codex App environment badges"}
          subtitle={language === "zh" ? "多开窗口时，在 Dock 或任务栏图标上区分环境" : language === "ja" ? "複数ウィンドウを Dock またはタスクバーで識別" : "Distinguish multiple environments in the Dock or taskbar"}
        >
          <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-neutral-800">
                {language === "zh" ? "显示环境首字母标识" : language === "ja" ? "環境の頭文字を表示" : "Show environment initials"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {!appEnvironmentBadges.supported
                  ? language === "zh" ? "当前系统或原生组件暂不支持" : language === "ja" ? "現在のシステムでは利用できません" : "Unavailable on this system"
                  : language === "zh" ? "默认关闭；不会修改 Codex App，也不会自动重启" : language === "ja" ? "既定ではオフ。Codex App の変更や自動再起動は行いません" : "Off by default; never modifies or automatically restarts Codex App"}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={language === "zh" ? "显示 Codex App 环境标识" : "Show Codex App environment badges"}
              aria-checked={appEnvironmentBadges.enabled}
              disabled={appEnvironmentBadgesSaving || !appEnvironmentBadges.supported}
              onClick={() => {
                if (!appEnvironmentBadges.enabled && appEnvironmentBadges.platform === "macos" && appEnvironmentBadges.permission !== "granted") {
                  setShowBadgePermissionDialog(true);
                  return;
                }
                onAppEnvironmentBadgesChange(!appEnvironmentBadges.enabled);
              }}
              className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${appEnvironmentBadges.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}
            >
              <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${appEnvironmentBadges.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
            </button>
          </div>
        </OperationCard>

        <ListCard className="responsive-record-row overflow-visible px-5 py-0">
          <div className="grid min-h-[116px] items-center gap-5 lg:grid-cols-[minmax(180px,0.62fr)_minmax(0,1.55fr)]">
            <div><h3 className="text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{language === "zh" ? "CLI 启动" : "CLI Launch"}</h3><p className="mt-1 text-[12px] text-slate-500">{language === "zh" ? "设置启动终端与对话恢复方式" : "Configure the terminal and session resume behavior"}</p></div>
            <div className="grid gap-3 py-3 md:grid-cols-2">
              <div className="flex min-w-0 items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "默认终端" : "Default terminal"}</div><div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "打开 CLI 使用的软件" : "Application used to open CLI"}</div></div>
                <Select value={cliTerminalSettings?.selectedId} onValueChange={(value) => onCliTerminalChange(value as CliTerminalId)} items={(cliTerminalSettings?.terminals ?? []).map((terminal) => ({ value: terminal.id, label: terminal.label, iconUrl: terminal.iconUrl }))} placeholder={language === "zh" ? "扫描中…" : "Scanning…"} disabled={cliTerminalSaving || !cliTerminalSettings} openOnHover={false} className="h-9 w-[170px] bg-[#f7f8fa]" />
                <IconActionButton icon={<RefreshCw className={`size-4 ${cliTerminalSaving ? "animate-spin" : ""}`} />} label={language === "zh" ? "重新扫描终端" : "Rescan terminals"} onClick={onCliTerminalScan} disabled={cliTerminalSaving} />
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "自动恢复对话" : language === "ja" ? "会話を自動再開" : "Auto resume"}</div><div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "启动CLI时自动恢复最近第N次对话" : language === "ja" ? "CLI 起動時に直近 N 番目の会話を自動再開" : "Resume the Nth most recent conversation when launching CLI"}</div></div>
                {cliAutoResume.enabled ? <label className="flex items-center gap-1.5 text-[11px] text-slate-500"><span>{language === "zh" ? "第" : "#"}</span><Input type="number" min={1} step={1} value={sessionNumberDraft} onChange={(event) => setSessionNumberDraft(event.target.value)} onBlur={commitSessionNumber} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={autoResumeSaving} className="h-8 w-14 rounded-md bg-[#f7f8fa] px-2 text-center tabular-nums" /><span>{language === "zh" ? "个" : ""}</span></label> : null}
                <button type="button" role="switch" aria-label={language === "zh" ? "启用 CLI 自动恢复对话" : "Enable CLI auto resume"} aria-checked={cliAutoResume.enabled} disabled={autoResumeSaving} onClick={() => onCliAutoResumeChange({ ...cliAutoResume, enabled: !cliAutoResume.enabled })} className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-wait disabled:opacity-60 ${cliAutoResume.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}><span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${cliAutoResume.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} /></button>
              </div>
            </div>
          </div>
        </ListCard>

        <OperationCard
          title={language === "zh" ? "本地路由" : language === "ja" ? "ローカルルート" : "Local routing"}
          subtitle={language === "zh" ? "控制完全退出应用后的路由生命周期" : language === "ja" ? "アプリ終了後のルート動作を設定" : "Control the route lifecycle after quitting the app"}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "路由起始端口" : language === "ja" ? "ルート開始ポート" : "Router start port"}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "占用时自动递增并记住，下次启动生效" : language === "ja" ? "使用中なら自動で増分し、次回起動から適用" : "Auto-increments when occupied and applies next launch"}</div>
              </div>
              <Input
                aria-label={language === "zh" ? "路由起始端口" : "Router start port"}
                type="number"
                min={1024}
                max={65535}
                step={1}
                value={routerPortDraft}
                onChange={(event) => setRouterPortDraft(event.target.value)}
                onBlur={commitRouterPort}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                disabled={routerPortSaving}
                className="h-8 w-[84px] rounded-md bg-white px-2 text-center tabular-nums"
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "退出应用时停止路由" : language === "ja" ? "終了時にルートを停止" : "Stop routing when quitting"}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "开启后，依赖路由的 CLI 会在退出时断开" : language === "ja" ? "有効にすると、ルートを使用中の CLI は切断されます" : "When enabled, CLI sessions using routing will disconnect"}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={language === "zh" ? "退出应用时停止路由" : language === "ja" ? "終了時にルートを停止" : "Stop routing when quitting"}
                aria-checked={routerLifecycle.stopOnAppQuit}
                disabled={routerLifecycleSaving}
                onClick={() => onRouterLifecycleChange({ stopOnAppQuit: !routerLifecycle.stopOnAppQuit })}
                className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-wait disabled:opacity-60 ${routerLifecycle.stopOnAppQuit ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}
              >
                <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${routerLifecycle.stopOnAppQuit ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>
          </div>
        </OperationCard>

        <OperationCard
          title={language === "zh" ? "登录启动" : language === "ja" ? "ログイン時に起動" : "Launch at login"}
          subtitle={language === "zh" ? "登录系统后自动启动 Codex Switcher，保留本地 Gateway 和托盘服务" : language === "ja" ? "ログイン後に Codex Switcher とローカル Gateway を自動起動" : "Start Codex Switcher with the local Gateway and tray service after sign-in"}
        >
          <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "登录系统时自动启动" : language === "ja" ? "ログイン時に自動起動" : "Start automatically at login"}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{launchAtLogin.supported ? (language === "zh" ? "仅在 macOS 和 Windows 上由系统管理" : language === "ja" ? "macOS と Windows のシステム設定で管理" : "Managed by the operating system on macOS and Windows") : (language === "zh" ? "当前系统暂不支持登录启动" : language === "ja" ? "現在のシステムでは利用できません" : "Unavailable on this system")}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={language === "zh" ? "登录系统时自动启动" : "Start automatically at login"}
              aria-checked={launchAtLogin.enabled}
              disabled={launchAtLoginSaving || !launchAtLogin.supported}
              onClick={() => onLaunchAtLoginChange(!launchAtLogin.enabled)}
              className={`motion-toggle relative h-[22px] w-[38px] shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${launchAtLogin.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}
            >
              <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${launchAtLogin.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
            </button>
          </div>
        </OperationCard>

        <ListCard className="responsive-record-row px-5 py-0">
          <div className="grid min-h-[150px] items-center gap-5 lg:grid-cols-[minmax(180px,0.62fr)_minmax(0,1.55fr)]">
            <div><h3 className="text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{language === "zh" ? "Codex 安装" : "Codex Installation"}</h3><p className="mt-1 text-[12px] text-slate-500">{language === "zh" ? "配置CLI 与 APP 的安装路径后，支持一键启动与切换" : language === "ja" ? "CLI と App のインストール先を設定し、ワンクリックで起動・切替" : "Configure CLI and App paths for one-click launch and switching"}</p></div>
            <div className="space-y-2 py-3">
              {(["cli", "app"] as const).map((kind) => { const status = toolStatuses.find((item) => item.kind === kind); const title = kind === "cli" ? "CLI" : "App"; return <div key={kind} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-[#f7f8fa] px-4 py-3"><span className="text-[12px] font-medium text-neutral-700">{title}</span><Input value={toolDrafts[kind]} onChange={(event) => onToolDraftChange(kind, event.target.value)} placeholder={status?.detectedPath || (language === "zh" ? `请输入 Codex ${title} 路径` : `Enter Codex ${title} path`)} className="h-9 rounded-lg border-neutral-200 bg-white text-[13px] shadow-none" /><div className="responsive-actions"><IconActionButton icon={<Save className="size-4" />} label={language === "zh" ? "保存路径" : "Save path"} onClick={() => onToolSave(kind)} disabled={busy} /><IconActionButton icon={<RotateCcw className="size-4" />} label={language === "zh" ? "恢复自动检测" : "Use automatic detection"} onClick={() => onToolReset(kind)} disabled={busy} /></div></div>; })}
            </div>
          </div>
        </ListCard>

        <OperationCard
          title={pageCopy.operations.proxyTitle}
          subtitle={pageCopy.operations.proxyPlaceholder}
        >
          <div data-settings-row="proxy" className="responsive-operation-controls rounded-lg bg-[#f7f8fa] px-4 py-3">
            <Input
              value={proxyDraft}
              onChange={(event) => onProxyDraftChange(event.target.value)}
              placeholder={pageCopy.operations.proxyPlaceholder}
              className="h-9 rounded-lg border-neutral-200 bg-white text-[13px] shadow-none dark:border-white/[0.08] dark:bg-[#161c24]"
            />
            <div className="responsive-actions">
              <IconActionButton icon={<Activity className="size-4" />} label={language === "zh" ? "自动检测" : "Auto Detect"} onClick={onProxyAutoDetect} disabled={busy} />
              <IconActionButton icon={<Wrench className="size-4" />} label={pageCopy.operations.proxySet} onClick={onProxySet} disabled={busy} />
            </div>
          </div>
        </OperationCard>

        <OperationCard
          title={pageCopy.operations.advancedTitle}
          subtitle={pageCopy.operations.readLog}
        >
          <div data-settings-row="logs" className="responsive-operation-controls rounded-lg bg-[#f7f8fa] px-4 py-3">
            <Field label={pageCopy.operations.logKind}>
              <Select
                value={logKind}
                onValueChange={onLogKindChange}
                items={[
                  { value: "switcher", label: localizeLogKind("switcher", language) },
                  { value: "token-refresh", label: localizeLogKind("token-refresh", language) },
                ]}
                className="h-9 max-w-[260px] bg-white"
              />
            </Field>
            <div className="responsive-actions">
              <IconActionButton icon={<FileSearch className="size-4" />} label={pageCopy.operations.readLog} onClick={onReadLog} disabled={busy} />
            </div>
            <pre className="col-span-full max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#111827] px-4 py-3 font-mono text-[11px] leading-5 text-slate-200">
              {logContent || (language === "zh" ? "暂无日志" : language === "ja" ? "ログはありません" : "No log entries")}
            </pre>
          </div>
        </OperationCard>
      </ListStack>
      <ConfirmDialog
        open={showBadgePermissionDialog}
        title={language === "zh" ? "需要辅助功能权限" : language === "ja" ? "アクセシビリティ権限が必要です" : "Accessibility permission required"}
        description={language === "zh"
          ? "为识别 Codex App 在 Dock 中的位置，需要使用 macOS 辅助功能权限。此功能仅用于定位窗口和 Dock 图标，不会读取或记录键盘输入。"
          : language === "ja"
            ? "Dock 内の Codex App の位置を特定するためにアクセシビリティ権限を使用します。キーボード入力の読み取りや記録は行いません。"
            : "Accessibility access is used only to locate Codex App windows and Dock icons. Keyboard input is never read or recorded."}
        confirmLabel={language === "zh" ? "继续" : language === "ja" ? "続ける" : "Continue"}
        cancelLabel={language === "zh" ? "取消" : language === "ja" ? "キャンセル" : "Cancel"}
        tone="default"
        onCancel={() => setShowBadgePermissionDialog(false)}
        onConfirm={() => {
          setShowBadgePermissionDialog(false);
          onRequestAppEnvironmentBadgePermission();
        }}
      />

    </ListPageFrame>
  );
}
