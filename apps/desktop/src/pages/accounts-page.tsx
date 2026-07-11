import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleHelp,
  Check,
  Command,
  Copy,
  ChevronDown,
  Eye,
  EyeOff,
  Ellipsis,
  Monitor,
  Pencil,
  Plus,
  Search,
  RefreshCw,
  Settings2,
  TerminalSquare,
} from "lucide-react";

import {
  formatUsageResetHint,
  getUsageProgressClass,
  localizeUsageMetricLabel,
  parseUsageMetric,
} from "@/account-usage";
import { Button } from "@/components/ui/button";
import { useAdaptiveMenuPlacement } from "@/components/adaptive-menu-placement";
import { cn } from "@/lib/utils";
import {
  ConfirmDialog,
  SidePanel,
} from "../components/admin-primitives";
import { Field, Input, Select, Textarea } from "../components/form-primitives";
import type { AccountSummary, OverviewPayload } from "../desktop-model";
import type { CodexProject, DesktopLaunchStrategy } from "../bridge";
import { getDesktopCopy } from "../desktop-copy";
import { localizeAuthMode } from "../desktop-utils";
import { getTranslations, type UiLanguage } from "../i18n";

function formatAccountAuthLabel(mode: string) {
  if (mode === "apikey") {
    return "API KEY";
  }
  if (mode === "sub2api") {
    return "SUB2API";
  }
  if (mode === "auth") {
    return "AUTH";
  }
  return mode.toUpperCase();
}

function getModelConfigHint(language: UiLanguage) {
  if (language === "zh") {
    return "Codex 的授权和模型消耗彼此独立。你可以登录自己的 ChatGPT 账号使用远程、插件等能力，同时单独配置 API Key 作为模型调用与计费来源。";
  }
  if (language === "ja") {
    return "Codex の認証とモデル課金は独立しています。ChatGPT アカウントでリモートやプラグインを使いながら、モデル消費だけ別の API Key に分けて設定できます。";
  }
  return "Codex auth and model billing are independent. You can sign in with your own ChatGPT account for remote and plugins, while routing model usage through a separate API key.";
}

function getModelProviderHint(language: UiLanguage) {
  if (language === "zh") {
    return "Codex 会按 Model Provider 隔离会话。想让不同账号共享同一组对话上下文，请配置相同的 provider；留空时默认使用 custom。";
  }
  if (language === "ja") {
    return "Codex は Model Provider ごとに会話を分離します。アカウント間で同じ会話文脈を共有したい場合は同じ provider を設定してください。未設定時は custom になります。";
  }
  return "Codex isolates conversations by model provider. Use the same provider across accounts if you want them to share session context. When unset, it defaults to custom.";
}

function getApiUsageHint(language: UiLanguage) {
  if (language === "zh") return "由上游服务商计费，不展示远程用量。";
  if (language === "ja") return "上流プロバイダー課金のため、ここでは使用量を表示しません。";
  return "Billed upstream. Remote usage is not shown here.";
}

