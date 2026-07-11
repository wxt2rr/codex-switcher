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
  ListFilters,
  ListPageFrame,
  ListPageHeader,
  ListStack,
} from "../components/account-list-primitives";
import { Field, Input, Select } from "../components/form-primitives";
import type { OverviewPayload } from "../desktop-model";
import { getDesktopCopy } from "../desktop-copy";
import { localizeLogKind } from "../desktop-utils";
import type { UiLanguage } from "../i18n";
import type { CliAutoResumeSettings, CliTerminalId, CliTerminalSettings, CodexToolStatus } from "../bridge";

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
  overview,
  language,
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
}: {
  overview: OverviewPayload;
  language: UiLanguage;
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
}) {
  const pageCopy = getDesktopCopy(language);
  const [sessionNumberDraft, setSessionNumberDraft] = useState(String(cliAutoResume.sessionNumber));

  useEffect(() => {
    setSessionNumberDraft(String(cliAutoResume.sessionNumber));
  }, [cliAutoResume.sessionNumber]);

  function commitSessionNumber() {
    const nextSessionNumber = Math.max(1, Math.trunc(Number(sessionNumberDraft) || 1));
    setSessionNumberDraft(String(nextSessionNumber));
    if (nextSessionNumber !== cliAutoResume.sessionNumber) {
      onCliAutoResumeChange({ ...cliAutoResume, sessionNumber: nextSessionNumber });
    }
  }

  return (
    <ListPageFrame>
      <ListPageHeader title={pageTitle(language)} subtitle={pageSubtitle(language)} />

      <ListFilters>
        <div className="flex h-8 items-center rounded-lg border border-neutral-200 bg-white px-3 text-[12px] font-medium text-slate-600 dark:border-white/[0.08] dark:bg-[#161c24] dark:text-slate-300">
          {pageCopy.common.cliCurrent}: {overview.status.cli.current}
        </div>
        <div className="flex h-8 items-center rounded-lg border border-neutral-200 bg-white px-3 text-[12px] font-medium text-slate-600 dark:border-white/[0.08] dark:bg-[#161c24] dark:text-slate-300">
          {pageCopy.common.appCurrent}: {overview.status.app.current}
        </div>
      </ListFilters>

      <ListStack>
        <ListCard className="responsive-record-row overflow-visible px-5 py-0">
          <div className="grid min-h-[116px] items-center gap-5 lg:grid-cols-[minmax(180px,0.62fr)_minmax(0,1.55fr)]">
            <div><h3 className="text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{language === "zh" ? "CLI 启动" : "CLI Launch"}</h3><p className="mt-1 text-[12px] text-slate-500">{language === "zh" ? "设置启动终端与对话恢复方式" : "Configure the terminal and session resume behavior"}</p></div>
            <div className="grid gap-3 py-3 md:grid-cols-2">
              <div className="flex min-w-0 items-center gap-3 rounded-xl bg-[#f7f8fa] px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "默认终端" : "Default terminal"}</div><div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "打开 CLI 使用的软件" : "Application used to open CLI"}</div></div>
                <Select value={cliTerminalSettings?.selectedId} onValueChange={(value) => onCliTerminalChange(value as CliTerminalId)} items={(cliTerminalSettings?.terminals ?? []).map((terminal) => ({ value: terminal.id, label: terminal.label, iconUrl: terminal.iconUrl }))} placeholder={language === "zh" ? "扫描中…" : "Scanning…"} disabled={cliTerminalSaving || !cliTerminalSettings} openOnHover={false} className="h-9 w-[170px] bg-[#f7f8fa]" />
                <IconActionButton icon={<RefreshCw className={`size-4 ${cliTerminalSaving ? "animate-spin" : ""}`} />} label={language === "zh" ? "重新扫描终端" : "Rescan terminals"} onClick={onCliTerminalScan} disabled={cliTerminalSaving} />
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#f7f8fa] px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[12px] font-medium text-neutral-800">{language === "zh" ? "自动恢复对话" : "Auto resume"}</div><div className="mt-0.5 text-[11px] text-slate-400">{language === "zh" ? "恢复当前项目最近对话" : "Resume a recent project session"}</div></div>
                {cliAutoResume.enabled ? <label className="flex items-center gap-1.5 text-[11px] text-slate-500"><span>{language === "zh" ? "第" : "#"}</span><Input type="number" min={1} step={1} value={sessionNumberDraft} onChange={(event) => setSessionNumberDraft(event.target.value)} onBlur={commitSessionNumber} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={autoResumeSaving} className="h-8 w-14 rounded-md bg-[#f7f8fa] px-2 text-center tabular-nums" /><span>{language === "zh" ? "个" : ""}</span></label> : null}
                <button type="button" role="switch" aria-label={language === "zh" ? "启用 CLI 自动恢复对话" : "Enable CLI auto resume"} aria-checked={cliAutoResume.enabled} disabled={autoResumeSaving} onClick={() => onCliAutoResumeChange({ ...cliAutoResume, enabled: !cliAutoResume.enabled })} className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-wait disabled:opacity-60 ${cliAutoResume.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}><span className={`absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] transition-transform duration-200 ${cliAutoResume.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} /></button>
              </div>
            </div>
          </div>
        </ListCard>

        <ListCard className="responsive-record-row px-5 py-0">
          <div className="grid min-h-[150px] items-center gap-5 lg:grid-cols-[minmax(180px,0.62fr)_minmax(0,1.55fr)]">
            <div><h3 className="text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{language === "zh" ? "Codex 安装" : "Codex Installation"}</h3><p className="mt-1 text-[12px] text-slate-500">{language === "zh" ? "管理 CLI 与 App 的安装路径" : "Manage CLI and App installation paths"}</p></div>
            <div className="space-y-2 py-3">
              {(["cli", "app"] as const).map((kind) => { const status = toolStatuses.find((item) => item.kind === kind); const title = kind === "cli" ? "CLI" : "App"; return <div key={kind} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-[#f7f8fa] px-4 py-3"><span className="text-[12px] font-medium text-neutral-700">{title}</span><Input value={toolDrafts[kind]} onChange={(event) => onToolDraftChange(kind, event.target.value)} placeholder={status?.detectedPath || (language === "zh" ? `请输入 Codex ${title} 路径` : `Enter Codex ${title} path`)} className="h-9 rounded-lg border-neutral-200 bg-white text-[13px] shadow-none" /><div className="responsive-actions"><IconActionButton icon={<Save className="size-4" />} label={language === "zh" ? "保存路径" : "Save path"} onClick={() => onToolSave(kind)} disabled={busy} /><IconActionButton icon={<RotateCcw className="size-4" />} label={language === "zh" ? "恢复自动检测" : "Use automatic detection"} onClick={() => onToolReset(kind)} disabled={busy} /></div></div>; })}
            </div>
          </div>
        </ListCard>

        <OperationCard
          title={pageCopy.operations.proxyTitle}
          subtitle={pageCopy.operations.proxyPlaceholder}
        >
          <div data-settings-row="proxy" className="responsive-operation-controls rounded-xl bg-[#f7f8fa] px-4 py-3">
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
          <div data-settings-row="logs" className="responsive-operation-controls rounded-xl bg-[#f7f8fa] px-4 py-3">
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

    </ListPageFrame>
  );
}
