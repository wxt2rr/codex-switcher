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
  RunStatusBadge,
} from "../components/account-list-primitives";
import { Field, Input, Select } from "../components/form-primitives";
import type { OverviewPayload } from "../desktop-model";
import { getDesktopCopy } from "../desktop-copy";
import { localizeLogKind } from "../desktop-utils";
import type { UiLanguage } from "../i18n";
import type { CodexToolStatus } from "../bridge";

function pageTitle(language: UiLanguage) {
  if (language === "zh") return "运行操作";
  if (language === "ja") return "操作";
  return "Operations";
}

function pageSubtitle(language: UiLanguage) {
  if (language === "zh") return "管理代理、守护任务、App 状态和诊断工具";
  if (language === "ja") return "プロキシ、ガード、App 状態、診断を管理";
  return "Manage proxy, guards, App status, and diagnostics";
}

function OperationCard({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <ListCard className="responsive-record-row responsive-operation-row grid min-h-[106px] items-center gap-5">
      <div className="flex min-w-0 items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">{title}</h3>
            {badge ? <RunStatusBadge label={badge} tone="success" /> : null}
          </div>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="min-w-0 border-l border-neutral-200/70 pl-5 dark:border-white/[0.08]">{children}</div>
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
  onToolDetect,
  onToolSave,
  onToolReset,
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
  onToolDetect: () => void;
  onToolSave: (kind: "cli" | "app") => void;
  onToolReset: (kind: "cli" | "app") => void;
}) {
  const pageCopy = getDesktopCopy(language);

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
        {(["cli", "app"] as const).map((kind) => {
          const status = toolStatuses.find((item) => item.kind === kind);
          const title = kind === "cli" ? "Codex CLI" : "Codex App";
          const available = status?.available ?? false;
          return (
            <OperationCard
              key={kind}
              title={title}
              subtitle={language === "zh" ? `${title} 安装路径，支持自动检测和手动设置` : `${title} installation path with automatic detection and manual override`}
              badge={available ? (status?.source === "manual" ? (language === "zh" ? "手动设置" : "Manual") : (language === "zh" ? "已检测" : "Detected")) : (language === "zh" ? "未检测到" : "Missing")}
            >
              <div className="responsive-operation-controls">
                <Input
                  value={toolDrafts[kind]}
                  onChange={(event) => onToolDraftChange(kind, event.target.value)}
                  placeholder={status?.detectedPath || (language === "zh" ? `请输入 ${title} 安装目录或可执行文件路径` : `Enter ${title} installation directory or executable`)}
                  className="h-9 rounded-lg border-neutral-200 bg-white text-[13px] shadow-none dark:border-white/[0.08] dark:bg-[#161c24]"
                />
                <div className="responsive-actions">
                  <IconActionButton icon={<RefreshCw className="size-4" />} label={language === "zh" ? "重新检测" : "Detect again"} onClick={onToolDetect} disabled={busy} />
                  <IconActionButton icon={<Save className="size-4" />} label={language === "zh" ? "保存路径" : "Save path"} onClick={() => onToolSave(kind)} disabled={busy} />
                  <IconActionButton icon={<RotateCcw className="size-4" />} label={language === "zh" ? "恢复自动检测" : "Use automatic detection"} onClick={() => onToolReset(kind)} disabled={busy} />
                </div>
              </div>
            </OperationCard>
          );
        })}

        <OperationCard
          title={pageCopy.operations.proxyTitle}
          subtitle={pageCopy.operations.proxyPlaceholder}
          badge={pageCopy.operations.proxyTitle}
        >
          <div className="responsive-operation-controls">
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
          badge={localizeLogKind(logKind, language)}
        >
          <div className="responsive-operation-controls responsive-operation-controls-narrow">
            <Field label={pageCopy.operations.logKind}>
              <Select
                value={logKind}
                onValueChange={onLogKindChange}
                items={[
                  { value: "switcher", label: localizeLogKind("switcher", language) },
                  { value: "token-refresh", label: localizeLogKind("token-refresh", language) },
                ]}
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