export function AccountsPage({
  overview,
  language,
  authMetricsLoading,
  authRefreshIntervalSeconds,
  loadingLabel,
  busy,
  accountEnvDraft,
  accountNameDraft,
  accountTargetDraft,
  accountModeDraft,
  accountApiKeyDraft,
  accountBaseUrlModeDraft,
  accountBaseUrlDraft,
  accountSub2ApiDraft,
  runtimeEnvDraft,
  runtimeAccountDraft,
  runtimeBaseUrlDraft,
  onAccountEnvDraftChange,
  onAuthRefreshIntervalChange,
  onRefreshAuthMetrics,
  onAccountNameDraftChange,
  onAccountModeDraftChange,
  onAccountApiKeyDraftChange,
  onAccountBaseUrlModeDraftChange,
  onAccountBaseUrlDraftChange,
  onAccountSub2ApiDraftChange,
  onRuntimeEnvDraftChange,
  onRuntimeAccountDraftChange,
  onRuntimeBaseUrlDraftChange,
  onSwitchAccount,
  onListAccountProjects,
  onPickDirectory,
  onPrimeAccount,
  onLogin,
  onRelogin,
  onLogout,
  onDeleteAccount,
  onUpdateRuntime,
  onUpdateIndependentModel,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  authMetricsLoading: boolean;
  authRefreshIntervalSeconds: number;
  loadingLabel: string;
  busy: boolean;
  accountEnvDraft: string;
  accountNameDraft: string;
  accountTargetDraft: string;
  accountModeDraft: string;
  accountApiKeyDraft: string;
  accountBaseUrlModeDraft: string;
  accountBaseUrlDraft: string;
  accountSub2ApiDraft: string;
  runtimeEnvDraft: string;
  runtimeAccountDraft: string;
  runtimeBaseUrlDraft: string;
  onAccountEnvDraftChange: (value: string) => void;
  onAuthRefreshIntervalChange: (seconds: number) => void;
  onRefreshAuthMetrics: () => void;
  onAccountNameDraftChange: (value: string) => void;
  onAccountModeDraftChange: (value: string) => void;
  onAccountApiKeyDraftChange: (value: string) => void;
  onAccountBaseUrlModeDraftChange: (value: string) => void;
  onAccountBaseUrlDraftChange: (value: string) => void;
  onAccountSub2ApiDraftChange: (value: string) => void;
  onRuntimeEnvDraftChange: (value: string) => void;
  onRuntimeAccountDraftChange: (value: string) => void;
  onRuntimeBaseUrlDraftChange: (value: string) => void;
  onSwitchAccount: (
    target: "cli" | "app",
    account: AccountSummary,
    strategy?: DesktopLaunchStrategy,
    workingDirectory?: string,
  ) => void;
  onListAccountProjects: (account: AccountSummary) => Promise<CodexProject[]>;
  onPickDirectory: () => Promise<string>;
  onPrimeAccount: (account?: AccountSummary) => void;
  onLogin: () => Promise<boolean>;
  onRelogin: () => Promise<boolean>;
  onLogout: () => void;
  onDeleteAccount: () => void;
  onUpdateRuntime: () => Promise<boolean>;
  onUpdateIndependentModel: (
    account: AccountSummary,
    enabled: boolean,
    providerId: string,
    apiKey: string,
    baseUrl: string,
  ) => Promise<boolean>;
}) {
  const [envFilter, setEnvFilter] = useState("default");
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recent");
  const [loginDrawerOpen, setLoginDrawerOpen] = useState(false);
  const [runtimeDrawerOpen, setRuntimeDrawerOpen] = useState(false);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [modelAccountKey, setModelAccountKey] = useState("");
  const [independentModelProviderIdDraft, setIndependentModelProviderIdDraft] = useState("custom");
  const [independentModelApiKeyDraft, setIndependentModelApiKeyDraft] = useState("");
  const [independentModelBaseUrlDraft, setIndependentModelBaseUrlDraft] = useState("");
  const [showApiKeyDraft, setShowApiKeyDraft] = useState(false);
  const [customRefreshEditing, setCustomRefreshEditing] = useState(false);
  const [customRefreshDraft, setCustomRefreshDraft] = useState(String(authRefreshIntervalSeconds));
  const pageCopy = getDesktopCopy(language);
  const text = getTranslations(language);

  const filteredAccounts = useMemo(() => {
    return overview.accounts
      .filter((account) => {
        const matchesEnv = envFilter === "all" || account.envName === envFilter;
        const matchesMode = modeFilter === "all" || account.authMode === modeFilter;
        const matchesSearch =
          !search.trim() ||
          account.name.toLowerCase().includes(search.trim().toLowerCase()) ||
          account.envName.toLowerCase().includes(search.trim().toLowerCase()) ||
          (account.route?.originalBaseUrl ?? "").toLowerCase().includes(search.trim().toLowerCase()) ||
          (account.runtime.openaiBaseUrl ?? "").toLowerCase().includes(search.trim().toLowerCase());

        return matchesEnv && matchesMode && matchesSearch;
      })
      .slice()
      .sort((a, b) => {
        if (sortMode === "name") {
          return a.name.localeCompare(b.name);
        }
        const aCurrent = a.isCurrentCli || a.isCurrentApp ? 1 : 0;
        const bCurrent = b.isCurrentCli || b.isCurrentApp ? 1 : 0;
        if (aCurrent !== bCurrent) {
          return bCurrent - aCurrent;
        }
        return a.name.localeCompare(b.name);
      });
  }, [overview.accounts, envFilter, modeFilter, search, sortMode]);

  const selectedAccount = overview.accounts.find(
    (account) => account.envName === accountEnvDraft.trim() && account.name === accountNameDraft.trim(),
  );
  const runtimeAccounts = overview.accounts.filter((account) => account.envName === runtimeEnvDraft.trim());
  const modelConfigAccount = overview.accounts.find(
    (account) => `${account.envName}/${account.name}` === modelAccountKey,
  );

  const loginModeNeedsApiKey = accountModeDraft === "apikey";
  const loginModeNeedsSub2Api = accountModeDraft === "sub2api";
  const customBaseUrl = accountBaseUrlModeDraft === "custom";
  const selectedTargetLabel =
    accountTargetDraft === "both"
      ? text.labels.cliAndApp
      : accountTargetDraft === "app"
        ? text.labels.app
        : text.labels.cli;
  const refreshIntervalIsPreset = [1, 3, 5, 10].includes(authRefreshIntervalSeconds);

  function commitCustomRefreshInterval() {
    const value = Number(customRefreshDraft);
    if (!Number.isFinite(value)) {
      return;
    }
    onAuthRefreshIntervalChange(value);
    setCustomRefreshEditing(false);
  }

  useEffect(() => {
    if (!runtimeAccountDraft) {
      return;
    }
    if (runtimeAccounts.some((account) => account.name === runtimeAccountDraft)) {
      return;
    }
    onRuntimeAccountDraftChange("");
  }, [runtimeAccountDraft, runtimeAccounts, onRuntimeAccountDraftChange]);

  useEffect(() => {
    if (!modelConfigAccount) {
      return;
    }
    setIndependentModelProviderIdDraft(modelConfigAccount.runtime.independentModelProviderId ?? "custom");
    setIndependentModelApiKeyDraft(modelConfigAccount.runtime.independentModelApiKey ?? "");
    setIndependentModelBaseUrlDraft(modelConfigAccount.runtime.independentModelBaseUrl ?? "");
  }, [modelConfigAccount]);

  useEffect(() => {
    if (!loginDrawerOpen) {
      setShowApiKeyDraft(false);
    }
  }, [loginDrawerOpen]);

  return (
    <section className="h-full min-h-0 overflow-hidden px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8">
      <div className="admin-page-content flex h-full w-full flex-col gap-3">
        <div className="shrink-0 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950">
                {language === "zh" ? "账号管理" : language === "ja" ? "アカウント管理" : "Account Management"}
              </h2>
              <p className="text-[13px] leading-6 text-slate-500">
                {language === "zh" ? "统一管理 ChatGPT 授权、API Key、独立模型和运行时配置。" : language === "ja" ? "ChatGPT 認証、API Key、独立モデル、ランタイム設定をまとめて管理します。" : "Manage ChatGPT auth, API keys, independent models, and runtime settings in one place."}
              </p>
            </div>
          </div>

          <div className="rounded-[18px] bg-white px-3 py-2.5 ring-1 ring-black/[0.04] shadow-[0_10px_30px_rgba(15,23,42,0.03)]">
            <div className="responsive-toolbar flex items-center gap-2.5">
              <div className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#f3f4f6] px-3 text-[12px] font-medium text-slate-500">
                <Command className="size-3.5" />
                K
              </div>
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={language === "zh" ? "搜索账号、环境或 Base URL" : pageCopy.accounts.searchPlaceholder}
                className="h-8 rounded-lg border-transparent bg-[#fbfbfc] pl-10 text-[12px] shadow-none"
                />
              </div>
              <Select
                value={envFilter}
                onValueChange={setEnvFilter}
                items={[
                  { value: "all", label: pageCopy.accounts.allEnvironments },
                  ...overview.envs.map((env) => ({ value: env.name, label: env.name })),
                ]}
                className="h-8 w-[128px] rounded-lg border-transparent bg-[#fbfbfc] px-3 text-[12px] shadow-none"
              />
              <Select
                value={modeFilter}
                onValueChange={setModeFilter}
                items={[
                  { value: "all", label: pageCopy.accounts.allModes },
                  { value: "apikey", label: localizeAuthMode("apikey", language) },
                  { value: "auth", label: localizeAuthMode("auth", language) },
                  { value: "sub2api", label: localizeAuthMode("sub2api", language) },
                ]}
                className="h-8 w-[128px] rounded-lg border-transparent bg-[#fbfbfc] px-3 text-[12px] shadow-none"
              />
              <Select
                value={sortMode}
                onValueChange={setSortMode}
                items={[
                  { value: "recent", label: language === "zh" ? "最近使用" : "Recently used" },
                  { value: "name", label: language === "zh" ? "名称排序" : "By name" },
                ]}
                className="h-8 w-[128px] rounded-lg border-transparent bg-[#fbfbfc] px-3 text-[12px] shadow-none"
              />
              <div className="flex h-8 items-center overflow-hidden rounded-lg bg-[#f3f4f6]">
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center text-slate-500 transition hover:bg-[#ebeef2] hover:text-neutral-800 disabled:cursor-wait"
                  aria-label={language === "zh" ? "立即刷新用量" : "Refresh usage now"}
                  title={language === "zh" ? "立即刷新用量" : "Refresh usage now"}
                  onClick={onRefreshAuthMetrics}
                  disabled={authMetricsLoading}
                >
                  <RefreshCw className={cn("size-3.5", authMetricsLoading && "animate-spin")} />
                </button>
                {customRefreshEditing ? (
                  <div className="flex items-center border-l border-black/[0.05]">
                    <Input
                      data-auth-refresh-input
                      type="number"
                      min={1}
                      max={3600}
                      value={customRefreshDraft}
                      onChange={(event) => setCustomRefreshDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitCustomRefreshInterval();
                        if (event.key === "Escape") setCustomRefreshEditing(false);
                      }}
                      aria-label={language === "zh" ? "自定义刷新秒数" : "Custom refresh seconds"}
                      title={language === "zh" ? "自定义刷新秒数" : "Custom refresh seconds"}
                      className="h-8 w-[44px] rounded-none bg-transparent px-1.5 text-[12px] shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="flex h-8 w-7 items-center justify-center text-slate-500 hover:text-neutral-900"
                      onClick={commitCustomRefreshInterval}
                      aria-label={language === "zh" ? "应用刷新频率" : "Apply refresh interval"}
                      title={language === "zh" ? "应用刷新频率" : "Apply refresh interval"}
                    >
                      <Check className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <Select
                    value={refreshIntervalIsPreset ? String(authRefreshIntervalSeconds) : "custom"}
                    onValueChange={(value) => {
                      if (value === "custom") {
                        setCustomRefreshDraft(String(authRefreshIntervalSeconds));
                        setCustomRefreshEditing(true);
                        return;
                      }
                      onAuthRefreshIntervalChange(Number(value));
                    }}
                    items={[
                      { value: "1", label: "1s" },
                      { value: "3", label: "3s" },
                      { value: "5", label: "5s" },
                      { value: "10", label: "10s" },
                      {
                        value: "custom",
                        label: refreshIntervalIsPreset
                          ? language === "zh" ? "自定义" : "Custom"
                          : `${authRefreshIntervalSeconds}s`,
                      },
                    ]}
                    className="h-8 w-[64px] rounded-none border-l border-black/[0.05] bg-transparent px-2 text-[12px] shadow-none"
                  />
                )}
              </div>
              <Button
                className="ml-auto h-8 rounded-lg bg-neutral-950 px-3.5 text-[12px] font-semibold text-white shadow-none hover:bg-neutral-800"
                onClick={() => {
                  onPrimeAccount(undefined);
                  setLoginDrawerOpen(true);
                }}
                disabled={busy}
              >
                <Plus className="size-3.5" />
                {language === "zh" ? "添加账号" : language === "ja" ? "アカウント追加" : "Add account"}
              </Button>
            </div>
          </div>
        </div>

        <div className="shrink-0 grid divide-y divide-black/[0.06] rounded-[14px] border border-black/[0.05] bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <StatCard
            label={language === "zh" ? "账号总数" : language === "ja" ? "アカウント総数" : "Accounts"}
            value={String(overview.accounts.length)}
            helper={language === "zh" ? `${filteredAccounts.length} 条当前结果` : language === "ja" ? `${filteredAccounts.length} 件表示中` : `${filteredAccounts.length} shown`}
          />
          <StatCard
            label="CLI / App"
            value={`${overview.accounts.filter((account) => account.isCurrentCli).length} / ${overview.accounts.filter((account) => account.isCurrentApp).length}`}
            helper={language === "zh" ? "当前激活目标" : language === "ja" ? "現在の対象" : "Active targets"}
          />
          <StatCard
            label={language === "zh" ? "授权模式" : language === "ja" ? "認証モード" : "Auth mix"}
            value={`${overview.accounts.filter((account) => account.authMode === "auth").length} AUTH`}
            helper={language === "zh" ? `${overview.accounts.filter((account) => account.authMode === "apikey").length} API Key / ${overview.accounts.filter((account) => account.authMode === "sub2api").length} sub2api` : language === "ja" ? `${overview.accounts.filter((account) => account.authMode === "apikey").length} API Key / ${overview.accounts.filter((account) => account.authMode === "sub2api").length} sub2api` : `${overview.accounts.filter((account) => account.authMode === "apikey").length} API Key / ${overview.accounts.filter((account) => account.authMode === "sub2api").length} sub2api`}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-black/[0.05] bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
          {filteredAccounts.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm font-medium text-neutral-500">
              {overview.accounts.length === 0 ? pageCopy.accounts.emptyListTitle : pageCopy.accounts.emptyFilterTitle}
            </div>
          ) : null}
          {filteredAccounts.map((account, index) => (
            <AccountListCard
              key={`${account.envName}/${account.name}`}
              account={account}
              index={index}
              language={language}
              busy={busy}
              pageCopy={pageCopy}
              authMetricsLoading={authMetricsLoading}
              loadingLabel={loadingLabel}
              isWindowsDesktop={/win/i.test(globalThis.navigator?.platform ?? "")}
              onPrimeAccount={onPrimeAccount}
              onSwitchAccount={onSwitchAccount}
              onListAccountProjects={onListAccountProjects}
              onPickDirectory={onPickDirectory}
              onLogin={() => setLoginDrawerOpen(true)}
              onRelogin={onRelogin}
              onLogoutIntent={() => setLogoutOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              onModelConfig={() => {
                setModelAccountKey(`${account.envName}/${account.name}`);
                setModelConfigOpen(true);
              }}
            />
          ))}
          </div>
        </div>
      </div>

      <SidePanel
        open={loginDrawerOpen}
        title={
          selectedAccount
            ? language === "zh"
              ? "编辑账号"
              : language === "ja"
                ? "アカウント編集"
                : "Edit account"
            : pageCopy.accounts.loginTitle
        }
        onClose={() => setLoginDrawerOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Select
              value={accountEnvDraft}
              onValueChange={onAccountEnvDraftChange}
              items={overview.envs.map((env) => ({ value: env.name, label: env.name }))}
              placeholder={text.inputs.envName}
            />
          </Field>
          <Field label={pageCopy.common.account}>
            <Input value={accountNameDraft} onChange={(event) => onAccountNameDraftChange(event.target.value)} placeholder={text.inputs.accountName} />
          </Field>
          <div className="grid gap-3">
            <Field label={pageCopy.accounts.mode}>
              <Select
                value={accountModeDraft}
                onValueChange={onAccountModeDraftChange}
                items={[
                  { value: "auth", label: localizeAuthMode("auth", language) },
                  { value: "apikey", label: localizeAuthMode("apikey", language) },
                  { value: "sub2api", label: localizeAuthMode("sub2api", language) },
                ]}
              />
            </Field>
          </div>
          {loginModeNeedsApiKey ? (
            <Field label={pageCopy.accounts.apiKey}>
              <div className="relative">
                <Input
                  type={showApiKeyDraft ? "text" : "password"}
                  value={accountApiKeyDraft}
                  onChange={(event) => onAccountApiKeyDraftChange(event.target.value)}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-[#eef1f4] hover:text-neutral-700"
                  onClick={() => setShowApiKeyDraft((value) => !value)}
                  aria-label={
                    showApiKeyDraft
                      ? language === "zh"
                        ? "隐藏 API Key"
                        : language === "ja"
                          ? "API Key を隠す"
                          : "Hide API key"
                      : language === "zh"
                        ? "显示 API Key"
                        : language === "ja"
                          ? "API Key を表示"
                          : "Show API key"
                  }
                  title={
                    showApiKeyDraft
                      ? language === "zh"
                        ? "隐藏 API Key"
                        : language === "ja"
                          ? "API Key を隠す"
                          : "Hide API key"
                      : language === "zh"
                        ? "显示 API Key"
                        : language === "ja"
                          ? "API Key を表示"
                          : "Show API key"
                  }
                >
                  {showApiKeyDraft ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
          ) : null}
          <Field label={pageCopy.accounts.baseUrlMode}>
            <Select
              value={accountBaseUrlModeDraft}
              onValueChange={onAccountBaseUrlModeDraftChange}
              items={[
                { value: "default", label: pageCopy.accounts.defaultValue },
                { value: "custom", label: pageCopy.accounts.custom },
              ]}
            />
          </Field>
          {customBaseUrl ? (
            <Field label={pageCopy.accounts.baseUrlLabel}>
              <Input
                value={accountBaseUrlDraft}
                onChange={(event) => onAccountBaseUrlDraftChange(event.target.value)}
                placeholder={text.inputs.baseUrl}
              />
            </Field>
          ) : null}
          {loginModeNeedsSub2Api ? (
            <Field label={pageCopy.accounts.sub2api}>
              <Textarea value={accountSub2ApiDraft} onChange={(event) => onAccountSub2ApiDraftChange(event.target.value)} placeholder='{"apiKey":"..."}' />
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              onClick={async () => {
                if (await onLogin()) {
                  setLoginDrawerOpen(false);
                }
              }}
              disabled={busy}
              className="sm:col-span-2"
            >
              {selectedAccount
                ? language === "zh"
                  ? "保存并更新"
                  : language === "ja"
                    ? "保存して更新"
                    : "Save changes"
                : accountModeDraft === "apikey"
                  ? language === "zh" ? "保存 API Key" : language === "ja" ? "API Key を保存" : "Save API Key"
                  : accountModeDraft === "sub2api"
                    ? language === "zh" ? "保存 sub2api" : language === "ja" ? "sub2api を保存" : "Save sub2api"
                    : language === "zh" ? "授权登录" : language === "ja" ? "認証ログイン" : "Authorize login"}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={runtimeDrawerOpen}
        title={pageCopy.accounts.runtimeTitle}
        onClose={() => setRuntimeDrawerOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Select
              value={runtimeEnvDraft}
              onValueChange={onRuntimeEnvDraftChange}
              items={overview.envs.map((env) => ({ value: env.name, label: env.name }))}
              placeholder={text.inputs.envName}
            />
          </Field>
          <Field label={pageCopy.common.account}>
            <Select
              value={runtimeAccountDraft}
              onValueChange={onRuntimeAccountDraftChange}
              items={runtimeAccounts.map((account) => ({ value: account.name, label: account.name }))}
              placeholder={text.inputs.accountName}
            />
          </Field>
          <Field label={pageCopy.accounts.baseUrlLabel}>
            <Input
              value={runtimeBaseUrlDraft}
              onChange={(event) => onRuntimeBaseUrlDraftChange(event.target.value)}
              placeholder={text.inputs.baseUrl}
            />
          </Field>
          <Button
            className="w-full"
            onClick={async () => {
              if (await onUpdateRuntime()) {
                setRuntimeDrawerOpen(false);
              }
            }}
            disabled={busy}
          >
            {pageCopy.accounts.runtimeAction}
          </Button>
        </div>
      </SidePanel>

      <SidePanel
        open={modelConfigOpen}
        title={pageCopy.accounts.modelConfigTitle}
        description={pageCopy.accounts.modelConfigDescription}
        onClose={() => setModelConfigOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Input value={modelConfigAccount?.envName ?? ""} disabled />
          </Field>
          <Field label={pageCopy.common.account}>
            <Input value={modelConfigAccount?.name ?? ""} disabled />
          </Field>
          <Field
            label={
              <div className="flex items-center gap-1.5">
                <span>{pageCopy.accounts.modelProvider}</span>
                <TooltipHint text={getModelProviderHint(language)} />
              </div>
            }
          >
            <Input
              value={independentModelProviderIdDraft}
              onChange={(event) => setIndependentModelProviderIdDraft(event.target.value)}
              placeholder="custom"
            />
          </Field>
          <Field label={pageCopy.accounts.modelApiKey}>
            <Input
              value={independentModelApiKeyDraft}
              onChange={(event) => setIndependentModelApiKeyDraft(event.target.value)}
              placeholder="sk-..."
            />
          </Field>
          <Field label={pageCopy.accounts.modelBaseUrl}>
            <Input
              value={independentModelBaseUrlDraft}
              onChange={(event) => setIndependentModelBaseUrlDraft(event.target.value)}
              placeholder={text.inputs.baseUrl}
            />
          </Field>
          <Button
            className="w-full"
            onClick={async () => {
              if (!modelConfigAccount) {
                return;
              }
              if (
                await onUpdateIndependentModel(
                  modelConfigAccount,
                  true,
                  independentModelProviderIdDraft,
                  independentModelApiKeyDraft,
                  independentModelBaseUrlDraft,
                )
              ) {
                setModelConfigOpen(false);
              }
            }}
            disabled={busy || !modelConfigAccount}
          >
            {pageCopy.environments.save}
          </Button>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={logoutOpen}
        title={pageCopy.accounts.logoutTitle}
        impact={
          selectedAccount ? (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.account}</span>
                <span className="font-medium text-neutral-700">{selectedAccount.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.environment}</span>
                <span className="font-medium text-neutral-700">{selectedAccount.envName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.accounts.target}</span>
                <span className="font-medium text-neutral-700">{selectedTargetLabel}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.status}</span>
                <span className="font-medium text-neutral-700">
                  {selectedAccount.isCurrentCli || selectedAccount.isCurrentApp
                    ? `${selectedAccount.isCurrentCli ? `${text.labels.cli} ` : ""}${selectedAccount.isCurrentApp ? text.labels.app : ""}`.trim()
                    : pageCopy.common.standby}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">{pageCopy.accounts.logoutMissing}</div>
          )
        }
        confirmLabel={pageCopy.accounts.logoutConfirm}
        cancelLabel={pageCopy.common.cancel}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          void onLogout();
          setLogoutOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={pageCopy.accounts.deleteTitle}
        impact={
          selectedAccount ? (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.account}</span>
                <span className="font-medium text-neutral-700">{selectedAccount.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.environment}</span>
                <span className="font-medium text-neutral-700">{selectedAccount.envName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.status}</span>
                <span className="font-medium text-neutral-700">
                  {selectedAccount.isCurrentCli || selectedAccount.isCurrentApp
                    ? `${selectedAccount.isCurrentCli ? `${text.labels.cli} ` : ""}${selectedAccount.isCurrentApp ? text.labels.app : ""}`.trim()
                    : pageCopy.common.standby}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">{pageCopy.accounts.deleteMissing}</div>
          )
        }
        confirmLabel={pageCopy.accounts.deleteConfirm}
        cancelLabel={pageCopy.common.cancel}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDeleteAccount();
          setDeleteOpen(false);
        }}
      />
    </section>
  );
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[16px] bg-white px-5 py-3.5 ring-1 ring-black/[0.04] shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-neutral-950 [font-variant-numeric:tabular-nums]">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{helper}</div>
    </div>
  );
}

function AccountListCard({
  account,
  index,
  language,
  busy,
  pageCopy,
  authMetricsLoading,
  loadingLabel,
  isWindowsDesktop,
  onPrimeAccount,
  onSwitchAccount,
  onListAccountProjects,
  onPickDirectory,
  onLogin,
  onRelogin,
  onLogoutIntent,
  onDelete,
  onModelConfig,
}: {
  account: AccountSummary;
  index: number;
  language: UiLanguage;
  busy: boolean;
  pageCopy: ReturnType<typeof getDesktopCopy>;
  authMetricsLoading: boolean;
  loadingLabel: string;
  isWindowsDesktop: boolean;
  onPrimeAccount: (account?: AccountSummary) => void;
  onSwitchAccount: (
    target: "cli" | "app",
    account: AccountSummary,
    strategy?: DesktopLaunchStrategy,
    workingDirectory?: string,
  ) => void;
  onListAccountProjects: (account: AccountSummary) => Promise<CodexProject[]>;
  onPickDirectory: () => Promise<string>;
  onLogin: () => void;
  onRelogin: () => Promise<boolean>;
  onLogoutIntent: () => void;
  onDelete: () => void;
  onModelConfig: () => void;
}) {
  const isAuth = account.authMode === "auth";
  const baseUrl = account.route?.originalBaseUrl?.trim() || account.runtime.openaiBaseUrl?.trim() || "";
  const envLabel =
    account.envName === "default"
      ? language === "zh"
        ? "默认环境"
        : language === "ja"
          ? "デフォルト環境"
          : "Default env"
      : account.envName;

  return (
    <article
      className={cn(
        "responsive-record-row responsive-account-row grid min-h-[92px] items-start gap-4 border-t border-black/[0.04] px-5 py-4 transition",
        index === 0 ? "border-t-transparent" : "",
        index % 2 === 0 ? "bg-white" : "bg-[#fbfbfc]",
        "hover:bg-[#f7f8fa]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <AvatarTile name={account.name} index={index} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{account.name}</h3>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <SoftBadge tone={isAuth ? "brand" : "neutral"} label={formatAccountAuthLabel(account.authMode)} />
            <SoftBadge tone="neutral" label={envLabel} />
            {account.route?.enabled ? (
              <SoftBadge
                tone="success"
                label={language === "zh" ? "已开启代理" : language === "ja" ? "プロキシ有効" : "Routed"}
                title={account.route?.localBaseUrl}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="responsive-priority-tertiary min-w-0">
        <div className="account-runtime-cell min-h-[52px] px-2 py-2">
          <div className="min-w-0">
            {baseUrl ? (
              <span className="block truncate text-[14px] font-medium text-neutral-950 [font-variant-numeric:tabular-nums]">{baseUrl}</span>
            ) : (
              <span className="block truncate text-[12px] text-slate-400">
                {language === "zh" ? "未配置 Base URL" : language === "ja" ? "Base URL 未設定" : "Base URL not set"}
              </span>
            )}
          </div>
          <div className="account-runtime-actions">
            {baseUrl ? <Copy className="size-3.5 shrink-0 text-slate-400" /> : null}
            {isAuth ? <TooltipHint text={getModelConfigHint(language)} /> : null}
            {isAuth ? (
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-neutral-900"
                onClick={onModelConfig}
                disabled={busy}
                aria-label={pageCopy.accounts.modelConfigTitle}
                title={pageCopy.accounts.modelConfigTitle}
              >
                <Settings2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="responsive-priority-secondary min-w-0">
        {isAuth ? (
          <div className="px-2 py-2">
            <div className="space-y-1.5">
              <CardUsageRow
                label={pageCopy.overview.usage5hColumn}
                metric={parseUsageMetric(account.authProfile?.usage5h)}
                language={language}
                loading={authMetricsLoading && !account.authProfile}
                loadingLabel={loadingLabel}
              />
              <CardUsageRow
                label={language === "zh" ? "本周" : pageCopy.overview.usageWeeklyColumn}
                metric={parseUsageMetric(account.authProfile?.usageWeekly)}
                language={language}
                loading={authMetricsLoading && !account.authProfile}
                loadingLabel={loadingLabel}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-[52px] items-center px-3 py-2">
            <div className="text-[12px] leading-5 text-slate-500">{getApiUsageHint(language)}</div>
          </div>
        )}
      </div>

      <div className="responsive-actions min-h-full border-l border-black/[0.05] pl-4">
        <CardTargetButton
          active={account.isCurrentCli}
          disabled={busy}
          icon={<TerminalSquare className="size-4" />}
          label="CLI"
          primaryStrategy="new-window"
          items={
            isWindowsDesktop
              ? [
                  {
                    key: "new-window",
                    label:
                      language === "zh"
                        ? "新开窗口"
                        : language === "ja"
                          ? "新しいウィンドウ"
                          : "New window",
                  },
                ]
              : [
                  {
                    key: "current-window",
                    label:
                      language === "zh"
                        ? "当前窗口"
                        : language === "ja"
                          ? "現在のウィンドウ"
                          : "Current window",
                  },
                  {
                    key: "new-window",
                    label:
                      language === "zh"
                        ? "新开窗口"
                        : language === "ja"
                          ? "新しいウィンドウ"
                          : "New window",
                  },
                ]
          }
          onSelect={(strategy) => {
            onPrimeAccount(account);
            onSwitchAccount("cli", account, strategy);
          }}
          loadProjects={() => onListAccountProjects(account)}
          onSelectProject={(path) => {
            onPrimeAccount(account);
            onSwitchAccount("cli", account, "new-window", path);
          }}
          onPickDirectory={onPickDirectory}
          homeLabel={language === "zh" ? "用户主目录" : language === "ja" ? "ホームディレクトリ" : "Home directory"}
          pickDirectoryLabel={language === "zh" ? "选择其他文件夹…" : language === "ja" ? "別のフォルダを選択…" : "Choose another folder…"}
        />
        <CardTargetButton
          active={account.isCurrentApp}
          disabled={busy}
          icon={<Monitor className="size-4" />}
          label="App"
          primaryStrategy="replace-current"
          items={[
            {
              key: "replace-current",
              label:
                language === "zh"
                  ? "覆盖当前窗口"
                  : language === "ja"
                    ? "現在のウィンドウを置換"
                    : "Replace current",
            },
            {
              key: "new-window",
              label:
                language === "zh"
                  ? "新开窗口"
                  : language === "ja"
                    ? "新しいウィンドウ"
                    : "New window",
            },
          ]}
          onSelect={(strategy) => {
            onPrimeAccount(account);
            onSwitchAccount("app", account, strategy);
          }}
        />
        <button
          type="button"
          className="responsive-action flex h-9 min-w-[74px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#fafafa] px-3 text-[12px] font-medium text-neutral-700 ring-1 ring-black/[0.05] transition hover:bg-[#f3f4f6] hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => {
            onPrimeAccount(account);
            onLogin();
          }}
          disabled={busy}
        >
          <Pencil className="size-4" />
          <span className="responsive-action-label">{language === "zh" ? "编辑" : language === "ja" ? "編集" : "Edit"}</span>
        </button>
        <RowActionMenu
          label={language === "zh" ? "操作" : language === "ja" ? "操作" : "Actions"}
          disabled={busy}
          items={[
            {
              key: "relogin",
              label: pageCopy.accounts.relogin,
              onSelect: () => {
                onPrimeAccount(account);
                void onRelogin();
              },
            },
            {
              key: "logout",
              label: pageCopy.accounts.logout,
              onSelect: () => {
                onPrimeAccount(account);
                onLogoutIntent();
              },
            },
            {
              key: "delete",
              label: pageCopy.accounts.delete,
              tone: "danger",
              onSelect: () => {
                onPrimeAccount(account);
                onDelete();
              },
            },
          ]}
        />
      </div>
    </article>
  );
}

function RowActionMenu({
  label,
  disabled,
  items,
}: {
  label: string;
  disabled: boolean;
  items: Array<{
    key: string;
    label: string;
    tone?: "default" | "danger";
    onSelect: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const placement = useAdaptiveMenuPlacement(open, rootRef, menuRef);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="responsive-action flex h-9 min-w-[74px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#fafafa] px-3 text-[12px] font-medium text-neutral-700 ring-1 ring-black/[0.05] transition hover:bg-[#f3f4f6] hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-55"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
      >
        <Ellipsis className="size-4" />
        <span className="responsive-action-label">{label}</span>
        <ChevronDown className={cn("responsive-action-label size-3.5 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          data-menu-placement={placement}
          className={cn(
            "motion-popover-enter absolute right-0 z-20 min-w-[188px] rounded-lg border border-black/[0.08] bg-white p-1.5 shadow-md",
            placement === "up" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
          style={{ transformOrigin: placement === "up" ? "bottom right" : "top right" }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "flex w-full items-center rounded-lg px-3 py-2 text-left text-[12px] font-medium transition",
                item.tone === "danger"
                  ? "text-rose-600 hover:bg-rose-50"
                  : "text-neutral-700 hover:bg-[#f6f7f9]",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TooltipHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="inline-flex size-4 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-500 outline-none ring-1 ring-black/[0.05] transition hover:bg-[#ebedf0] hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-300"
        aria-label={text}
      >
        <CircleHelp className="size-3" />
      </span>
      <span className="pointer-events-none invisible absolute left-1/2 top-[calc(100%+8px)] z-20 w-[260px] -translate-x-1/2 -translate-y-1 rounded-lg bg-neutral-950 px-3 py-2 text-[11px] font-medium leading-5 text-white opacity-0 shadow-md transition-[opacity,transform,visibility] duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}

function AvatarTile({ name, index }: { name: string; index: number }) {
  const palettes = [
    "bg-slate-100 text-slate-700",
    "bg-slate-100 text-slate-700",
    "bg-zinc-100 text-zinc-700",
    "bg-neutral-100 text-neutral-700",
    "bg-slate-200 text-slate-700",
  ];

  return (
    <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-[15px] text-[20px] font-semibold", palettes[index % palettes.length])}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function SoftBadge({ label, tone, title }: { label: string; tone: "brand" | "neutral" | "success"; title?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-2 text-[10px] font-medium",
        tone === "brand"
          ? "bg-slate-200 text-slate-800"
          : tone === "success"
            ? "bg-slate-100 text-emerald-700"
            : "bg-slate-100 text-slate-500",
      )}
      title={title}
    >
      {label}
    </span>
  );
}

function CardUsageRow({
  label,
  metric,
  language,
  loading,
  loadingLabel,
}: {
  label: string;
  metric: ReturnType<typeof parseUsageMetric>;
  language: UiLanguage;
  loading: boolean;
  loadingLabel: string;
}) {
  const percent = metric.percent ?? 0;
  const hasPercent = metric.percent !== null && !loading;
  const percentLabel = loading ? loadingLabel : localizeUsageMetricLabel(metric.label, language);
  const resetHint = hasPercent ? formatUsageResetHint(metric.timestamp, language) : percentLabel;

  return (
    <div className="account-usage-row px-0.5 py-1">
      <span className="truncate text-[11px] font-semibold text-neutral-900">{label}</span>
      <div className="min-w-0">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
          <div
            className={cn("h-full rounded-full transition-[width,background-color] duration-300 ease-out", getUsageProgressClass(percent))}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <span className="text-right text-[10px] font-semibold text-neutral-700 [font-variant-numeric:tabular-nums]">
        {hasPercent ? `${percent}%` : ""}
      </span>
      <span className="text-right text-[10px] font-medium text-slate-500 [font-variant-numeric:tabular-nums]">
        {resetHint}
      </span>
    </div>
  );
}

function CardTargetButton({
  active,
  disabled,
  icon,
  label,
  primaryStrategy,
  items,
  onSelect,
  loadProjects,
  onSelectProject,
  onPickDirectory,
  homeLabel,
  pickDirectoryLabel,
}: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  primaryStrategy: DesktopLaunchStrategy;
  items: Array<{
    key: DesktopLaunchStrategy;
    label: string;
  }>;
  onSelect: (strategy: DesktopLaunchStrategy) => void;
  loadProjects?: () => Promise<CodexProject[]>;
  onSelectProject?: (path: string) => void;
  onPickDirectory?: () => Promise<string>;
  homeLabel?: string;
  pickDirectoryLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projects, setProjects] = useState<CodexProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const placement = useAdaptiveMenuPlacement(open, rootRef, menuRef);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => {
        if (!disabled) {
          setOpen(true);
        }
      }}
      onMouseLeave={() => {
        setOpen(false);
        setProjectOpen(false);
      }}
    >
      <div
        className={cn(
          "flex h-9 overflow-hidden rounded-lg ring-1 ring-black/[0.05] transition",
          active ? "bg-slate-200 text-slate-900 ring-black/[0.08]" : "bg-[#fafafa] text-neutral-700",
          !disabled && !active && "hover:bg-[#f3f4f6] hover:text-neutral-950",
          disabled && "cursor-not-allowed opacity-55",
        )}
      >
        <button
          type="button"
          className="responsive-action flex h-full min-w-[64px] items-center justify-center gap-1.5 px-3 text-[12px] font-medium"
          onClick={() => onSelect(primaryStrategy)}
          disabled={disabled}
          aria-label={label}
          title={label}
        >
          {icon}
          <span className="responsive-action-label">{label}</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex h-full w-8 items-center justify-center text-slate-400 transition",
            !disabled && "hover:bg-black/[0.035] hover:text-neutral-700",
          )}
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
          aria-label={`${label} menu`}
          title={`${label} menu`}
        >
          <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
        </button>
      </div>
      {open ? (
        <div
          ref={menuRef}
          data-menu-placement={placement}
          className={cn("absolute right-0 z-20", placement === "up" ? "bottom-full pb-2" : "top-full pt-2")}
        >
          <div className="motion-popover-enter min-w-[172px] rounded-lg border border-black/[0.08] bg-white p-1 shadow-md">
            {items.map((item) => (
              <div
                key={item.key}
                className="relative"
                onMouseEnter={() => {
                  if (item.key !== "new-window" || !loadProjects) return;
                  setProjectOpen(true);
                  if (!projectsLoaded) {
                    setProjectsLoaded(true);
                    void loadProjects().then(setProjects).catch(() => setProjects([]));
                  }
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-[#f6f7f9] hover:text-neutral-950",
                    item.key === primaryStrategy && "bg-[#f5f7fa] text-neutral-950",
                  )}
                  onClick={() => {
                    if (item.key === "new-window" && loadProjects) return;
                    setOpen(false);
                    onSelect(item.key);
                  }}
                >
                  {item.label}
                  {item.key === "new-window" && loadProjects ? <span className="text-slate-400">›</span> : null}
                </button>
                {item.key === "new-window" && projectOpen && loadProjects ? (
                  <div className="absolute right-full top-[-4px] z-30 pr-2">
                    <div className="motion-popover-enter w-[280px] rounded-lg border border-black/[0.08] bg-white p-1 shadow-md">
                      <div className="max-h-64 overflow-y-auto overscroll-contain">
                        {projects.map((project) => (
                          <button key={project.path} type="button" title={project.path} className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-[#f6f7f9]" onClick={() => { setOpen(false); setProjectOpen(false); onSelectProject?.(project.path); }}>
                            <span className="block truncate text-[12px] font-medium text-neutral-800">{project.name}</span>
                            <span className="block truncate text-[10px] text-slate-400">{project.path}</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-1 border-t border-black/[0.06] pt-1">
                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-neutral-700 hover:bg-[#f6f7f9]" onClick={() => { setOpen(false); onSelectProject?.(""); }}>{homeLabel}</button>
                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-neutral-700 hover:bg-[#f6f7f9]" onClick={() => { void onPickDirectory?.().then((path) => { if (path) { setOpen(false); onSelectProject?.(path); } }); }}>{pickDirectoryLabel}</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
