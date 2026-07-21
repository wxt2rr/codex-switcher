import { useMemo, useState } from "react";
import { ArrowDownToLine, FilePenLine, FileText, FolderPlus, History, Network, Search, Shuffle, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccountPoolInput, AccountPoolStatus, DesktopEnvEditableFiles, DesktopEnvFileHistoryEntry } from "../bridge";
import {
  EmptyList,
  IconActionButton,
  ListCard,
  ListPageFrame,
  ListStack,
  SoftBadge,
} from "../components/account-list-primitives";
import { ConfirmDialog, SidePanel } from "../components/admin-primitives";
import { Field, Input, Select, Textarea } from "../components/form-primitives";
import type { EnvironmentRouteStatus, EnvSummary, OverviewPayload } from "../desktop-model";
import { getDesktopCopy } from "../desktop-copy";
import { getTranslations, type UiLanguage } from "../i18n";

function pageTitle(language: UiLanguage) {
  if (language === "zh") return "环境管理";
  if (language === "ja") return "環境管理";
  return "Environment Management";
}

function pageSubtitle(language: UiLanguage) {
  if (language === "zh") return "管理 Codex 环境、路径和账号归属";
  if (language === "ja") return "Codex 環境、パス、アカウントを管理";
  return "Manage Codex environments, paths, and account ownership";
}

type HistoryFileType = "config.toml" | "auth.json";

type HistorySnapshotGroup = {
  key: string;
  createdAt: string;
  source: DesktopEnvFileHistoryEntry["source"];
  files: Record<
    HistoryFileType,
    {
      entryId?: string;
      content: string;
      changed: boolean;
    }
  >;
};

function localizeHistorySource(source: DesktopEnvFileHistoryEntry["source"], language: UiLanguage) {
  if (language === "zh") {
    if (source === "switch-cli") return "切换 CLI";
    if (source === "switch-app") return "切换 App";
    if (source === "restore") return "还原";
    return "手动修改";
  }
  if (source === "switch-cli") return "Switch CLI";
  if (source === "switch-app") return "Switch App";
  if (source === "restore") return "Restore";
  return "Manual edit";
}

function formatHistoryTimestamp(value: string) {
  return value.replace("T", " ").replace("Z", "");
}

