import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpCircle,
  Check,
  ExternalLink,
  FolderCog,
  Info,
  Link2,
  LoaderCircle,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { ConfirmDialog, SidePanel } from "../components/admin-primitives";
import { ListCard, ListLoadingState, ListPageFrame } from "../components/account-list-primitives";
import { Field, Input, Select } from "../components/form-primitives";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type {
  DesktopBridge,
  InstalledSkill,
  MarketplaceSkill,
  ProviderBinding,
  SkillManagerSnapshot,
  SkillProviderId,
  SkillScope,
} from "../bridge";
import type { UiLanguage } from "../i18n";

interface BindingDraft {
  enabled: boolean;
  sourceEnv?: string;
  targetPath: string;
}

type SkillDetailSelection =
  | { kind: "marketplace"; skill: MarketplaceSkill }
  | { kind: "installed"; skill: InstalledSkill };

export function SkillsPage({
  bridge,
  language,
  onSuccess,
  onError,
}: {
  bridge: DesktopBridge;
  language: UiLanguage;
  onSuccess: (message: string) => void;
  onError: (error: unknown) => void;
}) {
  const zh = language === "zh";
  const ja = language === "ja";
  const [snapshot, setSnapshot] = useState<SkillManagerSnapshot>();
  const [activeScopeId, setActiveScopeId] = useState("marketplace");
  const [marketplaceSourceId, setMarketplaceSourceId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string>();
  const [syncOpen, setSyncOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [skillName, setSkillName] = useState("");
  const [removeSkill, setRemoveSkill] = useState<InstalledSkill>();
  const [skillDetail, setSkillDetail] = useState<SkillDetailSelection>();
  const [updates, setUpdates] = useState<Record<string, boolean>>({});
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, BindingDraft>>({});
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [customProviderName, setCustomProviderName] = useState("");
  const [customProviderPath, setCustomProviderPath] = useState("");
  const [removeProvider, setRemoveProvider] = useState<ProviderBinding>();
  const scopeScrollerRef = useRef<HTMLDivElement>(null);
  const [scopeOverflow, setScopeOverflow] = useState({ left: false, right: false });

  useEffect(() => { void loadSnapshot(); }, []);

  useEffect(() => {
    const scroller = scopeScrollerRef.current;
    if (!scroller) return;
    const update = () => {
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      setScopeOverflow({ left: scroller.scrollLeft > 1, right: scroller.scrollLeft < maxScrollLeft - 1 });
    };
    update();
    const frame = requestAnimationFrame(update);
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [snapshot?.scopes.length]);

  async function loadSnapshot(refreshMarketplace = false, preserveBindingDrafts = false, sourceId = marketplaceSourceId) {
    setLoading(true);
    try {
      const next = await bridge.getSkillSnapshot({ refreshMarketplace, ...(sourceId ? { marketplaceSourceId: sourceId } : {}) });
      setSnapshot(next);
      setMarketplaceSourceId(next.marketplace.sourceId);
      setBindingDrafts((current) => Object.fromEntries(next.bindings.map((binding) => [binding.providerId,
        preserveBindingDrafts && current[binding.providerId] ? current[binding.providerId] : {
          enabled: binding.enabled,
          sourceEnv: binding.sourceEnv,
          targetPath: binding.targetPath,
        },
      ])));
      if (!next.scopes.some((scope) => scope.id === activeScopeId)) setActiveScopeId("marketplace");
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }

  const activeScope = snapshot?.scopes.find((scope) => scope.id === activeScopeId);
  const codexScopes = snapshot?.scopes.filter((scope) => scope.kind === "codex") ?? [];
  const defaultCodexScope = codexScopes.find((scope) => scope.envName === "default") ?? codexScopes[0];
  const normalizedQuery = query.trim().toLowerCase();
  const marketItems = useMemo(() => (snapshot?.marketplace.items ?? []).filter((skill) =>
    !normalizedQuery || `${skill.name} ${skill.slug} ${skill.source} ${skill.description ?? ""}`.toLowerCase().includes(normalizedQuery)),
  [snapshot?.marketplace.items, normalizedQuery]);
  const installedItems = useMemo(() => (activeScope?.skills ?? []).filter((skill) =>
    !normalizedQuery || `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(normalizedQuery)),
  [activeScope?.skills, normalizedQuery]);
  const providerBindings = snapshot?.bindings ?? [];
  const enabledSyncScopes = codexScopes.length + providerBindings.filter((binding) => binding.enabled).length;
  const totalSyncScopes = codexScopes.length + providerBindings.length;

  function beginGitInstall() {
    setSourceUrl("");
    setSkillName("");
    setInstallOpen(true);
  }

  function installEnvironmentNames(): string[] {
    return [...new Set([
      ...codexScopes.map((scope) => scope.envName),
      ...(snapshot?.bindings ?? [])
        .filter((binding) => binding.enabled)
        .map((binding) => binding.sourceEnv),
    ].filter((value): value is string => Boolean(value)))];
  }

  async function installIntoSyncedEnvironments(input: { sourceUrl: string; skillName?: string; sourcePath?: string; ref?: string }) {
    const codexTargets = installEnvironmentNames();
    if (!codexTargets.length) throw new Error(zh ? "未找到可用的 Codex 环境" : "No Codex environment is available");
    for (const envName of codexTargets) {
      const scope = codexScopes.find((item) => item.envName === envName);
      if (input.skillName && scope?.skills.some((skill) => skill.id === input.skillName)) continue;
      await bridge.installSkill({ envName, sourceUrl: input.sourceUrl, skillName: input.skillName || undefined, sourcePath: input.sourcePath, ref: input.ref });
    }
    await loadSnapshot();
  }

  async function installMarketplaceSkill(skill: MarketplaceSkill) {
    if (busy) return;
    setBusy(true);
    setInstallingSkillId(skill.id);
    try {
      await installIntoSyncedEnvironments({ sourceUrl: skill.installUrl, skillName: skill.slug, sourcePath: skill.sourcePath, ref: skill.requestedRef });
      onSuccess(zh ? "Skill 已安装到全部 Codex 环境，已开启的服务商目录将自动同步" : ja ? "すべての Codex 環境に Skill をインストールしました" : "Skill installed in every Codex environment; enabled provider directories will sync automatically");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
      setInstallingSkillId(undefined);
    }
  }

  async function installFromGit() {
    if (busy || !sourceUrl.trim()) return;
    setBusy(true);
    try {
      await installIntoSyncedEnvironments({ sourceUrl: sourceUrl.trim(), skillName: skillName.trim() || undefined });
      setInstallOpen(false);
      onSuccess(zh ? "Skill 已安装到全部 Codex 环境，已开启的服务商目录将自动同步" : ja ? "すべての Codex 環境に Skill をインストールしました" : "Skill installed in every Codex environment; enabled provider directories will sync automatically");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function checkUpdates(scope: SkillScope) {
    if (!scope.envName) return;
    setBusy(true);
    try {
      setUpdates(await bridge.checkSkillUpdates(scope.envName));
      onSuccess(zh ? "更新检查完成" : ja ? "更新確認が完了しました" : "Update check complete");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function update(skill: InstalledSkill) {
    const scope = snapshot?.scopes.find((item) => item.id === skill.scopeId);
    if (!scope?.envName) return;
    setBusy(true);
    try {
      await bridge.updateSkill({ envName: scope.envName, skillId: skill.id });
      await loadSnapshot();
      setUpdates((current) => ({ ...current, [skill.id]: false }));
      onSuccess(zh ? "Skill 已更新" : ja ? "Skill を更新しました" : "Skill updated");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function uninstall() {
    if (!removeSkill) return;
    const scope = snapshot?.scopes.find((item) => item.id === removeSkill.scopeId);
    if (!scope?.envName) return;
    setBusy(true);
    try {
      await bridge.uninstallSkill(scope.envName, removeSkill.id);
      setRemoveSkill(undefined);
      await loadSnapshot();
      onSuccess(zh ? "Skill 已卸载" : ja ? "Skill をアンインストールしました" : "Skill uninstalled");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function saveBindings() {
    if (!snapshot) return;
    setBusy(true);
    try {
      for (const binding of snapshot.bindings) {
        const draft = bindingDrafts[binding.providerId];
        if (!draft) continue;
        const changed = draft.enabled !== binding.enabled || draft.sourceEnv !== binding.sourceEnv || draft.targetPath !== binding.targetPath;
        if (!changed) continue;
        await bridge.setSkillProviderBinding({
          providerId: binding.providerId,
          enabled: draft.enabled,
          sourceEnv: draft.enabled ? draft.sourceEnv : undefined,
          targetPath: draft.targetPath,
        });
      }
      setSyncOpen(false);
      await loadSnapshot();
      onSuccess(zh ? "服务商同步已更新" : ja ? "プロバイダー同期を更新しました" : "Provider sync updated");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function createProvider() {
    if (busy || !customProviderName.trim() || !customProviderPath.trim()) return;
    setBusy(true);
    try {
      await bridge.createSkillProvider({ name: customProviderName.trim(), targetPath: customProviderPath.trim() });
      setCustomProviderName("");
      setCustomProviderPath("");
      setAddProviderOpen(false);
      await loadSnapshot(false, true);
      onSuccess(zh ? "自定义服务商已添加" : ja ? "カスタムプロバイダーを追加しました" : "Custom provider added");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function deleteProvider() {
    if (!removeProvider || busy) return;
    setBusy(true);
    try {
      await bridge.deleteSkillProvider(removeProvider.providerId);
      if (activeScopeId === `provider:${removeProvider.providerId}`) setActiveScopeId("marketplace");
      setRemoveProvider(undefined);
      await loadSnapshot(false, true);
      onSuccess(zh ? "自定义服务商已删除" : ja ? "カスタムプロバイダーを削除しました" : "Custom provider deleted");
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  function updateBinding(providerId: SkillProviderId, patch: Partial<BindingDraft>) {
    setBindingDrafts((current) => {
      const existing = current[providerId] ?? { enabled: false, targetPath: "" };
      return { ...current, [providerId]: { ...existing, ...patch } };
    });
  }

  function selectScope(scopeId: string) {
    setActiveScopeId(scopeId);
    setQuery("");
    setUpdates({});
  }

  function selectMarketplaceSource(sourceId: string) {
    setMarketplaceSourceId(sourceId);
    setQuery("");
    setUpdates({});
    void loadSnapshot(false, false, sourceId);
  }

  const title = activeScope?.kind === "marketplace"
    ? (zh ? "Skill 市场" : ja ? "Skill マーケット" : "Skill Marketplace")
    : activeScope?.name ?? (zh ? "Skills" : "Skills");
  const subtitle = activeScope?.kind === "marketplace"
      ? (snapshot?.marketplace.status === "live" || snapshot?.marketplace.status === "cached"
      ? (zh ? `${snapshot.marketplace.sourceName} · ${snapshot.marketplace.items.length} 个 Skill${snapshot.marketplace.status === "cached" ? " · 缓存" : ""}` : `${snapshot.marketplace.sourceName} · ${snapshot.marketplace.items.length} skills${snapshot.marketplace.status === "cached" ? " · cached" : ""}`)
      : snapshot?.marketplace.message ?? (zh ? "浏览并安装可复用的 Agent Skill" : "Browse and install reusable agent skills"))
    : activeScope?.path ?? "";

  return (
    <ListPageFrame className="overflow-hidden" contentClassName="h-full gap-3">
        <div className="relative z-20 shrink-0 flex flex-col gap-3 [-webkit-app-region:no-drag]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50">{title}</h2>
              <p className="mt-1 truncate text-[13px] leading-6 text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSyncOpen(true)}>
                <Link2 className="size-4" />
                {zh
                  ? `服务商目录同步 ${enabledSyncScopes}/${totalSyncScopes}`
                  : ja
                    ? `プロバイダーディレクトリ同期 ${enabledSyncScopes}/${totalSyncScopes}`
                    : `Provider directory sync ${enabledSyncScopes}/${totalSyncScopes}`}
              </Button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[14px] border border-black/[0.05] bg-white px-2.5 py-2 dark:border-white/[0.07] dark:bg-[#141a22]">
            <div ref={scopeScrollerRef} className="horizontal-scroll-no-bar overflow-x-auto">
            <div className="flex min-w-max items-center gap-1.5" role="tablist" aria-label={zh ? "Skill 范围" : "Skill scopes"}>
              {(snapshot?.scopes ?? [{ id: "marketplace", kind: "marketplace" as const, name: "Marketplace", skills: [] }]).map((scope) => (
                <button key={scope.id} type="button" role="tab" aria-selected={activeScopeId === scope.id}
                  data-skill-scope-id={scope.id} onClick={() => selectScope(scope.id)}
                  className={cn(
                    "h-8 rounded-lg border border-transparent px-3.5 text-[12px] font-semibold transition-[background-color,color,border-color,transform] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] [-webkit-app-region:no-drag]",
                    activeScopeId === scope.id
                      ? "ui-selected-control"
                      : "text-slate-500 hover:bg-[#f3f4f6] hover:text-neutral-900 dark:text-slate-400 dark:hover:bg-[#1b2129] dark:hover:text-white",
                  )}>
                  {scope.id === "marketplace" ? (zh ? "市场" : ja ? "マーケット" : "Marketplace") : scope.name}
                </button>
              ))}
            </div>
            </div>
            <div aria-hidden="true" data-visible={scopeOverflow.left} className="skill-scope-edge-fade skill-scope-edge-fade-left" />
            <div aria-hidden="true" data-visible={scopeOverflow.right} className="skill-scope-edge-fade skill-scope-edge-fade-right" />
          </div>

          <div className="rounded-[14px] border border-black/[0.05] bg-white px-3 py-2.5 dark:border-white/[0.07] dark:bg-[#141a22]">
            <div className="responsive-toolbar flex items-center gap-2.5">
            <div className="relative min-w-[220px] max-w-[520px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder={activeScopeId === "marketplace" ? (zh ? "搜索市场" : "Search marketplace") : (zh ? "搜索已安装 Skill" : "Search installed skills")}
                className="h-8 rounded-lg border-transparent bg-[#fbfbfc] pl-10 text-[12px] shadow-none dark:bg-[#1b2129]" />
            </div>
            {activeScope?.kind === "marketplace" ? (
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={marketplaceSourceId}
                  onValueChange={selectMarketplaceSource}
                  openOnHover={false}
                  items={(snapshot?.catalogSources ?? []).map((source) => ({ value: source.id, label: source.name }))}
                  placeholder={zh ? "选择来源" : "Select source"}
                  className="h-8 w-[150px] border-transparent bg-[#f7f8fa] text-[12px] dark:bg-[#1b2129]"
                />
                <Button variant="secondary" size="icon" className="size-8" onClick={() => void loadSnapshot(true)} disabled={loading} title={zh ? "刷新技能列表" : "Refresh skill list"} aria-label={zh ? "刷新技能列表" : "Refresh skill list"}>
                  <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={beginGitInstall}><ArrowDownToLine className="size-4" />{zh ? "从 Git 安装" : "Install from Git"}</Button>
              </div>
            ) : activeScope?.kind === "codex" ? (
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void checkUpdates(activeScope)} disabled={busy}>
                <ArrowUpCircle className="size-4" />{zh ? "检查更新" : "Check updates"}
              </Button>
            ) : null}
            </div>
          </div>
        </div>

        <div className="page-scroll-gutter min-h-0 flex-1 overflow-y-auto">
          {loading && !snapshot ? (
            <ListLoadingState rows={5} />
          ) : activeScope?.kind === "marketplace" || activeScopeId === "marketplace" ? (
            marketItems.length ? (
              <div className="skills-grid grid grid-cols-1 gap-2.5 xl:grid-cols-2 2xl:grid-cols-3">
                {marketItems.map((skill) => <MarketplaceRow key={skill.id} skill={skill} language={language}
                  onDetail={() => setSkillDetail({ kind: "marketplace", skill })}
                  onInstall={() => void installMarketplaceSkill(skill)} installing={installingSkillId === skill.id} disabled={busy} />)}
              </div>
            ) : (
              <EmptyState icon={<PackageOpen className="size-5" />} title={zh ? "市场列表暂不可用" : "Marketplace catalog unavailable"}
                description={snapshot?.marketplace.message ?? ""}
                action={<a href={snapshot?.marketplace.externalUrl ?? "https://skills.sh"} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ExternalLink className="size-4" />skills.sh</Button></a>} />
            )
          ) : installedItems.length ? (
            <div className="skills-grid grid grid-cols-1 gap-2.5 xl:grid-cols-2 2xl:grid-cols-3">
              {installedItems.map((skill) => (
                <InstalledRow key={skill.id} skill={skill} language={language} updateAvailable={Boolean(updates[skill.id])}
                  canManage={activeScope?.kind === "codex" && skill.managed}
                  onDetail={() => setSkillDetail({ kind: "installed", skill })}
                  onUpdate={() => void update(skill)} onRemove={() => setRemoveSkill(skill)} busy={busy} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<FolderCog className="size-5" />} title={zh ? "此目录还没有 Skill" : "No skills in this directory"}
              description={activeScope?.path ?? ""} />
          )}
        </div>

      <SidePanel open={installOpen} title={zh ? "从 Git 安装" : "Install from Git"}
        description={zh
          ? "安装到全部 Codex 环境；已开启的服务商目录会按同步设置自动获得此 Skill。"
          : "Installs to every Codex environment; enabled provider directories sync it automatically."}
        onClose={() => setInstallOpen(false)} closeLabel={zh ? "关闭" : "Close"}>
        <div className="space-y-4">
          <Field label={zh ? "Git 仓库" : "Git repository"} hint={zh ? "支持 GitHub HTTPS 地址或 owner/repository" : "GitHub HTTPS URL or owner/repository"}>
            <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://github.com/owner/repository" />
          </Field>
          <Field label={zh ? "Skill 名称" : "Skill name"} hint={zh ? "仓库只有一个 Skill 时可留空" : "Optional when the repository contains one skill"}>
            <Input value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="skill-name" />
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-3 text-[12px] leading-5 text-slate-500 dark:bg-[#1b2129] dark:text-slate-400">
            {zh ? "安装过程只复制 Skill 文件，不会执行仓库脚本或安装钩子。" : "Installation copies skill files only. Repository scripts and install hooks are never executed."}
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setInstallOpen(false)}>{zh ? "取消" : "Cancel"}</Button>
            <Button onClick={() => void installFromGit()} disabled={busy || !defaultCodexScope || !sourceUrl.trim()}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}{zh ? "安装" : "Install"}
            </Button></div>
        </div>
      </SidePanel>

      <SidePanel open={syncOpen}
        title={zh ? "服务商目录同步" : ja ? "プロバイダーディレクトリ同期" : "Provider directory sync"}
        description={zh
          ? "开启后，将所选 Codex 环境中的 Skill 以软链接方式同步到对应服务商目录，无需重复安装。"
          : ja
            ? "有効にすると、選択した Codex 環境の Skill がシンボリックリンクで各プロバイダーの Skill ディレクトリに同期されるため、個別にインストールする必要はありません。"
            : "When enabled, Skills from the selected Codex environment are symlinked into the provider's Skill directory, so they do not need to be installed separately."}
        onClose={() => setSyncOpen(false)} closeLabel={zh ? "关闭" : "Close"}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{zh ? "同步目录" : ja ? "同期ディレクトリ" : "Sync directories"}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{zh ? "内置与自定义服务商统一管理" : "Manage built-in and custom providers"}</div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAddProviderOpen((value) => !value)}>
              <Plus className="size-4" />{zh ? "添加服务商" : ja ? "プロバイダーを追加" : "Add provider"}
            </Button>
          </div>
          {addProviderOpen ? (
            <section className="rounded-lg border border-black/[0.06] bg-[#f7f8fa] p-4 dark:border-white/[0.08] dark:bg-[#1b2129]">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={zh ? "服务商名称" : "Provider name"}>
                  <Input value={customProviderName} onChange={(event) => setCustomProviderName(event.target.value)} placeholder={zh ? "例如：Trae" : "For example: Trae"} maxLength={64} />
                </Field>
                <Field label={zh ? "Skill 目录" : "Skill directory"} hint={zh ? "请输入绝对路径" : "Enter an absolute path"}>
                  <Input value={customProviderPath} onChange={(event) => setCustomProviderPath(event.target.value)} placeholder="/Users/name/.provider/skills" />
                </Field>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setAddProviderOpen(false)}>{zh ? "取消" : "Cancel"}</Button>
                <Button type="button" size="sm" onClick={() => void createProvider()} disabled={busy || !customProviderName.trim() || !customProviderPath.trim()}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{zh ? "添加" : "Add"}
                </Button>
              </div>
            </section>
          ) : null}
          {codexScopes.map((scope) => <CodexEnvironmentBinding key={scope.id} scope={scope} language={language} />)}
          {(snapshot?.bindings ?? []).map((binding) => (
            <ProviderBindingEditor key={binding.providerId} binding={binding} draft={bindingDrafts[binding.providerId]}
              codexScopes={codexScopes} language={language} onChange={(patch) => updateBinding(binding.providerId, patch)}
              onDelete={binding.custom ? () => setRemoveProvider(binding) : undefined} />
          ))}
          <div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setSyncOpen(false)}>{zh ? "取消" : "Cancel"}</Button>
            <Button onClick={() => void saveBindings()} disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{zh ? "应用更改" : "Apply changes"}</Button></div>
        </div>
      </SidePanel>

      <SkillDetailPanel
        selection={skillDetail}
        language={language}
        onClose={() => setSkillDetail(undefined)}
        onInstall={(skill) => {
          setSkillDetail(undefined);
          void installMarketplaceSkill(skill);
        }}
      />

      <ConfirmDialog open={Boolean(removeSkill)} title={zh ? "卸载 Skill" : "Uninstall skill"}
        description={zh ? `将从当前 Codex 环境删除 ${removeSkill?.name ?? ""}，并清理它的受管软链接。` : `Remove ${removeSkill?.name ?? ""} from this Codex environment and clean up its managed links.`}
        confirmLabel={zh ? "卸载" : "Uninstall"} cancelLabel={zh ? "取消" : "Cancel"}
        onConfirm={() => void uninstall()} onCancel={() => setRemoveSkill(undefined)} />
      <ConfirmDialog open={Boolean(removeProvider)} title={zh ? "删除自定义服务商" : "Delete custom provider"}
        description={zh
          ? `将删除 ${removeProvider?.name ?? ""} 的同步配置，并清理 codex-switcher 管理的软链接；目录中的其它内容会保留。`
          : `Delete the sync configuration for ${removeProvider?.name ?? ""} and clean up links managed by codex-switcher. Other directory contents are preserved.`}
        confirmLabel={zh ? "删除" : "Delete"} cancelLabel={zh ? "取消" : "Cancel"}
        onConfirm={() => void deleteProvider()} onCancel={() => setRemoveProvider(undefined)} />
    </ListPageFrame>
  );
}

function MarketplaceRow({ skill, language, onDetail, onInstall, installing, disabled }: {
  skill: MarketplaceSkill; language: UiLanguage; onDetail: () => void; onInstall: () => void;
  installing: boolean; disabled: boolean;
}) {
  const zh = language === "zh";
  return (
    <ListCard className="group flex min-h-[96px] items-center gap-3 px-4 py-3.5">
      <SkillIcon label={skill.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{skill.name}</div>
        <p className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-slate-500 dark:text-slate-400">{skill.description || skill.source}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{skill.source}{skill.installs ? ` · ${formatCount(skill.installs)} installs` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-8 text-slate-500" onClick={onDetail}
          title={zh ? "查看详情" : "View details"} aria-label={zh ? `查看 ${skill.name} 详情` : `View ${skill.name} details`}><Info className="size-4" /></Button>
        <Button type="button" variant="secondary" size="sm" onClick={onInstall} disabled={disabled}
          title={zh ? "安装并同步到已启用的服务商" : "Install and sync to enabled providers"}
          aria-label={zh ? `安装 ${skill.name}` : `Install ${skill.name}`} className="px-2.5">
          {installing ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}<span>{zh ? "安装" : "Install"}</span>
        </Button>
      </div>
    </ListCard>
  );
}

function InstalledRow({ skill, language, updateAvailable, canManage, onDetail, onUpdate, onRemove, busy }: {
  skill: InstalledSkill; language: UiLanguage; updateAvailable: boolean; canManage: boolean;
  onDetail: () => void; onUpdate: () => void; onRemove: () => void; busy: boolean;
}) {
  const zh = language === "zh";
  const warning = skill.state !== "healthy";
  return (
    <ListCard className="group flex min-h-[96px] items-center gap-3 px-4 py-3.5">
      <SkillIcon label={skill.name} linked={skill.linked} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{skill.name}</div>
          {skill.linked ? <span className="shrink-0 text-[10px] text-sky-600 dark:text-sky-300">{zh ? "软链接" : "linked"}</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-slate-500 dark:text-slate-400">{skill.description || (zh ? "暂无描述" : "No description")}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{skill.linkedFrom ?? skill.path}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-8 text-slate-500" onClick={onDetail}
          title={zh ? "查看详情" : "View details"} aria-label={zh ? `查看 ${skill.name} 详情` : `View ${skill.name} details`}><Info className="size-4" /></Button>
        {updateAvailable && canManage ? <Button type="button" variant="secondary" size="icon" className="size-8 text-sky-600" onClick={onUpdate} disabled={busy} title={zh ? "更新" : "Update"}
          aria-label={zh ? "更新" : "Update"}><ArrowUpCircle className="size-4" /></Button> : null}
        {warning ? <TriangleAlert className="size-4 text-amber-500" /> : <Check className="size-4 text-slate-300" />}
        {canManage ? <Button type="button" variant="ghost" size="icon" className="size-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" onClick={onRemove} disabled={busy} title={zh ? "卸载" : "Uninstall"}
          aria-label={zh ? "卸载" : "Uninstall"}><Trash2 className="size-4" /></Button> : null}
      </div>
    </ListCard>
  );
}

function CodexEnvironmentBinding({ scope, language }: { scope: SkillScope; language: UiLanguage }) {
  const zh = language === "zh";
  const ja = language === "ja";
  return (
    <section data-codex-environment={scope.envName} className="rounded-lg border border-black/[0.06] p-4 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{scope.name}</div>
            <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{scope.path}</div>
            <div className="mt-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {zh ? `主存储 · ${scope.skills.length} 个 Skill` : ja ? `メインストレージ · ${scope.skills.length} Skill` : `Primary store · ${scope.skills.length} skills`}
            </div>
          </div>
        <label className="motion-toggle relative inline-flex h-[22px] w-[38px] shrink-0 cursor-default items-center rounded-full bg-[#34C759]" title={zh ? "Codex 环境默认开启" : "Codex environments are always enabled"}>
          <input type="checkbox" checked disabled readOnly aria-label={`${scope.name} ${zh ? "默认开启" : "always enabled"}`} className="peer sr-only" />
          <span className="motion-toggle-thumb absolute left-0 top-[2px] size-[18px] translate-x-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)]" />
        </label>
      </div>
    </section>
  );
}

function ProviderBindingEditor({ binding, draft, codexScopes, language, onChange, onDelete }: {
  binding: ProviderBinding; draft?: BindingDraft; codexScopes: SkillScope[]; language: UiLanguage;
  onChange: (patch: Partial<BindingDraft>) => void;
  onDelete?: () => void;
}) {
  const zh = language === "zh";
  const value = draft ?? { enabled: binding.enabled, sourceEnv: binding.sourceEnv, targetPath: binding.targetPath };
  return (
    <section className="rounded-lg border border-black/[0.06] p-4 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{binding.name}</div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{value.targetPath}</div></div>
        <div className="flex shrink-0 items-center gap-2">
          {onDelete ? <Button type="button" variant="ghost" size="icon" className="size-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={onDelete}
            title={zh ? "删除自定义服务商" : "Delete custom provider"} aria-label={zh ? `删除 ${binding.name}` : `Delete ${binding.name}`}><Trash2 className="size-4" /></Button> : null}
          <label className={`motion-toggle relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full ${value.enabled ? "bg-[#34C759]" : "bg-[#d1d1d6] dark:bg-slate-700"}`}>
            <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ enabled: event.target.checked,
              sourceEnv: event.target.checked ? value.sourceEnv ?? codexScopes[0]?.envName : value.sourceEnv })} className="peer sr-only" />
            <span className={`motion-toggle-thumb absolute left-0 top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${value.enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
          </label>
        </div>
      </div>
      {value.enabled ? <div className="mt-3"><Field label={zh ? "来源环境" : "Source environment"}>
        <Select value={value.sourceEnv} onValueChange={(sourceEnv) => onChange({ sourceEnv })}
          items={codexScopes.map((scope) => ({ value: scope.envName!, label: scope.name }))} openOnHover={false} />
      </Field></div> : null}
      {binding.status === "conflict" || binding.status === "error" || binding.status === "missing-source" ? (
        <p className="mt-2 text-[11px] text-amber-600">{binding.message ?? binding.status}</p>
      ) : value.enabled ? <p className="mt-2 text-[11px] text-slate-400">{zh ? `${binding.managedLinks} 个受管链接` : `${binding.managedLinks} managed links`}</p> : null}
    </section>
  );
}

function SkillDetailPanel({ selection, language, onClose, onInstall }: {
  selection?: SkillDetailSelection;
  language: UiLanguage;
  onClose: () => void;
  onInstall: (skill: MarketplaceSkill) => void;
}) {
  const zh = language === "zh";
  const ja = language === "ja";
  const skill = selection?.skill;
  const marketplace = selection?.kind === "marketplace" ? selection.skill : undefined;
  const installed = selection?.kind === "installed" ? selection.skill : undefined;
  const detailRows = skill ? [
    { label: zh ? "标识" : ja ? "識別子" : "Identifier", value: marketplace?.slug ?? installed?.id },
    { label: zh ? "来源" : ja ? "ソース" : "Source", value: marketplace?.source ?? installed?.sourceUrl ?? (installed?.managed ? (zh ? "受管安装" : "Managed install") : (zh ? "本地 Skill" : "Local skill")) },
    { label: zh ? "位置" : ja ? "場所" : "Location", value: installed?.linkedFrom ?? installed?.path },
    { label: zh ? "版本" : ja ? "リビジョン" : "Revision", value: installed?.revision ?? installed?.requestedRef },
    { label: zh ? "状态" : ja ? "状態" : "Status", value: installed ? localizeSkillState(installed, language) : marketplace?.installs ? `${formatCount(marketplace.installs)} installs` : undefined },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value)) : [];

  return (
    <SidePanel
      open={Boolean(selection)}
      title={skill?.name ?? (zh ? "Skill 详情" : "Skill details")}
      description={selection?.kind === "marketplace" ? (zh ? "市场 Skill 信息" : "Marketplace skill information") : (zh ? "当前目录中的 Skill 信息" : "Skill information in the current directory")}
      onClose={onClose}
      closeLabel={zh ? "关闭" : "Close"}
    >
      {skill ? <div className="space-y-5">
        <div className="rounded-lg border border-black/[0.06] bg-[#f7f8fa] p-4 dark:border-white/[0.08] dark:bg-[#1b2129]">
          <div className="flex items-start gap-3">
            <SkillIcon label={skill.name} linked={installed?.linked} />
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold text-neutral-950 dark:text-neutral-50">{skill.name}</h3>
              <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                {skill.description || (zh ? "暂无描述" : ja ? "説明はありません" : "No description available")}
              </p>
            </div>
          </div>
        </div>

        <dl className="overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
          {detailRows.map((row) => <div key={row.label} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-b border-black/[0.05] px-4 py-3 last:border-b-0 dark:border-white/[0.06]">
            <dt className="text-[11px] font-medium text-slate-400">{row.label}</dt>
            <dd className="min-w-0 break-all font-mono text-[11px] leading-5 text-neutral-700 dark:text-neutral-200">{row.value}</dd>
          </div>)}
        </dl>

        <div className="flex justify-end gap-2">
          {marketplace?.url ? <a href={marketplace.url} target="_blank" rel="noreferrer"><Button variant="outline"><ExternalLink className="size-4" />{zh ? "查看来源" : "View source"}</Button></a> : null}
          {marketplace ? <Button onClick={() => onInstall(marketplace)}><ArrowDownToLine className="size-4" />{zh ? "安装" : "Install"}</Button> : null}
        </div>
      </div> : null}
    </SidePanel>
  );
}

function localizeSkillState(skill: InstalledSkill, language: UiLanguage): string {
  if (skill.linked) return language === "zh" ? "软链接" : language === "ja" ? "シンボリックリンク" : "Linked";
  const states = language === "zh"
    ? { healthy: "正常", modified: "已修改", missing: "文件缺失", conflict: "冲突" }
    : language === "ja"
      ? { healthy: "正常", modified: "変更済み", missing: "ファイル不足", conflict: "競合" }
      : { healthy: "Healthy", modified: "Modified", missing: "Missing", conflict: "Conflict" };
  return states[skill.state];
}

function SkillIcon({ linked = false }: { label: string; linked?: boolean }) {
  return <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-[#202733] dark:text-slate-300">
    {linked ? <Link2 className="size-[17px]" /> : <PackageOpen className="size-[17px]" />}
  </div>;
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
    <div className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-[#1b2129]">{icon}</div>
    <h3 className="mt-3 text-[14px] font-semibold text-neutral-800 dark:text-neutral-100">{title}</h3>
    <p className="mt-1 max-w-[460px] text-[12px] leading-5 text-slate-400">{description}</p>
    {action ? <div className="mt-4">{action}</div> : null}
  </div>;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k` : String(value);
}
