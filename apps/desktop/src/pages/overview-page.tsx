import { Monitor, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  IconActionButton,
  ListCard,
  ListPageFrame,
  ListPageHeader,
  ListStack,
  Pager,
  RunStatusBadge,
  SoftBadge,
} from "../components/account-list-primitives";
import type { OverviewPayload, TargetStatus } from "../desktop-model";
import { getDesktopCopy } from "../desktop-copy";
import { localizeGuard, localizeLoginState } from "../desktop-utils";
import type { UiLanguage } from "../i18n";

function pageTitle(language: UiLanguage) {
  if (language === "zh") return "总览";
  if (language === "ja") return "概要";
  return "Overview";
}

function pageSubtitle(language: UiLanguage) {
  if (language === "zh") return "查看当前 CLI / App 指向、认证状态和守护任务";
  if (language === "ja") return "CLI / App の現在状態、認証、ガードを確認";
  return "Review current CLI / App targets, auth state, and guards";
}

function StatusTargetCard({
  target,
  label,
  icon,
  language,
  status,
  authExpiryLabel,
  loading,
  loadingLabel,
  busy,
  onKeepCurrent,
}: {
  target: "cli" | "app";
  label: string;
  icon: React.ReactNode;
  language: UiLanguage;
  status: TargetStatus;
  authExpiryLabel: string;
  loading: boolean;
  loadingLabel: string;
  busy: boolean;
  onKeepCurrent?: () => void;
}) {
  const isLoggedIn = status.loginState === "logged-in";
  const usesApiKey = Boolean(status.apiKeyPreview);

  return (
    <ListCard className="responsive-record-row responsive-overview-row grid min-h-[110px] items-center gap-5">
      <div className="flex min-w-0 items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{label}</h3>
            <RunStatusBadge
              label={localizeLoginState(status.loginState, language)}
              tone={isLoggedIn ? "success" : "warn"}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SoftBadge tone="brand" label={target.toUpperCase()} />
            <SoftBadge tone="neutral" label={usesApiKey ? "API KEY" : "AUTH"} />
          </div>
        </div>
      </div>

      <div className="responsive-priority-tertiary min-w-0 border-l border-neutral-200/70 pl-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{language === "zh" ? "当前对象" : "Current"}</div>
        <div className="mt-2 truncate text-[14px] font-semibold text-neutral-950">{status.current}</div>
        <div className="mt-1 truncate text-[12px] text-slate-500">
          {status.email ?? (loading ? loadingLabel : "-")}
        </div>
      </div>

      <div className="responsive-priority-secondary min-w-0 border-l border-neutral-200/70 pl-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{language === "zh" ? "认证" : "Auth"}</div>
        <div className="mt-2 truncate text-[14px] font-medium text-neutral-950">{status.auth}</div>
        <div className="mt-1 truncate text-[12px] text-slate-500">
          {authExpiryLabel}: {status.authExpiry}
        </div>
      </div>

      <div className="responsive-actions">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-slate-700"
          aria-label={language === "zh" ? "认证状态" : "Auth state"}
          title={language === "zh" ? "认证状态" : "Auth state"}
        >
          <ShieldCheck className="size-5" />
        </button>
        <IconActionButton
          icon={icon}
          label={language === "zh" ? "保持当前" : "Keep"}
          onClick={onKeepCurrent}
          disabled={busy || !onKeepCurrent}
          active
        />
      </div>
    </ListCard>
  );
}

export function OverviewPage({
  overview,
  language,
  authMetricsLoading,
  loadingLabel,
  reloginLabel,
  authExpiryLabel,
  activeAccountsLabel,
  refreshLabel,
  busy,
  onRefresh,
  onSwitchEnv,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  authMetricsLoading: boolean;
  loadingLabel: string;
  reloginLabel: string;
  authExpiryLabel: string;
  activeAccountsLabel: string;
  refreshLabel: string;
  busy: boolean;
  onRefresh: () => void;
  onSwitchEnv: (target: "cli" | "app", envName: string) => void;
}) {
  const pageCopy = getDesktopCopy(language);
  const activeAccounts = overview.accounts.filter((account) => account.isCurrentCli || account.isCurrentApp);
  const cliUsesApiKey = Boolean(overview.status.cli.apiKeyPreview);
  const appUsesApiKey = Boolean(overview.status.app.apiKeyPreview);
  const cliLoading = !cliUsesApiKey && authMetricsLoading && !overview.status.cli.usage5h;
  const appLoading = !appUsesApiKey && authMetricsLoading && !overview.status.app.usage5h;
  const cliEnv = overview.envs.find((env) => env.isCurrentCli);
  const appEnv = overview.envs.find((env) => env.isCurrentApp);

  return (
    <ListPageFrame>
      <ListPageHeader
        title={pageTitle(language)}
        subtitle={pageSubtitle(language)}
        actions={
          <Button
            variant="outline"
            onClick={onRefresh}
            disabled={busy}
            className="h-9 rounded-lg border-neutral-200 bg-white px-4 text-[12px] shadow-none"
          >
            <RefreshCw className="size-4" />
            {busy ? pageCopy.common.refreshing : refreshLabel}
          </Button>
        }
      />

      <div className="grid divide-y divide-black/[0.06] rounded-[14px] border border-black/[0.05] bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-3">
          <div className="text-[12px] font-medium text-slate-500">{pageCopy.overview.guard}</div>
          <div className="mt-1 text-[20px] font-semibold text-neutral-950">
            {localizeGuard(overview.status.tokenRefresh.guard, language)}
          </div>
        </div>
        <div className="px-5 py-3">
          <div className="text-[12px] font-medium text-slate-500">{reloginLabel}</div>
          <div className="mt-1 text-[20px] font-semibold text-neutral-950">{overview.status.tokenRefresh.needReloginLastRun}</div>
        </div>
        <div className="px-5 py-3">
          <div className="text-[12px] font-medium text-slate-500">{activeAccountsLabel}</div>
          <div className="mt-1 text-[20px] font-semibold text-neutral-950">{activeAccounts.length}</div>
        </div>
      </div>

      <ListStack>
        <StatusTargetCard
          target="cli"
          icon={<TerminalSquare className="size-4" />}
          label={pageCopy.overview.cliLabel}
          language={language}
          status={overview.status.cli}
          authExpiryLabel={authExpiryLabel}
          loading={cliLoading}
          loadingLabel={loadingLabel}
          busy={busy}
          onKeepCurrent={cliEnv ? () => onSwitchEnv("cli", cliEnv.name) : undefined}
        />
        <StatusTargetCard
          target="app"
          icon={<Monitor className="size-4" />}
          label={pageCopy.overview.appLabel}
          language={language}
          status={overview.status.app}
          authExpiryLabel={authExpiryLabel}
          loading={appLoading}
          loadingLabel={loadingLabel}
          busy={busy}
          onKeepCurrent={appEnv ? () => onSwitchEnv("app", appEnv.name) : undefined}
        />
      </ListStack>

      <Pager totalLabel={language === "zh" ? `共 ${activeAccounts.length} 个当前账号` : `${activeAccounts.length} active accounts`} />
    </ListPageFrame>
  );
}