function buildHistorySnapshotGroups(entries: DesktopEnvFileHistoryEntry[]): HistorySnapshotGroup[] {
  const groups = new Map<string, HistorySnapshotGroup>();

  for (const entry of entries) {
    const key = `${entry.createdAt}__${entry.source}`;
    const current = groups.get(key) ?? {
      key,
      createdAt: entry.createdAt,
      source: entry.source,
      files: {
        "config.toml": { content: "", changed: false },
        "auth.json": { content: "", changed: false },
      },
    };

    current.files[entry.fileType] = {
      entryId: entry.id,
      content: entry.content,
      changed: true,
    };
    groups.set(key, current);
  }

  return Array.from(groups.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function EnvCard({
  env,
  language,
  accountCount,
  busy,
  onEdit,
  onConfig,
  onHistory,
  onDelete,
  routeStatus,
  canRoute,
  onToggleRoute,
  poolStatus,
  onOpenPool,
}: {
  env: EnvSummary;
  language: UiLanguage;
  accountCount: number;
  busy: boolean;
  onEdit: () => void;
  onConfig: () => void;
  onHistory: () => void;
  onDelete: () => void;
  routeStatus?: EnvironmentRouteStatus;
  canRoute: boolean;
  onToggleRoute: () => void;
  poolStatus?: AccountPoolStatus;
  onOpenPool: () => void;
}) {
  return (
    <ListCard className="responsive-record-row responsive-environment-row grid min-h-[94px] items-center gap-5">
      <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950">{env.name}</h3>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {env.isCurrentCli ? <SoftBadge tone="brand" label="CLI" className="h-5 px-2 text-[10px]" /> : null}
            {env.isCurrentApp ? <SoftBadge tone="brand" label="App" className="h-5 px-2 text-[10px]" /> : null}
            <SoftBadge tone="neutral" label={language === "zh" ? `${accountCount} 个账号` : `${accountCount} accounts`} className="h-5 px-2 text-[10px]" />
            {routeStatus?.enabled ? (
              <SoftBadge
                tone="success"
                className="h-5 px-2 text-[10px]"
                label={
                  language === "zh"
                    ? `已开启路由 · 127.0.0.1:${routeStatus.port} · ${routeStatus.routedAccounts} 个账号`
                    : language === "ja"
                      ? `ルート有効 · 127.0.0.1:${routeStatus.port} · ${routeStatus.routedAccounts} アカウント`
                      : `Routing enabled · 127.0.0.1:${routeStatus.port} · ${routeStatus.routedAccounts} accounts`
                }
              />
            ) : null}
          </div>
      </div>

      <div className="responsive-priority-tertiary flex min-w-0 items-center pl-5">
        <div className="truncate font-mono text-[11px] text-slate-500" title={env.path}>{env.path}</div>
      </div>

      <div className="responsive-priority-secondary flex min-w-0 items-center pl-5">
        <div className="flex gap-1.5">
          <SoftBadge tone={env.isCurrentCli ? "brand" : "neutral"} label="CLI" className="h-5 px-2 text-[10px]" />
          <SoftBadge tone={env.isCurrentApp ? "brand" : "neutral"} label="App" className="h-5 px-2 text-[10px]" />
        </div>
      </div>

      <div className="responsive-actions">
        <IconActionButton icon={<Network className="size-4" />} label={language === "zh" ? (routeStatus?.enabled ? "关闭路由" : "开启路由") : (routeStatus?.enabled ? "Disable route" : "Enable route")} onClick={onToggleRoute} disabled={busy || (!canRoute && !routeStatus?.enabled)} active={routeStatus?.enabled} />
        <IconActionButton icon={<Shuffle className="size-4" />} label={language === "zh" ? "账号池" : "Account pool"} onClick={onOpenPool} disabled={busy || !canRoute} active={Boolean(poolStatus?.enabled)} />
        <IconActionButton icon={<FilePenLine className="size-4" />} label={language === "zh" ? "编辑" : "Edit"} onClick={onEdit} disabled={busy} />
        <IconActionButton icon={<FileText className="size-4" />} label={language === "zh" ? "修改" : "Modify"} onClick={onConfig} disabled={busy} />
        <IconActionButton icon={<History className="size-4" />} label={language === "zh" ? "历史" : "History"} onClick={onHistory} disabled={busy} />
        <button
          type="button"
          className="motion-interactive-color flex size-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
          onClick={onDelete}
          disabled={busy}
          aria-label={language === "zh" ? "删除" : "Delete"}
          title={language === "zh" ? "删除" : "Delete"}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </ListCard>
  );
}

export function EnvironmentsPage({
  overview,
  language,
  busy,
  envDraft,
  envSourceDraft,
  envDeleteDraft,
  onEnvDraftChange,
  onEnvSourceDraftChange,
  onEnvDeleteDraftChange,
  onCreateEnv,
  onUpdateEnv,
  onReadEnvFiles,
  onUpdateEnvFiles,
  onListEnvFileHistory,
  onRestoreEnvFileHistory,
  onDeleteEnvFileHistory,
  onImportDefaultEnv,
  onDeleteEnv,
  routeStatuses,
  onToggleRoute,
  accountPools,
  onSaveAccountPool,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  busy: boolean;
  envDraft: string;
  envSourceDraft: string;
  envDeleteDraft: string;
  onEnvDraftChange: (value: string) => void;
  onEnvSourceDraftChange: (value: string) => void;
  onEnvDeleteDraftChange: (value: string) => void;
  onCreateEnv: () => Promise<boolean>;
  onUpdateEnv: (envName: string, nextEnvName: string, homePath: string) => Promise<boolean>;
  onReadEnvFiles: (envName: string) => Promise<DesktopEnvEditableFiles | null>;
  onUpdateEnvFiles: (envName: string, files: DesktopEnvEditableFiles) => Promise<boolean>;
  onListEnvFileHistory: (envName: string) => Promise<DesktopEnvFileHistoryEntry[]>;
  onRestoreEnvFileHistory: (envName: string, entryId: string) => Promise<boolean>;
  onDeleteEnvFileHistory: (envName: string, entryIds: string[]) => Promise<boolean>;
  onImportDefaultEnv: (envName: string) => void;
  onDeleteEnv: () => void;
  routeStatuses: EnvironmentRouteStatus[];
  onToggleRoute: (envName: string, enabled: boolean) => Promise<void>;
  accountPools: AccountPoolStatus[];
  onSaveAccountPool: (input: AccountPoolInput) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEnvName, setEditEnvName] = useState("");
  const [editNextEnvName, setEditNextEnvName] = useState("");
  const [editHomePath, setEditHomePath] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [configEnvName, setConfigEnvName] = useState("");
  const [configContent, setConfigContent] = useState("");
  const [authContent, setAuthContent] = useState("");
  const [configTab, setConfigTab] = useState<"config.toml" | "auth.json">("config.toml");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEnvName, setHistoryEnvName] = useState("");
  const [historyEntries, setHistoryEntries] = useState<DesktopEnvFileHistoryEntry[]>([]);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "config.toml" | "auth.json">("all");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolEnvName, setPoolEnvName] = useState("");
  const [poolProtocol, setPoolProtocol] = useState<"responses" | "chat_completions">("responses");
  const [poolMembers, setPoolMembers] = useState<string[]>([]);
  const [poolWeights, setPoolWeights] = useState<Record<string, number>>({});
  const [poolTtl, setPoolTtl] = useState("1440");
  const [poolSameAccountFailures, setPoolSameAccountFailures] = useState("1");
  const [poolFailover, setPoolFailover] = useState("1");
  const pageCopy = getDesktopCopy(language);
  const text = getTranslations(language);

  const accountCountByEnv = useMemo(() => {
    const map = new Map<string, number>();
    for (const account of overview.accounts) {
      map.set(account.envName, (map.get(account.envName) ?? 0) + 1);
    }
    return map;
  }, [overview.accounts]);

  const filteredEnvs = useMemo(() => {
    return overview.envs.filter((env) => {
      return (
        !search.trim() ||
        env.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        env.path.toLowerCase().includes(search.trim().toLowerCase())
      );
    });
  }, [overview.envs, search]);

  const visibleHistoryEntries = useMemo(() => {
    return historyEntries.filter((entry) => historyFilter === "all" || entry.fileType === historyFilter);
  }, [historyEntries, historyFilter]);
  const historyGroups = useMemo(() => buildHistorySnapshotGroups(visibleHistoryEntries), [visibleHistoryEntries]);

  const selectedDeleteEnv = overview.envs.find((env) => env.name === envDeleteDraft.trim()) ?? null;
  const selectedDeleteAccounts = selectedDeleteEnv ? accountCountByEnv.get(selectedDeleteEnv.name) ?? 0 : 0;
  const poolEnvAccounts = overview.accounts.filter((account) => account.envName === poolEnvName
    && (poolProtocol === "responses"
      ? account.runtime.apiProtocol !== "chat_completions" || account.authMode === "auth"
      : account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"));
  const poolStatus = accountPools.find((pool) => pool.envName === poolEnvName);

  function openPoolEditor(envName: string) {
    const current = accountPools.find((pool) => pool.envName === envName);
    const available = overview.accounts.filter((account) => account.envName === envName
      && (current?.protocol === "chat_completions"
        ? account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"
        : account.runtime.apiProtocol !== "chat_completions" || account.authMode === "auth"));
    setPoolEnvName(envName);
    setPoolProtocol(current?.protocol ?? "responses");
    setPoolMembers(current?.members.filter((member) => member.enabled).map((member) => member.accountName) ?? available.map((account) => account.name));
    setPoolWeights(Object.fromEntries((current?.members ?? available.map((account, index) => ({ accountName: account.name, weight: 1, priority: index, enabled: true }))).map((member) => [member.accountName, member.weight])));
    setPoolTtl(String(current?.sessionTtlMinutes ?? 1440));
    setPoolSameAccountFailures(String(current?.maxSameAccountFailures ?? 1));
    setPoolFailover(String(current?.maxFailoverAttempts ?? 1));
    setPoolOpen(true);
  }

  return (
    <ListPageFrame className="overflow-hidden" contentClassName="h-full gap-3">
      <div className="shrink-0 flex flex-col gap-4">
        <div><h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950">{pageTitle(language)}</h2><p className="mt-1 text-[13px] leading-6 text-slate-500">{pageSubtitle(language)}</p></div>
        <div className="rounded-[14px] border border-black/[0.05] bg-white px-3 py-2.5">
          <div className="responsive-toolbar flex items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={pageCopy.environments.searchPlaceholder} className="h-8 rounded-lg border-transparent bg-[#fbfbfc] pl-10 text-[12px] shadow-none" /></div>
            <Button
              className="ml-auto h-8 rounded-lg bg-neutral-950 px-3.5 text-[12px] shadow-none"
              onClick={() => setDrawerOpen(true)}
              disabled={busy}
            >
              <FolderPlus className="size-4" />
              {pageCopy.environments.create}
            </Button>
          </div>
        </div>
      </div>

      <ListStack>
          {filteredEnvs.length === 0 ? (
            <EmptyList title={overview.envs.length === 0 ? pageCopy.environments.emptyListTitle : pageCopy.environments.emptyFilterTitle} />
          ) : null}
          {filteredEnvs.map((env) => (
            <EnvCard
              key={env.name}
              env={env}
              language={language}
              accountCount={accountCountByEnv.get(env.name) ?? 0}
              busy={busy}
              routeStatus={routeStatuses.find((item) => item.envName === env.name)}
              poolStatus={accountPools.find((item) => item.envName === env.name)}
                  canRoute={overview.accounts.some((account) => account.envName === env.name)}
              onToggleRoute={() => {
                const activePool = accountPools.find((item) => item.envName === env.name && item.enabled);
                if (activePool) {
                  void onSaveAccountPool({ envName: env.name, enabled: false, protocol: activePool.protocol, members: [] });
                } else {
                  void onToggleRoute(env.name, !routeStatuses.find((item) => item.envName === env.name)?.enabled);
                }
              }}
              onOpenPool={() => openPoolEditor(env.name)}
              onEdit={() => {
                setEditEnvName(env.name);
                setEditNextEnvName(env.name);
                setEditHomePath(env.path);
                setEditOpen(true);
              }}
              onConfig={async () => {
                const files = await onReadEnvFiles(env.name);
                if (files === null) return;
                setConfigEnvName(env.name);
                setConfigContent(files.configToml);
                setAuthContent(files.authJson);
                setConfigTab("config.toml");
                setConfigOpen(true);
              }}
              onHistory={async () => {
                setHistoryEnvName(env.name);
                setHistorySelection([]);
                setHistoryFilter("all");
                setHistoryEntries(await onListEnvFileHistory(env.name));
                setHistoryOpen(true);
              }}
              onDelete={() => {
                onEnvDeleteDraftChange(env.name);
                setDeleteOpen(true);
              }}
            />
          ))}
      </ListStack>

      <SidePanel open={drawerOpen} title={pageCopy.environments.createTitle} onClose={() => setDrawerOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Input value={envDraft} onChange={(event) => onEnvDraftChange(event.target.value)} placeholder={text.inputs.newEnv} />
          </Field>
          <Field label={pageCopy.environments.source}>
            <Select
              value={envSourceDraft}
              onValueChange={onEnvSourceDraftChange}
              items={[
                { value: "default", label: text.labels.defaultValue },
                { value: "empty", label: text.labels.emptySource },
                ...overview.envs.map((env) => ({ value: env.name, label: env.name })),
              ]}
            />
          </Field>
          <Button
            className="w-full"
            onClick={async () => {
              if (await onCreateEnv()) setDrawerOpen(false);
            }}
            disabled={busy}
          >
            {pageCopy.environments.create}
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={poolOpen} title={language === "zh" ? `${poolEnvName} · 账号池` : `${poolEnvName} · Account pool`} onClose={() => setPoolOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <div className="rounded-lg bg-[#f7f8fa] px-4 py-3 text-xs leading-5 text-slate-600">
            {language === "zh" ? "新会话按权重选择账号，同一会话优先保持原账号；只有限流、额度或网络失败才会自动切换。Responses 模式支持 AUTH 与 API Key 混合自动分发。" : "New sessions use weighted selection and stay on one account; failover is limited to rate, quota, and network failures. Responses pools can mix AUTH and API-key accounts."}
          </div>
          {poolStatus?.health.length ? <div className="grid gap-2 sm:grid-cols-2">
            {poolStatus.health.map((item) => <div key={item.accountName} className="flex items-center justify-between rounded-lg border border-black/[0.05] bg-white px-3 py-2 text-xs">
              <span className="truncate font-medium text-neutral-800">{item.accountName}</span>
              <SoftBadge tone={item.state === "healthy" ? "success" : item.state === "cooldown" ? "warn" : "neutral"} label={item.state === "healthy" ? (language === "zh" ? "可用" : "Healthy") : item.state === "cooldown" ? (language === "zh" ? "冷却中" : "Cooldown") : item.state} />
            </div>)}
          </div> : null}
          <Field label={language === "zh" ? "协议" : "Protocol"}>
            <Select value={poolProtocol} onValueChange={(value) => {
              const nextProtocol = value as "responses" | "chat_completions";
              setPoolProtocol(nextProtocol);
              setPoolMembers(overview.accounts.filter((account) => account.envName === poolEnvName
                && (nextProtocol === "responses"
                  ? account.runtime.apiProtocol !== "chat_completions" || account.authMode === "auth"
                  : account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"))
                .map((account) => account.name));
            }} items={[{ value: "responses", label: "Responses" }, { value: "chat_completions", label: "Chat Completions" }]} />
          </Field>
          <Field label={language === "zh" ? "分发策略" : "Dispatch strategy"}>
            <div className="rounded-lg bg-[#f7f8fa] px-3 py-2 text-sm text-slate-700">{language === "zh" ? "会话粘性 + 加权轮询" : "Sticky session + weighted round robin"}</div>
          </Field>
          <Field label={language === "zh" ? "参与轮询的账号" : "Pool members"}>
            <div className="space-y-2 rounded-lg bg-[#f7f8fa] p-3">
              {poolEnvAccounts.map((account, index) => {
                const selected = poolMembers.includes(account.name);
                return <label key={account.name} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                  <input type="checkbox" checked={selected} onChange={(event) => setPoolMembers((current) => event.target.checked ? [...current, account.name] : current.filter((name) => name !== account.name))} />
                  <span className="min-w-0 flex-1 truncate">{account.name}</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={String(poolWeights[account.name] ?? 1)}
                    onChange={(event) => setPoolWeights((current) => ({ ...current, [account.name]: Number(event.target.value) || 1 }))}
                    className="h-7 w-16 text-xs"
                    disabled={!selected}
                    aria-label={`${account.name} ${language === "zh" ? "分配权重" : "distribution weight"}`}
                    title={language === "zh" ? "分配权重：数值越高，新会话分配到该账号的概率越高" : "Distribution weight: higher values receive more new sessions"}
                  />
                  <span
                    className="text-[10px] text-slate-400"
                    title={language === "zh" ? "轮询顺序：权重相同时按此顺序选择账号" : "Rotation order used when weights are equal"}
                  >#{index + 1}</span>
                </label>;
              })}
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={language === "zh" ? "会话保持时长（分钟）" : "Session affinity (min)"}
              hint={language === "zh" ? "同一会话在此时间内优先使用原账号，提高缓存命中率" : "Prefer the original account during this period to improve cache hits"}
            ><Input type="number" min={5} max={10080} value={poolTtl} onChange={(event) => setPoolTtl(event.target.value)} /></Field>
            <Field
              label={language === "zh" ? "同一账号最多失败次数" : "Failures before switching"}
              hint={language === "zh" ? "单次请求内，当前账号连续失败达到此次数后才切换账号" : "Retry the current account until this many failures occur in one request"}
            ><Input type="number" min={1} max={3} value={poolSameAccountFailures} onChange={(event) => setPoolSameAccountFailures(event.target.value)} /></Field>
            <Field
              label={language === "zh" ? "单次请求最多切换账号次数" : "Maximum account switches"}
              hint={language === "zh" ? "当前账号达到失败次数后，最多再切换到几个其它账号" : "Maximum number of other accounts tried after the current account fails"}
            ><Input type="number" min={0} max={1} value={poolFailover} onChange={(event) => setPoolFailover(event.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setPoolOpen(false)}>{pageCopy.common.cancel}</Button>
            {poolStatus ? <Button variant="destructive" onClick={async () => { if (await onSaveAccountPool({ envName: poolEnvName, enabled: false, protocol: poolProtocol, members: [] })) setPoolOpen(false); }}>{language === "zh" ? "关闭账号池" : "Disable pool"}</Button> : null}
            <Button onClick={async () => { if (poolMembers.length && await onSaveAccountPool({ envName: poolEnvName, enabled: true, protocol: poolProtocol, members: poolMembers.map((accountName, priority) => ({ accountName, priority, weight: poolWeights[accountName] ?? 1 })), sessionTtlMinutes: Number(poolTtl), maxSameAccountFailures: Number(poolSameAccountFailures), maxFailoverAttempts: Number(poolFailover) })) setPoolOpen(false); }} disabled={busy || poolMembers.length === 0}>{language === "zh" ? "保存账号池" : "Save pool"}</Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={editOpen} title={pageCopy.environments.editTitle} onClose={() => setEditOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Input value={editNextEnvName} onChange={(event) => setEditNextEnvName(event.target.value)} disabled={editEnvName === "default"} />
          </Field>
          <Field label={pageCopy.environments.pathColumn}>
            <Input value={editHomePath} onChange={(event) => setEditHomePath(event.target.value)} placeholder={text.inputs.baseUrl} />
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button
              variant="destructive"
              onClick={() => onImportDefaultEnv(editEnvName)}
              disabled={busy || !editEnvName || editEnvName === "default"}
            >
              <ArrowDownToLine className="size-4" />
              {pageCopy.environments.importDefault}
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{pageCopy.common.cancel}</Button>
            <Button
              onClick={async () => {
                if (await onUpdateEnv(editEnvName, editNextEnvName, editHomePath)) setEditOpen(false);
              }}
              disabled={busy}
            >
              {pageCopy.environments.save}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={configOpen}
        title={language === "zh" ? "环境文件修改" : "Environment Files"}
        onClose={() => setConfigOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["config.toml", "auth.json"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={
                  configTab === tab
                    ? "ui-selected-control rounded-lg border px-3 py-1.5 text-xs font-semibold"
                    : "rounded-lg border border-transparent bg-[#f3f4f6] px-3 py-1.5 text-xs font-semibold text-slate-600"
                }
                onClick={() => setConfigTab(tab)}
                aria-pressed={configTab === tab}
              >
                {tab}
              </button>
            ))}
          </div>
          <Field label={`${configEnvName} / ${configTab}`}>
            <Textarea
              value={configTab === "config.toml" ? configContent : authContent}
              onChange={(event) => {
                if (configTab === "config.toml") {
                  setConfigContent(event.target.value);
                } else {
                  setAuthContent(event.target.value);
                }
              }}
              className="min-h-[420px] font-mono text-[13px] leading-6"
              spellCheck={false}
            />
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setConfigOpen(false)}>{pageCopy.common.cancel}</Button>
            <Button
              onClick={async () => {
                if (await onUpdateEnvFiles(configEnvName, { configToml: configContent, authJson: authContent })) {
                  setConfigOpen(false);
                }
              }}
              disabled={busy}
            >
              {pageCopy.environments.save}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={historyOpen}
        title={language === "zh" ? "修改历史" : "Change History"}
        onClose={() => setHistoryOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-neutral-900">{historyEnvName}</div>
            <Select
              value={historyFilter}
              onValueChange={(value) => setHistoryFilter(value as "all" | "config.toml" | "auth.json")}
              items={[
                { value: "all", label: language === "zh" ? "全部文件" : "All files" },
                { value: "config.toml", label: "config.toml" },
                { value: "auth.json", label: "auth.json" },
              ]}
              className="h-8 w-[140px] rounded-lg bg-[#f7f8fa] text-[12px]"
            />
          </div>

          <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
            {historyGroups.length === 0 ? (
              <div className="rounded-lg bg-[#f7f8fa] px-4 py-10 text-center text-sm text-slate-500">
                {language === "zh" ? "暂无修改历史" : "No history yet"}
              </div>
            ) : null}
            {historyGroups.map((group) => {
              const groupIds = (["config.toml", "auth.json"] as const)
                .map((fileType) => group.files[fileType].entryId)
                .filter((value): value is string => Boolean(value));
              const selected = groupIds.length > 0 && groupIds.every((id) => historySelection.includes(id));
              return (
                <div
                  key={group.key}
                  className="rounded-lg bg-[#f7f8fa] px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        setHistorySelection((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...groupIds]))
                            : current.filter((id) => !groupIds.includes(id)),
                        );
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-neutral-900">
                        <span>{formatHistoryTimestamp(group.createdAt)}</span>
                        <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          {localizeHistorySource(group.source, language)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {(["config.toml", "auth.json"] as const).map((fileType) => {
                          const file = group.files[fileType];
                          return (
                            <div key={fileType} className="rounded-lg bg-white px-3 py-3">
                              <div className="flex items-center gap-2 text-[12px] font-semibold text-neutral-900">
                                <span>{fileType}</span>
                                <span
                                  className={
                                    file.changed
                                      ? "rounded-md bg-[#eef4ff] px-2 py-0.5 text-[10px] font-medium text-sky-700"
                                      : "rounded-md bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-medium text-slate-500"
                                  }
                                >
                                  {file.changed
                                    ? language === "zh"
                                      ? "已变更"
                                      : "Changed"
                                    : language === "zh"
                                      ? "未变更"
                                      : "Unchanged"}
                                </span>
                              </div>
                              <div className="mt-2 max-h-[140px] overflow-auto rounded-lg bg-[#fbfbfc] px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 whitespace-pre-wrap break-all">
                                {file.changed
                                  ? file.content || (language === "zh" ? "空文件" : "Empty file")
                                  : language === "zh"
                                    ? "该次修改中此文件未发生变化。"
                                    : "This file did not change in this snapshot."}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-lg bg-white text-slate-600"
                      onClick={async () => {
                        let restored = false;
                        for (const entryId of groupIds) {
                          // Restore both files that were actually recorded in this snapshot.
                          restored = (await onRestoreEnvFileHistory(historyEnvName, entryId)) || restored;
                        }
                        if (restored) {
                          setHistoryEntries(await onListEnvFileHistory(historyEnvName));
                        }
                      }}
                      aria-label={language === "zh" ? "还原" : "Restore"}
                      title={language === "zh" ? "还原" : "Restore"}
                      disabled={busy || groupIds.length === 0}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {pageCopy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (historySelection.length === 0) return;
                if (await onDeleteEnvFileHistory(historyEnvName, historySelection)) {
                  setHistoryEntries(await onListEnvFileHistory(historyEnvName));
                  setHistorySelection([]);
                }
              }}
              disabled={busy || historySelection.length === 0}
            >
              <Trash2 className="size-4" />
              {language === "zh" ? `删除所选 (${historySelection.length})` : `Delete Selected (${historySelection.length})`}
            </Button>
          </div>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={deleteOpen}
        title={pageCopy.environments.deleteTitle}
        impact={
          selectedDeleteEnv ? (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.environment}</span>
                <span className="font-medium text-neutral-700">{selectedDeleteEnv.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.environments.countColumn}</span>
                <span className="font-medium text-neutral-700">{selectedDeleteAccounts}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">{pageCopy.environments.deleteMissing}</div>
          )
        }
        confirmLabel={pageCopy.environments.deleteConfirm}
        cancelLabel={pageCopy.common.cancel}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onDeleteEnv();
          setDeleteOpen(false);
        }}
      />
    </ListPageFrame>
  );
}
