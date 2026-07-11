import { useEffect, useMemo, useRef, useState } from "react";

import { mergeAccountUsageMetrics, mergeOverviewWithAuthMetrics } from "@/auth-metrics";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import type { CodexToolStatus, DesktopEnvEditableFiles, DesktopEnvFileHistoryEntry } from "./bridge";
import { DesktopShell } from "./components/desktop-shell";
import type { AccountSummary, AuthMetricsPayload, EnvironmentRouteStatus, NavView, OverviewPayload } from "./desktop-model";
import { resolveDesktopBridge } from "./bridge";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, getTranslations, normalizeLanguage, translate, type UiLanguage } from "./i18n";
import { AccountsPage } from "./pages/accounts-page";
import { EnvironmentsPage } from "./pages/environments-page";
import { OperationsPage } from "./pages/operations-page";
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
  if (view === "environments" || view === "accounts" || view === "usage" || view === "operations") {
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
  const [authMetricsLoading, setAuthMetricsLoading] = useState(false);
  const [authRefreshIntervalSeconds, setAuthRefreshIntervalSeconds] = useState(5);
  const [message, setMessage] = useState<DesktopNotice | null>(null);
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
  const [routeStatuses, setRouteStatuses] = useState<EnvironmentRouteStatus[]>([]);
  const authMetricsRequestRef = useRef(0);
  const authMetricsInFlightRef = useRef(false);
  const proxyDraftDirtyRef = useRef(false);

  useEffect(() => {
    void loadLanguage();
    void refreshOverview({ loadMetrics: true });
  }, []);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage((current) => (current === message ? null : current));
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!initialLoading) {
      return;
    }

    setInitialLoadingProgress(0);
    const intervalId = window.setInterval(() => {
      setInitialLoadingProgress((current) => {
        if (current >= 92) {
          return current;
        }
        return Math.min(current + Math.max(4, Math.round((100 - current) / 10)), 92);
      });
    }, 120);

    return () => window.clearInterval(intervalId);
  }, [initialLoading]);

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
    void bridge.getEnvironmentRouteStatuses().then(setRouteStatuses).catch(setErrorMessage);
  }, [view, overview?.generatedAt]);

  useEffect(() => {
    if (view !== "operations") return;
    void loadCodexToolPaths();
  }, [view]);

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
      setMessage(null);
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
    strategy?: "replace-current" | "current-window" | "new-window",
    workingDirectory?: string,
  ) {
    setBusy(true);
    try {
      await bridge.switchAccount(target, account.envName, account.name, strategy, workingDirectory);
      setMessage(buildDesktopNotice(language, "success", translate(copy.message.switchedAccount, { target: target.toUpperCase(), env: account.envName, account: account.name })));
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

  async function handleNativeLogin(action: "login" | "relogin"): Promise<boolean> {
    if (!accountEnvDraft.trim() || !accountNameDraft.trim()) {
      setValidationMessage("runtime-requires-input");
      return false;
    }

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
    setAccountBaseUrlDraft(account.runtime.openaiBaseUrl ?? "");
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
          { view: "usage", label: copy.nav.usage },
          { view: "operations", label: copy.nav.operations },
        ]}
        currentView={view}
        onChangeView={setView}
        language={language}
        languageLabel={copy.topbar.language}
        languageOptions={SUPPORTED_LANGUAGES.map((item) => ({ value: item, label: LANGUAGE_LABELS[item] }))}
        onChangeLanguage={(item) => void handleSetLanguage(normalizeLanguage(item))}
        message={message}
      >
        <section className="flex min-h-[calc(100vh-140px)] items-center justify-center">
          <div className="w-full max-w-[520px]">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200/70">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${initialLoadingProgress}%` }}
              />
            </div>
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
          { view: "usage", label: copy.nav.usage },
          { view: "operations", label: copy.nav.operations },
        ]}
        currentView={view}
        onChangeView={setView}
        language={language}
        languageLabel={copy.topbar.language}
        languageOptions={SUPPORTED_LANGUAGES.map((item) => ({ value: item, label: LANGUAGE_LABELS[item] }))}
        onChangeLanguage={(item) => void handleSetLanguage(normalizeLanguage(item))}
        message={message}
      >
        <section className="flex min-h-[calc(100vh-140px)] items-center justify-center">
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
        { view: "usage", label: copy.nav.usage },
        { view: "operations", label: copy.nav.operations },
      ]}
      currentView={view}
      onChangeView={setView}
      language={language}
      languageLabel={copy.topbar.language}
      languageOptions={SUPPORTED_LANGUAGES.map((item) => ({ value: item, label: LANGUAGE_LABELS[item] }))}
      onChangeLanguage={(item) => void handleSetLanguage(normalizeLanguage(item))}
      message={message}
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
          onLogin={() => handleNativeLogin("login")}
          onRelogin={() => handleNativeLogin("relogin")}
          onLogout={() => void handleAccountCommand("logout")}
          onDeleteAccount={() => void handleAccountCommand("rm")}
          onUpdateRuntime={handleUpdateRuntime}
          onUpdateIndependentModel={handleUpdateIndependentModel}
        />
      ) : null}

      {view === "operations" ? (
        <OperationsPage
          overview={overview}
          language={language}
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
          onToolDetect={() => void loadCodexToolPaths(true)}
          onToolSave={(kind) => void handleToolPath(kind, "save")}
          onToolReset={(kind) => void handleToolPath(kind, "reset")}
        />
      ) : null}

      {view === "usage" ? <UsagePage overview={overview} language={language} bridge={bridge} /> : null}
    </DesktopShell>
  );
}
