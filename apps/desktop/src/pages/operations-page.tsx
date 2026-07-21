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
import { Field, Input, Select } from "../components/form-primitives";
import { ConfirmDialog } from "../components/admin-primitives";
import { getDesktopCopy } from "../desktop-copy";
import { localizeLogKind } from "../desktop-utils";
import type { UiLanguage } from "../i18n";
import type { AppEnvironmentBadgeStatus, CliAutoResumeSettings, CliTerminalId, CliTerminalSettings, CodexToolStatus, EnvHistoryRetentionSettings, GeneratedImageRecoveryStatus, RouterLifecycleSettings, RouterPortSettings } from "../bridge";

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
}: {
  language: UiLanguage;
  languageOptions: Array<{ value: UiLanguage; label: string }>;
  onLanguageChange: (language: UiLanguage) => void;
  busy: boolean;
  proxyDraft: string;
  logKind: string;
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
}) {
  const pageCopy = getDesktopCopy(language);
  const [sessionNumberDraft, setSessionNumberDraft] = useState(String(cliAutoResume.sessionNumber));
  const [retentionDaysDraft, setRetentionDaysDraft] = useState(String(envHistoryRetention.retentionDays));
  const [routerPortDraft, setRouterPortDraft] = useState(String(routerPort.preferredPort));
  const [showBadgePermissionDialog, setShowBadgePermissionDialog] = useState(false);

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

  return (
    <ListPageFrame>
      <ListPageHeader title={pageTitle(language)} subtitle={pageSubtitle(language)} />

      <ListStack>
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
