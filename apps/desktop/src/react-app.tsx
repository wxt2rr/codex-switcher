import { useEffect, useMemo, useRef, useState } from "react";

import { mergeAccountUsageMetrics, mergeOverviewWithAuthMetrics } from "@/auth-metrics";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import type { AccountPoolInput, AccountPoolStatus, CliAutoResumeSettings, CliTerminalId, CliTerminalSettings, CodexToolStatus, DesktopEnvEditableFiles, DesktopEnvFileHistoryEntry, DesktopLaunchStrategy, EnvHistoryRetentionSettings, GeneratedImageRecoveryStatus, RouterLifecycleSettings, RouterPortSettings } from "./bridge";
import { DesktopShell } from "./components/desktop-shell";
import type { AccountSummary, AuthMetricsPayload, EnvironmentRouteStatus, NavView, OverviewPayload } from "./desktop-model";
import { resolveDesktopBridge } from "./bridge";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, getTranslations, normalizeLanguage, translate, type UiLanguage } from "./i18n";
import { AccountsPage, type AccountProtocolSettings } from "./pages/accounts-page";
import { EnvironmentsPage } from "./pages/environments-page";
import { OperationsPage } from "./pages/operations-page";
import { ModelsPage } from "./pages/models-page";
import { SkillsPage } from "./pages/skills-page";
import { UsagePage } from "./pages/usage-page";
import { parseProxyStatusOutput, shouldAutoLoadProxy } from "./proxy-status";
import {
  getPostMutationRefreshPlan,
  normalizeAuthMetricsRefreshSeconds,
  shouldScheduleAuthMetricsRefresh,
} from "./refresh-policy";
import {
  buildDesktopNotice,
  type DesktopNotice,
} from "./desktop-feedback";

const bridge = resolveDesktopBridge();

function resolveInitialView(): NavView {
  if (typeof window === "undefined") {
    return "accounts";
  }
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "environments" || view === "accounts" || view === "models" || view === "skills" || view === "usage" || view === "operations") {
    return view;
  }
  return "accounts";
}

export function App() {
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<NavView>(resolveInitialView);
  const [language, setLanguage] = useState<UiLanguage>(DEFAULT_LANGUAGE);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialLoadingProgress, setInitialLoadingProgress] = useState(0);
  const [initialLoadingStage, setInitialLoadingStage] = useState("loading-settings");
  const [authMetricsLoading, setAuthMetricsLoading] = useState(false);
  const [authRefreshIntervalSeconds, setAuthRefreshIntervalSeconds] = useState(5);
  const [message, setMessage] = useState<DesktopNotice | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [noticePaused, setNoticePaused] = useState(false);
  const [envDraft, setEnvDraft] = useState("");
  const [envSourceDraft, setEnvSourceDraft] = useState("default");
  const [envDeleteDraft, setEnvDeleteDraft] = useState("");
  const [runtimeEnvDraft, setRuntimeEnvDraft] = useState("");
  const [runtimeAccountDraft, setRuntimeAccountDraft] = useState("");
  const [runtimeBaseUrlDraft, setRuntimeBaseUrlDraft] = useState("");
  const [accountEnvDraft, setAccountEnvDraft] = useState("");
  const [accountNameDraft, setAccountNameDraft] = useState("");
  const [accountTargetDraft, setAccountTargetDraft] = useState("cli");
  const [accountModeDraft, setAccountModeDraft] = useState("auth");
  const [accountApiKeyDraft, setAccountApiKeyDraft] = useState("");
  const [accountBaseUrlModeDraft, setAccountBaseUrlModeDraft] = useState("default");
  const [accountBaseUrlDraft, setAccountBaseUrlDraft] = useState("");
  const [accountSub2ApiDraft, setAccountSub2ApiDraft] = useState("");
  const [proxyDraft, setProxyDraft] = useState("");
  const [selectedLogKind, setSelectedLogKind] = useState("switcher");
  const [toolStatuses, setToolStatuses] = useState<CodexToolStatus[]>([]);
  const [toolDrafts, setToolDrafts] = useState<Record<"cli" | "app", string>>({ cli: "", app: "" });
  const [cliAutoResume, setCliAutoResume] = useState<CliAutoResumeSettings>({ enabled: false, sessionNumber: 1 });
  const [savedCliAutoResume, setSavedCliAutoResume] = useState<CliAutoResumeSettings>({ enabled: false, sessionNumber: 1 });
  const [autoResumeSaving, setAutoResumeSaving] = useState(false);
  const [routerLifecycle, setRouterLifecycle] = useState<RouterLifecycleSettings>({ stopOnAppQuit: false });
  const [routerLifecycleSaving, setRouterLifecycleSaving] = useState(false);
  const [routerPort, setRouterPort] = useState<RouterPortSettings>({ preferredPort: 17832 });
  const [routerPortSaving, setRouterPortSaving] = useState(false);
  const [envHistoryRetention, setEnvHistoryRetention] = useState<EnvHistoryRetentionSettings>({ enabled: false, retentionDays: 30 });
  const [envHistoryRetentionSaving, setEnvHistoryRetentionSaving] = useState(false);
  const [generatedImageRecovery, setGeneratedImageRecovery] = useState<GeneratedImageRecoveryStatus>({
    enabled: false, installedEnvironments: 0, totalEnvironments: 0, conflicts: [],
  });
  const [generatedImageRecoverySaving, setGeneratedImageRecoverySaving] = useState(false);
  const [cliTerminalSettings, setCliTerminalSettings] = useState<CliTerminalSettings | null>(null);
  const [cliTerminalSaving, setCliTerminalSaving] = useState(false);
  const [routeStatuses, setRouteStatuses] = useState<EnvironmentRouteStatus[]>([]);
  const [accountPools, setAccountPools] = useState<AccountPoolStatus[]>([]);
  const authMetricsRequestRef = useRef(0);
  const authMetricsInFlightRef = useRef(false);
  const proxyDraftDirtyRef = useRef(false);
  const noticeRemainingRef = useRef(4000);
  const noticeStartedAtRef = useRef(0);

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    if (!message) {
      setNoticeVisible(false);
      return;
    }

    noticeRemainingRef.current = message.tone === "error" ? 8000 : 6000;
    noticeStartedAtRef.current = Date.now();
    setNoticePaused(false);
    setNoticeVisible(true);
  }, [message]);

  useEffect(() => {
    if (!message || !noticeVisible || noticePaused) return;

    noticeStartedAtRef.current = Date.now();
    const timeoutId = window.setTimeout(() => {
      setNoticeVisible(false);
    }, noticeRemainingRef.current);

    return () => {
      window.clearTimeout(timeoutId);
      noticeRemainingRef.current = Math.max(
        0,
        noticeRemainingRef.current - (Date.now() - noticeStartedAtRef.current),
      );
    };
  }, [message, noticePaused, noticeVisible]);

  useEffect(() => {
    if (!message || noticeVisible) return;
    const timeoutId = window.setTimeout(() => {
      setMessage((current) => (current === message ? null : current));
    }, 160);
    return () => window.clearTimeout(timeoutId);
  }, [message, noticeVisible]);

  const copy = useMemo(() => getTranslations(language), [language]);
  const loadingErrorTitle = copy.labels.loadFailed;
  const retryLabel = copy.labels.retry;
  const loadingLabel = copy.labels.loading;
  const overviewOnlyRefreshPlan = getPostMutationRefreshPlan("overview-only");

  useEffect(() => {
    if (view === "overview") {
      setView("accounts");
    }
  }, [view]);

  useEffect(() => {
    if (view !== "environments" || !overview) return;
    const refreshPools = () => bridge.listAccountPools().then(setAccountPools).catch(setErrorMessage);
    void Promise.all([bridge.getEnvironmentRouteStatuses(), bridge.listAccountPools()])
      .then(([routes, pools]) => { setRouteStatuses(routes); setAccountPools(pools); })
      .catch(setErrorMessage);
    const interval = window.setInterval(() => { void refreshPools(); }, 10_000);
    return () => window.clearInterval(interval);
  }, [view, overview?.generatedAt]);

  useEffect(() => {
    if (view !== "operations") return;
    void loadCodexToolPaths();
    void bridge.getCliAutoResumeSettings().then((settings) => {
      setCliAutoResume(settings);
      setSavedCliAutoResume(settings);
    }).catch(setErrorMessage);
    void bridge.getCliTerminalSettings().then(setCliTerminalSettings).catch(setErrorMessage);
    void bridge.getRouterLifecycleSettings().then(setRouterLifecycle).catch(setErrorMessage);
    void bridge.getRouterPortSettings().then(setRouterPort).catch(setErrorMessage);
    void bridge.getEnvHistoryRetentionSettings().then(setEnvHistoryRetention).catch(setErrorMessage);
    void bridge.getGeneratedImageRecoverySettings().then(setGeneratedImageRecovery).catch(setErrorMessage);
  }, [view]);

  async function initializeApp() {
    setInitialLoadingProgress(12);
    setInitialLoadingStage("loading-settings");
    await loadLanguage();
    setInitialLoadingProgress(24);
    await loadCodexToolPaths();
    setInitialLoadingProgress(32);
    setInitialLoadingStage("restoring-routes");
    await refreshOverview({ loadMetrics: true });
  }

  async function handleCliTerminalSelection(id: CliTerminalId) {
    const previous = cliTerminalSettings;
    if (!previous) return;
    setCliTerminalSettings({ ...previous, selectedId: id });
    setCliTerminalSaving(true);
    try { setCliTerminalSettings(await bridge.setCliTerminalSelection(id)); }
    catch (error) { setCliTerminalSettings(previous); setErrorMessage(error); }
    finally { setCliTerminalSaving(false); }
  }

  async function handleCliTerminalScan() {
    setCliTerminalSaving(true);
    try { setCliTerminalSettings(await bridge.scanCliTerminalSettings()); }
    catch (error) { setErrorMessage(error); }
    finally { setCliTerminalSaving(false); }
  }

  async function loadCodexToolPaths(detect = false) {
    try {
      const statuses = detect ? await bridge.detectCodexToolPaths() : await bridge.getCodexToolPaths();
      setToolStatuses(statuses);
      setToolDrafts({
        cli: statuses.find((item) => item.kind === "cli")?.path || "",
        app: statuses.find((item) => item.kind === "app")?.path || "",
      });
    } catch (error) { setErrorMessage(error); }
  }

  async function handleToolPath(kind: "cli" | "app", action: "save" | "reset") {
    setBusy(true);
    try {
      const status = action === "save" ? await bridge.setCodexToolPath(kind, toolDrafts[kind]) : await bridge.clearCodexToolPath(kind);
      setToolStatuses((current) => [...current.filter((item) => item.kind !== kind), status]);
      setToolDrafts((current) => ({ ...current, [kind]: status.path }));
      await loadCodexToolPaths(true);
      setSuccessMessage(language === "zh" ? `${kind === "cli" ? "Codex CLI" : "Codex App"} 路径已更新` : `${kind === "cli" ? "Codex CLI" : "Codex App"} path updated`);
    } catch (error) { setErrorMessage(error); } finally { setBusy(false); }
  }

  async function handleCliAutoResumeChange(next: CliAutoResumeSettings) {
    const previous = savedCliAutoResume;
    setCliAutoResume(next);
    setAutoResumeSaving(true);
    try {
      const saved = await bridge.setCliAutoResumeSettings(next);
      setCliAutoResume(saved);
      setSavedCliAutoResume(saved);
    } catch (error) {
      setCliAutoResume(previous);
      setErrorMessage(error);
    } finally {
      setAutoResumeSaving(false);
    }
  }

  async function handleRouterLifecycleChange(next: RouterLifecycleSettings) {
    const previous = routerLifecycle;
    setRouterLifecycle(next);
    setRouterLifecycleSaving(true);
    try {
      setRouterLifecycle(await bridge.setRouterLifecycleSettings(next));
    } catch (error) {
      setRouterLifecycle(previous);
      setErrorMessage(error);
    } finally {
      setRouterLifecycleSaving(false);
    }
  }

  async function handleGeneratedImageRecoveryChange(enabled: boolean) {
    const previous = generatedImageRecovery;
    setGeneratedImageRecovery((current) => ({ ...current, enabled }));
    setGeneratedImageRecoverySaving(true);
    try {
      const saved = await bridge.setGeneratedImageRecoverySettings({ enabled });
      setGeneratedImageRecovery(saved);
      setSuccessMessage(language === "zh"
        ? enabled ? `已在 ${saved.installedEnvironments} 个 Codex 环境安装图片恢复 Skill` : "已从所有 Codex 环境移除图片恢复 Skill"
        : enabled ? `Recovery skill installed in ${saved.installedEnvironments} Codex environments` : "Recovery skill removed from all Codex environments");
    } catch (error) {
      setGeneratedImageRecovery(previous);
      setErrorMessage(error);
    } finally {
      setGeneratedImageRecoverySaving(false);
    }
  }

  async function handleRouterPortChange(next: RouterPortSettings) {
    const previous = routerPort;
    setRouterPort(next);
    setRouterPortSaving(true);
    try {
      setRouterPort(await bridge.setRouterPortSettings(next));
    } catch (error) {
      setRouterPort(previous);
      setErrorMessage(error);
    } finally {
      setRouterPortSaving(false);
    }
  }

  async function handleEnvHistoryRetentionChange(next: EnvHistoryRetentionSettings) {
    const previous = envHistoryRetention;
    setEnvHistoryRetention(next);
    setEnvHistoryRetentionSaving(true);
    try {
      setEnvHistoryRetention(await bridge.setEnvHistoryRetentionSettings(next));
    } catch (error) {
      setEnvHistoryRetention(previous);
      setErrorMessage(error);
    } finally {
      setEnvHistoryRetentionSaving(false);
    }
  }

  async function handleToggleEnvironmentRoute(envName: string, enabled: boolean) {
    setBusy(true);
    try {
      const next = await bridge.toggleEnvironmentRoute(envName, enabled);
      setRouteStatuses((current) => [...current.filter((item) => item.envName !== envName), next]);
      setSuccessMessage(language === "zh" ? `环境 ${envName} 路由已${enabled ? "开启" : "关闭"}` : `Routing ${enabled ? "enabled" : "disabled"} for ${envName}`);
      await refreshOverview({ loadMetrics: false });
    } catch (error) { setErrorMessage(error); }
    finally { setBusy(false); }
  }

  async function handleSaveAccountPool(input: AccountPoolInput) {
    setBusy(true);
    try {
      const next = await bridge.saveAccountPool(input);
      setAccountPools((current) => [...current.filter((item) => item.envName !== input.envName), ...(next ? [next] : [])]);
      const routes = await bridge.getEnvironmentRouteStatuses();
      setRouteStatuses(routes);
      setSuccessMessage(language === "zh" ? `环境 ${input.envName} 账号池已${input.enabled ? "保存" : "关闭"}` : `Account pool ${input.enabled ? "saved" : "disabled"}`);
      await refreshOverview({ loadMetrics: false });
      return true;
    } catch (error) { setErrorMessage(error); return false; }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (theme !== "light") {
      setTheme("light");
    }
  }, [theme, setTheme]);

  useEffect(() => {
    if (!shouldAutoLoadProxy(view, proxyDraftDirtyRef.current)) {
      return;
    }
    void loadProxyDraft(false).catch(() => undefined);
  }, [view]);

  function setSuccessMessage(text: string) {
    setMessage(buildDesktopNotice(language, "success", text));
  }

  function setTranslatedSuccessMessage(template: string, vars?: Record<string, string>) {
    setSuccessMessage(translate(template, vars ?? {}));
  }

  function setValidationMessage(key: "env-name-required" | "runtime-requires-input") {
    setMessage(buildDesktopNotice(language, "validation", key));
  }

  function setErrorMessage(error: unknown) {
    setMessage(buildDesktopNotice(language, "error", error instanceof Error ? error.message : String(error)));
  }

  async function loadLanguage() {
    try {
      const next = normalizeLanguage(await bridge.getLanguage());
      setLanguage(next);
      document.documentElement.lang = next;
    } catch {
      setLanguage(DEFAULT_LANGUAGE);
    }
  }

  async function refreshOverview(options?: { loadMetrics?: boolean }) {
    setBusy(true);
    try {
      const raw = await bridge.loadOverview();
      const nextOverview = JSON.parse(raw) as OverviewPayload;
      setOverview(nextOverview);
      if (initialLoading) {
        setInitialLoadingProgress(88);
        setInitialLoadingStage("ready");
      }
      if (options?.loadMetrics !== false) {
        void refreshAuthMetrics(nextOverview);
      }
    } catch (error) {
      setOverview(null);
      setErrorMessage(error);
    } finally {
      if (initialLoading) {
        setInitialLoadingProgress(100);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        setInitialLoading(false);
      }
      setBusy(false);
    }
  }

  async function refreshAuthMetrics(
    baseOverview: OverviewPayload,
    mode: "full" | "account-usage" = "full",
  ) {
    if (authMetricsInFlightRef.current) {
      return;
    }
    authMetricsInFlightRef.current = true;
    const requestId = authMetricsRequestRef.current + 1;
    authMetricsRequestRef.current = requestId;
    setAuthMetricsLoading(true);
    try {
      const raw = await bridge.loadAuthMetrics();
      const nextMetrics = JSON.parse(raw) as AuthMetricsPayload;
      if (authMetricsRequestRef.current !== requestId) {
        return;
      }
      setOverview((current) => {
        if (!current || current.generatedAt !== baseOverview.generatedAt) {
          return current;
        }
        return mode === "account-usage"
          ? mergeAccountUsageMetrics(current, nextMetrics)
          : mergeOverviewWithAuthMetrics(current, nextMetrics);
      });
    } catch {
      if (authMetricsRequestRef.current !== requestId) {
        return;
      }
    } finally {
      if (authMetricsRequestRef.current === requestId) {
        setAuthMetricsLoading(false);
      }
      authMetricsInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!overview || view !== "accounts") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (
        !shouldScheduleAuthMetricsRefresh(
          view,
          document.visibilityState,
          authMetricsInFlightRef.current,
          Boolean(overview),
        )
      ) {
        return;
      }
      void refreshAuthMetrics(overview, "account-usage");
    }, authRefreshIntervalSeconds * 1000);

    return () => window.clearInterval(intervalId);
  }, [view, overview?.generatedAt, authRefreshIntervalSeconds]);

  async function handleSetLanguage(nextLanguage: UiLanguage) {
    try {
      const next = normalizeLanguage(await bridge.setLanguage(nextLanguage));
      setLanguage(next);
      document.documentElement.lang = next;
    } catch (error) {
      setErrorMessage(error);
    }
  }

  async function handleSwitchAccount(
    target: "cli" | "app",
    account: AccountSummary,
    strategy?: DesktopLaunchStrategy,
    workingDirectory?: string,
  ) {
    setBusy(true);
    try {
      await bridge.switchAccount(target, account.envName, account.name, strategy, workingDirectory);
      setMessage(buildDesktopNotice(
        language,
        "success",
        strategy === "multi-window"
          ? language === "zh"
            ? `已为 ${account.envName}/${account.name} 新开一个 App 窗口`
            : language === "ja"
              ? `${account.envName}/${account.name} の App ウィンドウを追加しました`
              : `Opened another App window for ${account.envName}/${account.name}`
          : translate(copy.message.switchedAccount, { target: target.toUpperCase(), env: account.envName, account: account.name }),
      ));
      await refreshOverview({ loadMetrics: true });
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyAccount(account: AccountSummary, targetEnvName: string) {
    setBusy(true);
    try {
      const result = await bridge.copyAccount(account.envName, account.name, targetEnvName);
      const destination = result.output?.trim() || targetEnvName;
      setSuccessMessage(
        language === "zh"
          ? `账号已复制到 ${destination}`
          : language === "ja"
            ? `アカウントを ${destination} に複製しました`
            : `Account copied to ${destination}`,
      );
      await refreshOverview({ loadMetrics: true });
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEnv(): Promise<boolean> {
    if (!envDraft.trim()) {
      setValidationMessage("env-name-required");
      return false;
    }

      const args =
      envSourceDraft === "empty"
        ? { kind: "empty" as const }
        : envSourceDraft === "default"
          ? { kind: "default" as const }
          : { kind: "env" as const, envName: envSourceDraft };

    setBusy(true);
    try {
      await bridge.createEnv({
        envName: envDraft.trim(),
        source: args,
      });
      setTranslatedSuccessMessage(copy.message.envCreated, { env: envDraft.trim() });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEnv() {
    if (!envDeleteDraft.trim()) {
      setValidationMessage("env-name-required");
      return;
    }

    setBusy(true);
    try {
      await bridge.deleteEnv(envDeleteDraft.trim());
      setTranslatedSuccessMessage(copy.message.envDeleted, { env: envDeleteDraft.trim() });
      await refreshOverview({ loadMetrics: true });
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateEnv(
    envName: string,
    nextEnvName: string,
    homePath: string,
  ): Promise<boolean> {
    if (!nextEnvName.trim()) {
      setValidationMessage("env-name-required");
      return false;
    }

    if (!homePath.trim()) {
      setErrorMessage(new Error(copy.message.envPathRequired));
      return false;
    }

    setBusy(true);
    try {
      await bridge.updateEnv(envName, nextEnvName.trim(), homePath.trim());
      setTranslatedSuccessMessage(copy.message.envUpdatedDone, { env: nextEnvName.trim() });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleReadEnvFiles(envName: string): Promise<DesktopEnvEditableFiles | null> {
    setBusy(true);
    try {
      const raw = await bridge.readEnvFiles(envName);
      return JSON.parse(raw) as DesktopEnvEditableFiles;
    } catch (error) {
      setErrorMessage(error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateEnvFiles(envName: string, files: DesktopEnvEditableFiles): Promise<boolean> {
    setBusy(true);
    try {
      await bridge.updateEnvFiles(envName, files);
      setTranslatedSuccessMessage(copy.message.envConfigUpdated, { env: envName });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleListEnvFileHistory(envName: string): Promise<DesktopEnvFileHistoryEntry[]> {
    setBusy(true);
    try {
      const raw = await bridge.listEnvFileHistory(envName);
      return JSON.parse(raw) as DesktopEnvFileHistoryEntry[];
    } catch (error) {
      setErrorMessage(error);
      return [];
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreEnvFileHistory(envName: string, entryId: string): Promise<boolean> {
    setBusy(true);
    try {
      await bridge.restoreEnvFileHistory(envName, entryId);
      setTranslatedSuccessMessage(copy.message.envConfigUpdated, { env: envName });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEnvFileHistory(envName: string, entryIds: string[]): Promise<boolean> {
    setBusy(true);
    try {
      await bridge.deleteEnvFileHistory(envName, entryIds);
      setSuccessMessage(`${entryIds.length} history item(s) deleted`);
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateRuntime(): Promise<boolean> {
    if (!runtimeEnvDraft.trim() || !runtimeAccountDraft.trim()) {
      setValidationMessage("runtime-requires-input");
      return false;
    }

    setBusy(true);
    try {
      await bridge.updateRuntime(runtimeEnvDraft.trim(), runtimeAccountDraft.trim(), runtimeBaseUrlDraft.trim() || "default");
      setTranslatedSuccessMessage(copy.message.runtimeUpdated, { env: runtimeEnvDraft.trim(), account: runtimeAccountDraft.trim() });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateIndependentModel(
    account: AccountSummary,
    enabled: boolean,
    providerId: string,
    apiKey: string,
    baseUrl: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      await bridge.updateIndependentModel({
        envName: account.envName,
        accountName: account.name,
        enabled,
        providerId,
        apiKey,
        baseUrl,
      });
      setTranslatedSuccessMessage(copy.message.independentModelUpdated, {
        env: account.envName,
        account: account.name,
      });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleNativeLogin(
    action: "login" | "relogin",
    protocolSettings?: AccountProtocolSettings,
  ): Promise<boolean> {
    if (!accountEnvDraft.trim() || !accountNameDraft.trim()) {
      setValidationMessage("runtime-requires-input");
      return false;
    }

    const existingAccount = overview?.accounts.find(
      (account) => account.envName === accountEnvDraft.trim() && account.name === accountNameDraft.trim(),
    );
    const effectiveProtocolSettings: AccountProtocolSettings = protocolSettings ?? {
      apiProtocol: existingAccount?.runtime.apiProtocol ?? "responses",
      compatibilityEnabled: existingAccount?.runtime.compatibilityRouteEnabled === true,
      upstreamModel: existingAccount?.runtime.compatibilityUpstreamModel,
      reasoningProfile: existingAccount?.runtime.compatibilityReasoningProfile ?? "auto",
      longConversationStrategy: existingAccount?.runtime.compatibilityLongConversationStrategy ?? "safe",
      instructionRole: existingAccount?.runtime.compatibilityInstructionRole ?? "auto",
      requestOverrides: existingAccount?.runtime.compatibilityRequestOverrides,
    };

    setBusy(true);
    try {
      await bridge.nativeLogin({
        mode: accountModeDraft === "apikey" || accountModeDraft === "sub2api" ? accountModeDraft : "auth",
        account: accountNameDraft.trim(),
        envName: accountEnvDraft.trim(),
        target: "none",
        relogin: action === "relogin",
        apiKey: accountApiKeyDraft,
        baseUrlMode: accountBaseUrlModeDraft === "custom" ? "custom" : "default",
        baseUrl: accountBaseUrlDraft.trim() || undefined,
        sub2apiPayload: accountSub2ApiDraft,
        apiProtocol: effectiveProtocolSettings.apiProtocol,
        compatibilityEnabled: effectiveProtocolSettings.compatibilityEnabled,
        upstreamModel: effectiveProtocolSettings.upstreamModel,
        reasoningProfile: effectiveProtocolSettings.reasoningProfile,
        longConversationStrategy: effectiveProtocolSettings.longConversationStrategy,
        instructionRole: effectiveProtocolSettings.instructionRole,
        requestOverrides: effectiveProtocolSettings.requestOverrides,
      });
      setTranslatedSuccessMessage(action === "relogin" ? copy.message.reloginCompleted : copy.message.loginCompleted, {
        env: accountEnvDraft.trim(),
        account: accountNameDraft.trim(),
      });
      await refreshOverview({ loadMetrics: true });
      return true;
    } catch (error) {
      setErrorMessage(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAccountCommand(action: "logout" | "rm") {
    if (!accountEnvDraft.trim() || !accountNameDraft.trim()) {
      setValidationMessage("runtime-requires-input");
      return;
    }

    setBusy(true);
    try {
      if (action === "rm") {
        await bridge.deleteAccount(accountEnvDraft.trim(), accountNameDraft.trim());
        setTranslatedSuccessMessage(copy.message.accountDeleted, {
          env: accountEnvDraft.trim(),
          account: accountNameDraft.trim(),
        });
      } else {
        await bridge.logoutAccount(accountEnvDraft.trim(), accountNameDraft.trim(), accountTargetDraft === "app" || accountTargetDraft === "both" ? accountTargetDraft : "cli");
        setTranslatedSuccessMessage(copy.message.accountLoggedOut, {
          env: accountEnvDraft.trim(),
          account: accountNameDraft.trim(),
        });
      }
      if (overviewOnlyRefreshPlan.refreshOverview) {
        await refreshOverview({ loadMetrics: overviewOnlyRefreshPlan.refreshMetrics });
      }
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleProxy(action: "auto-detect" | "set") {
    setBusy(true);
    try {
      if (action === "auto-detect") {
        await loadProxyDraft(true);
        setTranslatedSuccessMessage(copy.message.proxyLoaded);
      } else {
        await bridge.setProxy(proxyDraft.trim());
        proxyDraftDirtyRef.current = false;
        setTranslatedSuccessMessage(copy.message.proxyUpdated);
      }
      if (overviewOnlyRefreshPlan.refreshOverview) {
        await refreshOverview({ loadMetrics: overviewOnlyRefreshPlan.refreshMetrics });
      }
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function loadProxyDraft(force: boolean) {
    const result = await bridge.showProxy();
    if (!force && proxyDraftDirtyRef.current) {
      return;
    }
    setProxyDraft(parseProxyStatusOutput(result.output ?? ""));
    proxyDraftDirtyRef.current = false;
  }

  async function handleImportDefaultEnv(envName: string): Promise<void> {
    setBusy(true);
    try {
      await bridge.importDefaultEnv(envName);
      setTranslatedSuccessMessage(copy.message.defaultImported, { env: envName });
      await refreshOverview({ loadMetrics: true });
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleReadLog() {
    setBusy(true);
    try {
      if (selectedLogKind === "token-refresh") {
        await bridge.readTokenRefreshLog();
        setTranslatedSuccessMessage(copy.message.tokenRefreshLogLoaded);
      } else {
        await bridge.readSwitcherLog();
        setTranslatedSuccessMessage(copy.message.switcherLogLoaded);
      }
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setBusy(false);
    }
  }

  function primeAccountDrafts(account?: AccountSummary) {
    if (!account) {
      setAccountEnvDraft("");
      setAccountNameDraft("");
      setAccountTargetDraft("cli");
      setAccountModeDraft("auth");
      setAccountApiKeyDraft("");
      setAccountBaseUrlModeDraft("default");
      setAccountBaseUrlDraft("");
      setAccountSub2ApiDraft("");
      return;
    }

    setAccountEnvDraft(account.envName);
    setAccountNameDraft(account.name);
    setAccountModeDraft(account.authMode === "apikey" || account.authMode === "sub2api" ? account.authMode : "auth");
    setAccountApiKeyDraft(account.apiKeyValue ?? "");
    setAccountBaseUrlModeDraft(account.runtime.openaiBaseUrlMode);
    setAccountBaseUrlDraft(account.route?.originalBaseUrl ?? account.runtime.openaiBaseUrl ?? "");
    setRuntimeEnvDraft(account.envName);
    setRuntimeAccountDraft(account.name);
    setRuntimeBaseUrlDraft(account.runtime.openaiBaseUrl ?? "");
  }

  if (initialLoading) {
    return (
      <DesktopShell
        brand={copy.brand}
        nav={[
          { view: "accounts", label: copy.nav.accounts },
          { view: "environments", label: copy.nav.environments },
          { view: "models", label: copy.nav.models },
          { view: "skills", label: copy.nav.skills },
          { view: "usage", label: copy.nav.usage },
          { view: "operations", label: copy.nav.operations },
        ]}
        currentView={view}
        onChangeView={setView}
        message={message}
        noticeVisible={noticeVisible}
        onNoticePauseChange={setNoticePaused}
      >
        <section className="flex h-full min-h-0 items-center justify-center px-6">
          <div className="w-full max-w-[520px]">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200/70">
              <div
                className="h-full origin-left rounded-full bg-primary transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{ transform: `scaleX(${initialLoadingProgress / 100})` }}
              />
            </div>
            <p className="mt-3 text-center text-[12px] text-slate-500">
              {language === "zh"
                ? initialLoadingStage === "loading-settings" ? "正在加载界面设置" : initialLoadingStage === "restoring-routes" ? "正在恢复本地配置与代理路由" : "启动就绪"
                : language === "ja"
                  ? initialLoadingStage === "loading-settings" ? "画面設定を読み込み中" : initialLoadingStage === "restoring-routes" ? "設定とプロキシルートを復元中" : "起動準備完了"
                  : initialLoadingStage === "loading-settings" ? "Loading interface settings" : initialLoadingStage === "restoring-routes" ? "Restoring configuration and proxy routes" : "Ready"}
            </p>
          </div>
        </section>
      </DesktopShell>
    );
  }

  if (!overview) {
    return (
      <DesktopShell
        brand={copy.brand}
        nav={[
          { view: "accounts", label: copy.nav.accounts },
          { view: "environments", label: copy.nav.environments },
          { view: "models", label: copy.nav.models },
          { view: "skills", label: copy.nav.skills },
          { view: "usage", label: copy.nav.usage },
          { view: "operations", label: copy.nav.operations },
        ]}
        currentView={view}
        onChangeView={setView}
        message={message}
        noticeVisible={noticeVisible}
        onNoticePauseChange={setNoticePaused}
      >
        <section className="flex h-full min-h-0 items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4">
            <div className="text-lg font-semibold text-neutral-800">{loadingErrorTitle}</div>
            <Button variant="outline" onClick={() => void refreshOverview({ loadMetrics: true })} disabled={busy}>
              {retryLabel}
            </Button>
          </div>
        </section>
      </DesktopShell>
    );
  }

  return (
    <DesktopShell
      brand={copy.brand}
      nav={[
        { view: "accounts", label: copy.nav.accounts },
        { view: "environments", label: copy.nav.environments },
        { view: "models", label: copy.nav.models },
        { view: "skills", label: copy.nav.skills },
        { view: "usage", label: copy.nav.usage },
        { view: "operations", label: copy.nav.operations },
      ]}
      currentView={view}
      onChangeView={setView}
      message={message}
      noticeVisible={noticeVisible}
      onNoticePauseChange={setNoticePaused}
    >
      {view === "environments" ? (
        <EnvironmentsPage
          overview={overview}
          language={language}
          busy={busy}
          envDraft={envDraft}
          envSourceDraft={envSourceDraft}
          envDeleteDraft={envDeleteDraft}
          onEnvDraftChange={setEnvDraft}
          onEnvSourceDraftChange={setEnvSourceDraft}
          onEnvDeleteDraftChange={setEnvDeleteDraft}
          onCreateEnv={handleCreateEnv}
          onUpdateEnv={handleUpdateEnv}
          onReadEnvFiles={handleReadEnvFiles}
          onUpdateEnvFiles={handleUpdateEnvFiles}
          onListEnvFileHistory={handleListEnvFileHistory}
          onRestoreEnvFileHistory={handleRestoreEnvFileHistory}
          onDeleteEnvFileHistory={handleDeleteEnvFileHistory}
          onImportDefaultEnv={(envName) => void handleImportDefaultEnv(envName)}
          onDeleteEnv={() => void handleDeleteEnv()}
          routeStatuses={routeStatuses}
          onToggleRoute={handleToggleEnvironmentRoute}
          accountPools={accountPools}
          onSaveAccountPool={handleSaveAccountPool}
        />
      ) : null}

      {view === "accounts" ? (
        <AccountsPage
          overview={overview}
          language={language}
          authMetricsLoading={authMetricsLoading}
          authRefreshIntervalSeconds={authRefreshIntervalSeconds}
          loadingLabel={loadingLabel}
          busy={busy}
          accountEnvDraft={accountEnvDraft}
          accountNameDraft={accountNameDraft}
          accountTargetDraft={accountTargetDraft}
          accountModeDraft={accountModeDraft}
          accountApiKeyDraft={accountApiKeyDraft}
          accountBaseUrlModeDraft={accountBaseUrlModeDraft}
          accountBaseUrlDraft={accountBaseUrlDraft}
          accountSub2ApiDraft={accountSub2ApiDraft}
          runtimeEnvDraft={runtimeEnvDraft}
          runtimeAccountDraft={runtimeAccountDraft}
          runtimeBaseUrlDraft={runtimeBaseUrlDraft}
          onAccountEnvDraftChange={setAccountEnvDraft}
          onAuthRefreshIntervalChange={(seconds) => {
            setAuthRefreshIntervalSeconds(normalizeAuthMetricsRefreshSeconds(seconds));
          }}
          onRefreshAuthMetrics={() => {
            if (overview) {
              void refreshAuthMetrics(overview, "account-usage");
            }
          }}
          onAccountNameDraftChange={setAccountNameDraft}
          onAccountModeDraftChange={setAccountModeDraft}
          onAccountApiKeyDraftChange={setAccountApiKeyDraft}
          onAccountBaseUrlModeDraftChange={setAccountBaseUrlModeDraft}
          onAccountBaseUrlDraftChange={setAccountBaseUrlDraft}
          onAccountSub2ApiDraftChange={setAccountSub2ApiDraft}
          onRuntimeEnvDraftChange={setRuntimeEnvDraft}
          onRuntimeAccountDraftChange={setRuntimeAccountDraft}
          onRuntimeBaseUrlDraftChange={setRuntimeBaseUrlDraft}
          onSwitchAccount={(target, account, strategy, workingDirectory) => void handleSwitchAccount(target, account, strategy, workingDirectory)}
          onListAccountProjects={(account) => bridge.listAccountProjects(account.envName, account.name)}
          onPickDirectory={() => bridge.pickDirectory()}
          onPrimeAccount={primeAccountDrafts}
          onLogin={(settings) => handleNativeLogin("login", settings)}
          onRelogin={() => handleNativeLogin("relogin")}
          onLogout={() => void handleAccountCommand("logout")}
          onDeleteAccount={() => void handleAccountCommand("rm")}
          onCopyAccount={(account, targetEnvName) => void handleCopyAccount(account, targetEnvName)}
          onUpdateRuntime={handleUpdateRuntime}
          onUpdateIndependentModel={handleUpdateIndependentModel}
          onCopyBaseUrl={(value) => {
            void bridge.writeClipboardText(value)
              .then(() => setSuccessMessage(language === "zh" ? "Base URL 已复制" : language === "ja" ? "Base URL をコピーしました" : "Base URL copied"))
              .catch(setErrorMessage);
          }}
          onCopyApiKey={(value) => {
            void bridge.writeClipboardText(value)
              .then(() => setSuccessMessage(language === "zh" ? "API Key 已复制" : language === "ja" ? "API Key をコピーしました" : "API key copied"))
              .catch(setErrorMessage);
          }}
        />
      ) : null}

      {view === "models" ? (
        <ModelsPage
          overview={overview}
          language={language}
          bridge={bridge}
          onSuccess={setSuccessMessage}
          onError={setErrorMessage}
        />
      ) : null}

      {view === "skills" ? (
        <SkillsPage
          bridge={bridge}
          language={language}
          onSuccess={setSuccessMessage}
          onError={setErrorMessage}
        />
      ) : null}

      {view === "operations" ? (
        <OperationsPage
          language={language}
          languageOptions={SUPPORTED_LANGUAGES.map((item) => ({ value: item, label: LANGUAGE_LABELS[item] }))}
          onLanguageChange={(item) => void handleSetLanguage(normalizeLanguage(item))}
          busy={busy}
          proxyDraft={proxyDraft}
          logKind={selectedLogKind}
          onProxyDraftChange={(value) => {
            proxyDraftDirtyRef.current = true;
            setProxyDraft(value);
          }}
          onLogKindChange={setSelectedLogKind}
          onProxyAutoDetect={() => void handleProxy("auto-detect")}
          onProxySet={() => void handleProxy("set")}
          onReadLog={() => void handleReadLog()}
          toolStatuses={toolStatuses}
          toolDrafts={toolDrafts}
          onToolDraftChange={(kind, value) => setToolDrafts((current) => ({ ...current, [kind]: value }))}
          onToolSave={(kind) => void handleToolPath(kind, "save")}
          onToolReset={(kind) => void handleToolPath(kind, "reset")}
          cliAutoResume={cliAutoResume}
          autoResumeSaving={autoResumeSaving}
          onCliAutoResumeChange={(next) => void handleCliAutoResumeChange(next)}
          cliTerminalSettings={cliTerminalSettings}
          cliTerminalSaving={cliTerminalSaving}
          onCliTerminalChange={(id) => void handleCliTerminalSelection(id)}
          onCliTerminalScan={() => void handleCliTerminalScan()}
          routerLifecycle={routerLifecycle}
          routerLifecycleSaving={routerLifecycleSaving}
          onRouterLifecycleChange={(next) => void handleRouterLifecycleChange(next)}
          routerPort={routerPort}
          routerPortSaving={routerPortSaving}
          onRouterPortChange={(next) => void handleRouterPortChange(next)}
          envHistoryRetention={envHistoryRetention}
          envHistoryRetentionSaving={envHistoryRetentionSaving}
          onEnvHistoryRetentionChange={(next) => void handleEnvHistoryRetentionChange(next)}
          generatedImageRecovery={generatedImageRecovery}
          generatedImageRecoverySaving={generatedImageRecoverySaving}
          onGeneratedImageRecoveryChange={(enabled) => void handleGeneratedImageRecoveryChange(enabled)}
        />
      ) : null}

      {view === "usage" ? <UsagePage overview={overview} language={language} bridge={bridge} /> : null}
    </DesktopShell>
  );
}
