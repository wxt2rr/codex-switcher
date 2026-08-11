import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCK_VERSION = 1 as const;
const BINDINGS_VERSION = 2 as const;
const MAX_SKILL_FILES = 2_000;
const MAX_SKILL_BYTES = 25 * 1024 * 1024;
const BACKUP_LIMIT = 3;
const DEFAULT_SKILLS_CATALOG_URL = "https://skills.sh/api/search";
const VERCEL_AGENT_SKILLS_REPOSITORY = "https://github.com/vercel-labs/agent-skills";
const VERCEL_AGENT_SKILLS_REF = "main";

export type SkillProviderId = string;
export type SkillScopeKind = "marketplace" | "codex" | "provider";
export type InstalledSkillState = "healthy" | "modified" | "missing" | "conflict";

export interface CodexSkillEnvironment {
  name: string;
  homePath: string;
}

export interface SkillProviderDefinition {
  id: SkillProviderId;
  name: string;
  aliases: string[];
  defaultPath: string;
  custom: boolean;
}

export interface ProviderBinding {
  providerId: SkillProviderId;
  name: string;
  custom: boolean;
  enabled: boolean;
  sourceEnv?: string;
  targetPath: string;
  status: "disabled" | "healthy" | "conflict" | "missing-source" | "error";
  managedLinks: number;
  conflicts: number;
  message?: string;
}

export interface MarketplaceSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  catalogSourceId?: string;
  sourcePath?: string;
  requestedRef?: string;
  revision?: string;
  installs?: number;
  installUrl: string;
  url: string;
  description?: string;
}

export interface SkillCatalogSource {
  id: string;
  name: string;
  kind: "api" | "git";
  sourceUrl: string;
  externalUrl: string;
  builtin: boolean;
}

export interface MarketplaceSnapshot {
  sourceId: string;
  sourceName: string;
  items: MarketplaceSkill[];
  status: "live" | "cached" | "link-only" | "error";
  fetchedAt?: string;
  message?: string;
  externalUrl: string;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  scopeId: string;
  managed: boolean;
  linked: boolean;
  linkedFrom?: string;
  sourceUrl?: string;
  sourcePath?: string;
  requestedRef?: string;
  revision?: string;
  installedAt?: string;
  state: InstalledSkillState;
}

export interface SkillScope {
  id: string;
  kind: SkillScopeKind;
  name: string;
  path?: string;
  envName?: string;
  providerId?: SkillProviderId;
  sourceEnv?: string;
  skills: InstalledSkill[];
}

export interface SkillManagerSnapshot {
  marketplace: MarketplaceSnapshot;
  catalogSources: SkillCatalogSource[];
  scopes: SkillScope[];
  bindings: ProviderBinding[];
}

export interface InstallSkillInput {
  envName: string;
  sourceUrl: string;
  skillName?: string;
  sourcePath?: string;
  ref?: string;
  force?: boolean;
}

export interface UpdateSkillInput {
  envName: string;
  skillId: string;
  force?: boolean;
}

export interface SetProviderBindingInput {
  providerId: SkillProviderId;
  enabled: boolean;
  sourceEnv?: string;
  targetPath?: string;
}

export interface CreateSkillProviderInput {
  name: string;
  targetPath: string;
}

interface SkillLockEntry {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  sourcePath: string;
  requestedRef: string;
  revision: string;
  contentHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: typeof LOCK_VERSION;
  environment: string;
  skills: Record<string, SkillLockEntry>;
}

interface StoredProviderBinding {
  enabled: boolean;
  sourceEnv?: string;
  targetPath?: string;
}

interface BindingFile {
  version: typeof BINDINGS_VERSION;
  customProviders: Record<SkillProviderId, { name: string; targetPath: string }>;
  bindings: Record<SkillProviderId, StoredProviderBinding | undefined>;
  managed: Record<SkillProviderId, Record<string, string> | undefined>;
}

interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  path: string;
  sourcePath: string;
}

export interface SkillManagerOptions {
  stateDir: string;
  environments: () => Promise<CodexSkillEnvironment[]>;
  homeDir?: string;
  platform?: NodeJS.Platform;
  catalogUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SkillSnapshotOptions {
  refreshMarketplace?: boolean;
  marketplaceSourceId?: string;
}

const queues = new Map<string, Promise<unknown>>();

export const SKILL_PROVIDERS: SkillProviderDefinition[] = [
  { id: "claude-code", name: "Claude Code", aliases: ["Claude"], defaultPath: ".claude/skills", custom: false },
  { id: "qoder", name: "Qoder", aliases: ["Qoder CN"], defaultPath: ".qoder/skills", custom: false },
  { id: "zcode", name: "ZCode", aliases: [], defaultPath: ".zcode/skills", custom: false },
  { id: "codebuddy", name: "CodeBuddy / WorkBuddy", aliases: ["WorkBuddy"], defaultPath: ".codebuddy/skills", custom: false },
  { id: "cursor", name: "Cursor", aliases: [], defaultPath: ".cursor/skills", custom: false },
];

export const SKILL_CATALOG_SOURCES: SkillCatalogSource[] = [
  {
    id: "skills-sh",
    name: "skills.sh",
    kind: "api",
    sourceUrl: DEFAULT_SKILLS_CATALOG_URL,
    externalUrl: "https://skills.sh",
    builtin: true,
  },
  {
    id: "vercel-official",
    name: "Vercel 官方",
    kind: "git",
    sourceUrl: VERCEL_AGENT_SKILLS_REPOSITORY,
    externalUrl: VERCEL_AGENT_SKILLS_REPOSITORY,
    builtin: true,
  },
  {
    id: "anthropic-official",
    name: "Anthropic 官方",
    kind: "git",
    sourceUrl: "https://github.com/anthropics/skills",
    externalUrl: "https://github.com/anthropics/skills",
    builtin: true,
  },
];

export class SkillManager {
  private readonly homeDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SkillManagerOptions) {
    this.homeDir = options.homeDir ?? homedir();
    this.platform = options.platform ?? process.platform;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getSnapshot(options: SkillSnapshotOptions = {}): Promise<SkillManagerSnapshot> {
    const environments = await this.getEnvironments();
    const catalogSources = this.catalogSources();
    const [marketplace, bindingFile] = await Promise.all([
      this.getMarketplace(options.marketplaceSourceId, options.refreshMarketplace ?? false, catalogSources),
      this.readBindingFile(),
    ]);
    const providers = this.providersFor(bindingFile);
    const bindings = await Promise.all(providers.map((provider) => (
      this.describeBinding(provider, bindingFile, environments)
    )));
    const codexScopes = await Promise.all(environments.map(async (environment) => ({
      id: `codex:${environment.name}`,
      kind: "codex" as const,
      name: `Codex · ${environment.name}`,
      path: this.skillsPath(environment),
      envName: environment.name,
      skills: await this.scanCodexEnvironment(environment),
    })));
    const providerScopes = await Promise.all(providers.map(async (provider) => {
      const binding = bindings.find((item) => item.providerId === provider.id);
      const path = binding?.targetPath ?? this.providerPath(provider);
      return {
        id: `provider:${provider.id}`,
        kind: "provider" as const,
        name: provider.name,
        path,
        providerId: provider.id,
        sourceEnv: binding?.sourceEnv,
        skills: await this.scanProviderDirectory(provider.id, path, bindingFile),
      };
    }));
    return {
      marketplace,
      catalogSources,
      scopes: [
        { id: "marketplace", kind: "marketplace", name: "Marketplace", skills: [] },
        ...codexScopes,
        ...providerScopes,
      ],
      bindings,
    };
  }

  async install(input: InstallSkillInput): Promise<InstalledSkill> {
    return this.withEnvironmentLock(input.envName, async () => {
      const environment = await this.requireEnvironment(input.envName);
      const staged = await this.stageSource(input);
      let nextPath: string | undefined;
      let backupPath: string | undefined;
      let destination: string | undefined;
      let destinationInstalled = false;
      let lockCommitted = false;
      try {
        const candidates = await discoverSkills(staged.repoPath);
        const candidate = selectCandidate(candidates, input.skillName, input.sourcePath);
        destination = join(this.skillsPath(environment), candidate.id);
        const lock = await this.readSkillLock(environment);
        const existing = lock.skills[candidate.id];
        if (existing && !input.force) {
          throw new Error(`Skill '${candidate.id}' is already installed in '${input.envName}'`);
        }
        if (await pathExists(destination)) {
          const ownedAndClean = existing && await hashDirectory(destination) === existing.contentHash;
          if (!ownedAndClean && !input.force) {
            throw new Error(`Skill path '${destination}' already exists and is not a clean managed installation`);
          }
        }
        await validateSkillDirectory(candidate.path);
        nextPath = `${destination}.install-${randomUUID()}`;
        await mkdir(dirname(destination), { recursive: true });
        await cp(candidate.path, nextPath, { recursive: true, errorOnExist: true });
        const contentHash = await hashDirectory(nextPath);
        backupPath = await this.backupSkill(environment, candidate.id, destination);
        await rename(nextPath, destination);
        destinationInstalled = true;
        nextPath = undefined;
        const now = new Date().toISOString();
        lock.skills[candidate.id] = {
          id: candidate.id,
          name: candidate.name,
          description: candidate.description,
          sourceUrl: normalizeGitSource(input.sourceUrl),
          sourcePath: candidate.sourcePath,
          requestedRef: input.ref?.trim() || "HEAD",
          revision: staged.revision,
          contentHash,
          installedAt: existing?.installedAt ?? now,
          updatedAt: now,
        };
        await this.writeSkillLock(environment, lock);
        lockCommitted = true;
        await this.reconcileBindingsForEnvironment(environment.name).catch(() => undefined);
        return (await this.scanCodexEnvironment(environment)).find((item) => item.id === candidate.id)!;
      } catch (error) {
        if (!lockCommitted && destination && (backupPath || destinationInstalled)) {
          await rm(destination, { recursive: true, force: true }).catch(() => undefined);
          if (backupPath) await rename(backupPath, destination).catch(() => undefined);
        }
        throw error;
      } finally {
        if (nextPath) await rm(nextPath, { recursive: true, force: true });
        await rm(staged.tempPath, { recursive: true, force: true });
      }
    });
  }

  async checkUpdates(envName: string): Promise<Record<string, boolean>> {
    const environment = await this.requireEnvironment(envName);
    const lock = await this.readSkillLock(environment);
    const results: Record<string, boolean> = {};
    for (const entry of Object.values(lock.skills)) {
      try {
        const revision = await resolveRemoteRevision(entry.sourceUrl, entry.requestedRef);
        results[entry.id] = revision !== entry.revision;
      } catch {
        results[entry.id] = false;
      }
    }
    return results;
  }

  async update(input: UpdateSkillInput): Promise<InstalledSkill> {
    const environment = await this.requireEnvironment(input.envName);
    const lock = await this.readSkillLock(environment);
    const entry = lock.skills[input.skillId];
    if (!entry) throw new Error(`Managed skill '${input.skillId}' not found in '${input.envName}'`);
    const currentPath = join(this.skillsPath(environment), input.skillId);
    if (!input.force && await pathExists(currentPath) && await hashDirectory(currentPath) !== entry.contentHash) {
      throw new Error(`Skill '${input.skillId}' has local changes; confirm replacement to update`);
    }
    return this.install({
      envName: input.envName,
      sourceUrl: entry.sourceUrl,
      skillName: entry.id,
      sourcePath: entry.sourcePath,
      ref: entry.requestedRef,
      force: true,
    });
  }

  async uninstall(envName: string, skillId: string): Promise<void> {
    await this.withEnvironmentLock(envName, async () => {
      const environment = await this.requireEnvironment(envName);
      const lock = await this.readSkillLock(environment);
      const entry = lock.skills[skillId];
      if (!entry) throw new Error(`Only managed skills can be uninstalled; '${skillId}' is not managed`);
      const target = join(this.skillsPath(environment), skillId);
      if (await pathExists(target) && await hashDirectory(target) !== entry.contentHash) {
        throw new Error(`Skill '${skillId}' has local changes; remove or back it up manually`);
      }
      await this.removeManagedLinksForSkill(environment.name, skillId);
      await rm(target, { recursive: true, force: true });
      delete lock.skills[skillId];
      await this.writeSkillLock(environment, lock);
    });
  }

  async setProviderBinding(input: SetProviderBindingInput): Promise<ProviderBinding> {
    const file = await this.readBindingFile();
    const provider = this.providersFor(file).find((item) => item.id === input.providerId);
    if (!provider) {
      throw new Error(`Unsupported skill provider '${input.providerId}'`);
    }
    const environments = await this.getEnvironments();
    if (input.enabled && !environments.some((environment) => environment.name === input.sourceEnv)) {
      throw new Error("An enabled provider must select an existing Codex source environment");
    }
    file.bindings[input.providerId] = {
      enabled: input.enabled,
      sourceEnv: input.enabled ? input.sourceEnv : undefined,
      targetPath: input.targetPath?.trim() || file.bindings[input.providerId]?.targetPath,
    };
    await this.reconcileProvider(input.providerId, file, environments);
    await this.writeBindingFile(file);
    return this.describeBinding(provider, file, environments);
  }

  async createProvider(input: CreateSkillProviderInput): Promise<ProviderBinding> {
    const name = input.name.trim();
    if (!name || name.length > 64) throw new Error("Provider name must contain 1 to 64 characters");
    const targetPath = this.normalizeCustomProviderPath(input.targetPath);
    const environments = await this.getEnvironments();
    const protectedPaths = [resolve(this.options.stateDir), ...environments.map((environment) => resolve(this.skillsPath(environment)))];
    if (targetPath === resolve(dirname(targetPath)) || targetPath === resolve(this.homeDir) ||
        protectedPaths.some((path) => isInside(path, targetPath) || isInside(targetPath, path))) {
      throw new Error("Provider Skill directory must not contain application state or a Codex Skill directory");
    }
    const file = await this.readBindingFile();
    const providers = this.providersFor(file);
    if (providers.some((provider) => provider.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error(`Skill provider '${name}' already exists`);
    }
    if (providers.some((provider) => this.providerPath(provider, file.bindings[provider.id]?.targetPath) === targetPath)) {
      throw new Error(`Skill provider directory '${targetPath}' is already configured`);
    }
    const providerId = `custom:${randomUUID()}`;
    file.customProviders[providerId] = { name, targetPath };
    file.bindings[providerId] = { enabled: false, targetPath };
    await this.writeBindingFile(file);
    return this.describeBinding(this.providersFor(file).find((provider) => provider.id === providerId)!, file, environments);
  }

  async deleteProvider(providerId: SkillProviderId): Promise<void> {
    const file = await this.readBindingFile();
    const provider = this.providersFor(file).find((item) => item.id === providerId);
    if (!provider?.custom) throw new Error("Only custom skill providers can be deleted");
    const environments = await this.getEnvironments();
    file.bindings[providerId] = { ...file.bindings[providerId], enabled: false, targetPath: provider.defaultPath };
    await this.reconcileProvider(providerId, file, environments);
    delete file.bindings[providerId];
    delete file.managed[providerId];
    delete file.customProviders[providerId];
    await this.writeBindingFile(file);
  }

  async repairProvider(providerId: SkillProviderId): Promise<ProviderBinding> {
    const file = await this.readBindingFile();
    const environments = await this.getEnvironments();
    const provider = this.providersFor(file).find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unsupported skill provider '${providerId}'`);
    await this.reconcileProvider(providerId, file, environments);
    await this.writeBindingFile(file);
    return this.describeBinding(provider, file, environments);
  }

  private async getEnvironments(): Promise<CodexSkillEnvironment[]> {
    const environments = await this.options.environments();
    return environments
      .filter((item) => item.name.trim() && isAbsolute(item.homePath))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async requireEnvironment(name: string): Promise<CodexSkillEnvironment> {
    const environment = (await this.getEnvironments()).find((item) => item.name === name);
    if (!environment) throw new Error(`Codex environment '${name}' not found`);
    return environment;
  }

  private skillsPath(environment: CodexSkillEnvironment): string {
    return join(environment.homePath, "skills");
  }

  private metadataPath(environment: CodexSkillEnvironment): string {
    return join(environment.homePath, ".codex-switcher");
  }

  private providerPath(provider: SkillProviderDefinition, override?: string): string {
    const configured = override?.trim() || provider.defaultPath;
    if (configured === "~") return this.homeDir;
    if (configured.startsWith(`~${sep}`) || configured.startsWith("~/")) {
      return join(this.homeDir, configured.slice(2));
    }
    return isAbsolute(configured) ? resolve(configured) : join(this.homeDir, ...configured.split("/"));
  }

  private normalizeCustomProviderPath(input: string): string {
    const value = input.trim();
    if (!value) throw new Error("Provider Skill directory is required");
    const expanded = value === "~" ? this.homeDir
      : value.startsWith(`~${sep}`) || value.startsWith("~/") ? join(this.homeDir, value.slice(2))
        : value;
    if (!isAbsolute(expanded)) throw new Error("Provider Skill directory must be an absolute path");
    return resolve(expanded);
  }

  private providersFor(file: BindingFile): SkillProviderDefinition[] {
    return [
      ...SKILL_PROVIDERS,
      ...Object.entries(file.customProviders).map(([id, provider]) => ({
        id,
        name: provider.name,
        aliases: [],
        defaultPath: provider.targetPath,
        custom: true,
      })),
    ];
  }

  private bindingPath(): string {
    return join(this.options.stateDir, "skills", "provider-bindings.json");
  }

  private catalogSources(): SkillCatalogSource[] {
    const configuredUrl = this.options.catalogUrl?.trim();
    if (!configuredUrl || configuredUrl === DEFAULT_SKILLS_CATALOG_URL) return SKILL_CATALOG_SOURCES;
    return [
      {
        id: "custom-configured",
        name: "自定义目录",
        kind: "api" as const,
        sourceUrl: configuredUrl,
        externalUrl: configuredUrl,
        builtin: false,
      },
      ...SKILL_CATALOG_SOURCES,
    ];
  }

  private catalogCachePath(sourceId: string): string {
    const safeSourceId = sourceId.replace(/[^a-z0-9._-]+/gi, "-");
    return join(this.options.stateDir, "skills", "catalog-cache", `${safeSourceId}.json`);
  }

  private async readSkillLock(environment: CodexSkillEnvironment): Promise<SkillLockFile> {
    const path = join(this.metadataPath(environment), "skills.lock.json");
    const parsed = await readJson<unknown>(path, undefined);
    if (!isRecord(parsed) || parsed.version !== LOCK_VERSION || !isRecord(parsed.skills)) {
      return { version: LOCK_VERSION, environment: environment.name, skills: {} };
    }
    const skills: Record<string, SkillLockEntry> = {};
    for (const [id, value] of Object.entries(parsed.skills)) {
      if (isSkillLockEntry(value) && id === value.id) skills[id] = value;
    }
    return { version: LOCK_VERSION, environment: environment.name, skills };
  }

  private async writeSkillLock(environment: CodexSkillEnvironment, lock: SkillLockFile): Promise<void> {
    await writeJsonAtomic(join(this.metadataPath(environment), "skills.lock.json"), lock);
  }

  private async readBindingFile(): Promise<BindingFile> {
    const parsed = await readJson<unknown>(this.bindingPath(), undefined);
    if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== BINDINGS_VERSION) || !isRecord(parsed.bindings)) {
      return { version: BINDINGS_VERSION, customProviders: {}, bindings: {}, managed: {} };
    }
    const bindings: BindingFile["bindings"] = {};
    const managed: BindingFile["managed"] = {};
    const customProviders: BindingFile["customProviders"] = {};
    if (parsed.version === BINDINGS_VERSION && isRecord(parsed.customProviders)) {
      for (const [id, value] of Object.entries(parsed.customProviders)) {
        if (!id.startsWith("custom:") || !isRecord(value)) continue;
        if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 64) continue;
        if (typeof value.targetPath !== "string") continue;
        try {
          customProviders[id] = { name: value.name.trim(), targetPath: this.normalizeCustomProviderPath(value.targetPath) };
        } catch {
          // Invalid custom records are ignored rather than gaining filesystem access.
        }
      }
    }
    const providers = [
      ...SKILL_PROVIDERS,
      ...Object.entries(customProviders).map(([id, provider]) => ({
        id, name: provider.name, aliases: [], defaultPath: provider.targetPath, custom: true,
      })),
    ];
    for (const provider of providers) {
      const value = parsed.bindings[provider.id];
      if (isRecord(value) && typeof value.enabled === "boolean") {
        bindings[provider.id] = {
          enabled: value.enabled,
          sourceEnv: typeof value.sourceEnv === "string" ? value.sourceEnv : undefined,
          targetPath: typeof value.targetPath === "string" ? value.targetPath : undefined,
        };
      }
      const providerManaged = isRecord(parsed.managed) ? parsed.managed[provider.id] : undefined;
      if (isRecord(providerManaged)) {
        managed[provider.id] = Object.fromEntries(
          Object.entries(providerManaged).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
      }
    }
    return { version: BINDINGS_VERSION, customProviders, bindings, managed };
  }

  private async writeBindingFile(file: BindingFile): Promise<void> {
    await writeJsonAtomic(this.bindingPath(), file);
  }

  private async scanCodexEnvironment(environment: CodexSkillEnvironment): Promise<InstalledSkill[]> {
    const lock = await this.readSkillLock(environment);
    return scanSkillDirectory(this.skillsPath(environment), `codex:${environment.name}`, lock.skills);
  }

  private async scanProviderDirectory(
    providerId: SkillProviderId,
    path: string,
    bindingFile: BindingFile,
  ): Promise<InstalledSkill[]> {
    const managed = bindingFile.managed[providerId] ?? {};
    return scanSkillDirectory(path, `provider:${providerId}`, {}, managed);
  }

  private async describeBinding(
    provider: SkillProviderDefinition,
    file: BindingFile,
    environments: CodexSkillEnvironment[],
  ): Promise<ProviderBinding> {
    const stored = file.bindings[provider.id];
    const targetPath = this.providerPath(provider, stored?.targetPath);
    const managed = file.managed[provider.id] ?? {};
    if (!stored?.enabled) {
      return { providerId: provider.id, name: provider.name, custom: provider.custom,
        enabled: false, targetPath, status: "disabled", managedLinks: 0, conflicts: 0 };
    }
    if (!environments.some((environment) => environment.name === stored.sourceEnv)) {
      return { providerId: provider.id, name: provider.name, custom: provider.custom,
        enabled: true, sourceEnv: stored.sourceEnv, targetPath,
        status: "missing-source", managedLinks: Object.keys(managed).length, conflicts: 0,
        message: "The selected Codex environment no longer exists" };
    }
    let healthy = 0;
    let conflicts = 0;
    for (const [skillId, expected] of Object.entries(managed)) {
      const linkPath = join(targetPath, skillId);
      if (await isLinkTo(linkPath, expected)) healthy += 1;
      else conflicts += 1;
    }
    return {
      providerId: provider.id,
      name: provider.name,
      custom: provider.custom,
      enabled: true,
      sourceEnv: stored.sourceEnv,
      targetPath,
      status: conflicts ? "conflict" : "healthy",
      managedLinks: healthy,
      conflicts,
      message: conflicts ? `${conflicts} managed projection(s) need repair` : undefined,
    };
  }

  private async reconcileBindingsForEnvironment(envName: string): Promise<void> {
    const file = await this.readBindingFile();
    const environments = await this.getEnvironments();
    for (const provider of this.providersFor(file)) {
      if (file.bindings[provider.id]?.enabled && file.bindings[provider.id]?.sourceEnv === envName) {
        await this.reconcileProvider(provider.id, file, environments);
      }
    }
    await this.writeBindingFile(file);
  }

  private async reconcileProvider(
    providerId: SkillProviderId,
    file: BindingFile,
    environments: CodexSkillEnvironment[],
  ): Promise<void> {
    const provider = this.providersFor(file).find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unsupported skill provider '${providerId}'`);
    const stored = file.bindings[providerId] ?? { enabled: false };
    const targetPath = this.providerPath(provider, stored.targetPath);
    const prior = file.managed[providerId] ?? {};
    for (const [skillId, expectedTarget] of Object.entries(prior)) {
      const path = join(targetPath, skillId);
      if (await isLinkTo(path, expectedTarget)) await removeManagedLink(path);
    }
    file.managed[providerId] = {};
    if (!stored.enabled) return;
    const environment = environments.find((item) => item.name === stored.sourceEnv);
    if (!environment) throw new Error(`Codex source environment '${stored.sourceEnv}' no longer exists`);
    const sourceSkills = await scanSkillDirectory(this.skillsPath(environment), `codex:${environment.name}`, {});
    await mkdir(targetPath, { recursive: true });
    for (const skill of sourceSkills) {
      const target = join(targetPath, skill.id);
      if (await pathExists(target)) {
        if (await isLinkTo(target, skill.path)) {
          file.managed[providerId]![skill.id] = skill.path;
        }
        continue;
      }
      const linkTarget = this.platform === "win32" ? resolve(skill.path) : relative(dirname(target), skill.path) || ".";
      await symlink(linkTarget, target, this.platform === "win32" ? "junction" : "dir");
      file.managed[providerId]![skill.id] = skill.path;
    }
  }

  private async removeManagedLinksForSkill(envName: string, skillId: string): Promise<void> {
    const file = await this.readBindingFile();
    for (const provider of this.providersFor(file)) {
      const stored = file.bindings[provider.id];
      const expected = file.managed[provider.id]?.[skillId];
      if (!stored?.enabled || stored.sourceEnv !== envName || !expected) continue;
      const targetPath = this.providerPath(provider, stored.targetPath);
      const target = join(targetPath, skillId);
      if (await isLinkTo(target, expected)) await removeManagedLink(target);
      delete file.managed[provider.id]?.[skillId];
    }
    await this.writeBindingFile(file);
  }

  private async stageSource(input: InstallSkillInput): Promise<{ tempPath: string; repoPath: string; revision: string }> {
    const source = normalizeGitSource(input.sourceUrl);
    const tempPath = await mkdtemp(join(tmpdir(), "codex-switcher-skill-"));
    const repoPath = join(tempPath, "repo");
    const args = ["clone", "--depth", "1"];
    if (input.ref?.trim() && input.ref !== "HEAD") args.push("--branch", input.ref.trim());
    args.push(source, repoPath);
    try {
      await execFileAsync("git", args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 10_000 });
      return { tempPath, repoPath, revision: stdout.trim() };
    } catch (error) {
      await rm(tempPath, { recursive: true, force: true });
      throw new Error(`Unable to acquire skill source: ${errorMessage(error)}`);
    }
  }

  private async backupSkill(environment: CodexSkillEnvironment, skillId: string, source: string): Promise<string | undefined> {
    if (!await pathExists(source)) return undefined;
    const root = join(this.metadataPath(environment), "backups", skillId);
    await mkdir(root, { recursive: true });
    const destination = join(root, new Date().toISOString().replace(/[:.]/g, "-"));
    await rename(source, destination);
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    await Promise.all(entries.slice(BACKUP_LIMIT).map((name) => rm(join(root, name), { recursive: true, force: true })));
    return destination;
  }

  private async getMarketplace(sourceId: string | undefined, refresh: boolean, sources: SkillCatalogSource[]): Promise<MarketplaceSnapshot> {
    const source = sources.find((item) => item.id === sourceId) ?? sources[0]!;
    const cachePath = this.catalogCachePath(source.id);
    const legacyCache = source.id === "skills-sh"
      ? await readJson<MarketplaceSnapshot | undefined>(join(this.options.stateDir, "skills", "catalog-cache.json"), undefined)
      : undefined;
    const rawCached = await readJson<MarketplaceSnapshot | undefined>(cachePath, legacyCache);
    const cached = rawCached
      ? { ...rawCached, sourceId: rawCached.sourceId || source.id, sourceName: rawCached.sourceName || source.name }
      : undefined;
    if (!refresh && cached?.items?.length && cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 60_000) {
      return { ...cached, status: "cached" };
    }
    try {
      const items = source.kind === "git"
        ? await this.getGitCatalog(source)
        : await this.getApiCatalog(source);
      const snapshot: MarketplaceSnapshot = {
        sourceId: source.id,
        sourceName: source.name,
        items,
        status: "live",
        fetchedAt: new Date().toISOString(),
        externalUrl: source.externalUrl,
      };
      await writeJsonAtomic(cachePath, snapshot);
      return snapshot;
    } catch (error) {
      return cached?.items?.length
        ? { ...cached, status: "cached", message: errorMessage(error) }
        : {
            sourceId: source.id,
            sourceName: source.name,
            items: [],
            status: "error",
            externalUrl: source.externalUrl,
            message: errorMessage(error),
          };
    }
  }

  private async getApiCatalog(source: SkillCatalogSource): Promise<MarketplaceSkill[]> {
    const endpoint = new URL(source.sourceUrl);
    if (endpoint.hostname === "skills.sh" && endpoint.pathname === "/api/search") {
      endpoint.searchParams.set("q", "skill");
      endpoint.searchParams.set("limit", "100");
    } else {
      endpoint.searchParams.set("view", "all-time");
      endpoint.searchParams.set("per_page", "100");
    }
    const response = await this.fetchImpl(endpoint, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Marketplace returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    return normalizeCatalogPayload(payload, source.id);
  }

  private async getGitCatalog(source: SkillCatalogSource): Promise<MarketplaceSkill[]> {
    const coordinates = githubCoordinates(source.sourceUrl);
    if (!coordinates) throw new Error(`Git catalog '${source.name}' must use a public GitHub repository`);
    const treeEndpoint = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/git/trees/${VERCEL_AGENT_SKILLS_REF}?recursive=1`;
    const treeResponse = await this.fetchImpl(treeEndpoint, {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: "application/vnd.github+json" },
    });
    if (!treeResponse.ok) throw new Error(`Git catalog returned HTTP ${treeResponse.status}`);
    const payload: unknown = await treeResponse.json();
    if (!isRecord(payload) || !Array.isArray(payload.tree)) throw new Error("Git catalog returned an invalid tree");
    const revision = typeof payload.sha === "string" ? payload.sha : undefined;
    const skillPaths = payload.tree.flatMap((entry): string[] => {
      if (!isRecord(entry) || typeof entry.path !== "string" || entry.type !== "blob" || !entry.path.endsWith("/SKILL.md")) return [];
      return [entry.path];
    });
    const items = await Promise.all(skillPaths.map(async (skillFilePath): Promise<MarketplaceSkill | undefined> => {
      const rawUrl = `https://raw.githubusercontent.com/${coordinates.owner}/${coordinates.repository}/${VERCEL_AGENT_SKILLS_REF}/${skillFilePath}`;
      try {
        const response = await this.fetchImpl(rawUrl, { signal: AbortSignal.timeout(12_000) });
        if (!response.ok) return undefined;
        const metadata = parseSkillMetadata(await response.text(), basename(dirname(skillFilePath)));
        const sourcePath = skillFilePath.slice(0, -"/SKILL.md".length);
        return {
          id: `${source.id}/${sourcePath}`,
          slug: basename(sourcePath),
          name: metadata.name,
          source: `${coordinates.owner}/${coordinates.repository}`,
          catalogSourceId: source.id,
          sourcePath,
          requestedRef: VERCEL_AGENT_SKILLS_REF,
          revision,
          installUrl: source.sourceUrl,
          url: `https://github.com/${coordinates.owner}/${coordinates.repository}/tree/${VERCEL_AGENT_SKILLS_REF}/${sourcePath}`,
          description: metadata.description,
        } satisfies MarketplaceSkill;
      } catch {
        return undefined;
      }
    }));
    return items.filter((item): item is MarketplaceSkill => Boolean(item)).sort((left, right) => left.name.localeCompare(right.name));
  }

  private async withEnvironmentLock<T>(envName: string, action: () => Promise<T>): Promise<T> {
    const key = `${this.options.stateDir}:${envName}`;
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.then(action, action);
    queues.set(key, current);
    try {
      return await current;
    } finally {
      if (queues.get(key) === current) queues.delete(key);
    }
  }
}

async function scanSkillDirectory(
  root: string,
  scopeId: string,
  lock: Record<string, SkillLockEntry>,
  managedLinks: Record<string, string> = {},
): Promise<InstalledSkill[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skills: InstalledSkill[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(root, entry.name);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isDirectory() && !info?.isSymbolicLink()) continue;
    const skillMd = join(path, "SKILL.md");
    if (!await pathExists(skillMd)) continue;
    const metadata = await readSkillMetadata(skillMd, entry.name);
    const locked = lock[entry.name];
    const linked = info.isSymbolicLink();
    let linkedFrom: string | undefined;
    if (linked) linkedFrom = await realpath(path).catch(() => undefined);
    let state: InstalledSkillState = "healthy";
    if (locked) {
      const hash = await hashDirectory(path).catch(() => "");
      if (!hash) state = "missing";
      else if (hash !== locked.contentHash) state = "modified";
    } else if (managedLinks[entry.name] && !await isLinkTo(path, managedLinks[entry.name])) {
      state = "conflict";
    }
    skills.push({
      id: entry.name,
      name: locked?.name ?? metadata.name,
      description: locked?.description ?? metadata.description,
      path,
      scopeId,
      managed: Boolean(locked || managedLinks[entry.name]),
      linked,
      linkedFrom,
      sourceUrl: locked?.sourceUrl,
      sourcePath: locked?.sourcePath,
      requestedRef: locked?.requestedRef,
      revision: locked?.revision,
      installedAt: locked?.installedAt,
      state,
    });
  }
  for (const entry of Object.values(lock)) {
    if (!skills.some((skill) => skill.id === entry.id)) {
      skills.push({ id: entry.id, name: entry.name, description: entry.description,
        path: join(root, entry.id), scopeId, managed: true, linked: false,
        sourceUrl: entry.sourceUrl, sourcePath: entry.sourcePath, requestedRef: entry.requestedRef,
        revision: entry.revision, installedAt: entry.installedAt, state: "missing" });
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function discoverSkills(repoPath: string): Promise<SkillCandidate[]> {
  const result: SkillCandidate[] = [];
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 5 || result.length > 500) return;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      const metadata = await readSkillMetadata(join(path, "SKILL.md"), basename(path));
      result.push({ id: normalizeSkillId(metadata.name || basename(path)), name: metadata.name,
        description: metadata.description, path, sourcePath: normalizeRelativePath(relative(repoPath, path)) });
      return;
    }
    await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== ".git" && !entry.name.startsWith("node_modules"))
      .map((entry) => visit(join(path, entry.name), depth + 1)));
  }
  await visit(repoPath, 0);
  return result;
}

function selectCandidate(candidates: SkillCandidate[], skillName?: string, sourcePath?: string): SkillCandidate {
  const normalizedPath = sourcePath ? normalizeRelativePath(sourcePath) : undefined;
  const normalizedName = skillName ? normalizeSkillId(skillName) : undefined;
  const candidate = normalizedPath
    ? candidates.find((item) => item.sourcePath === normalizedPath)
    : normalizedName
      ? candidates.find((item) => item.id === normalizedName || normalizeSkillId(item.name) === normalizedName)
      : candidates.length === 1 ? candidates[0] : undefined;
  if (!candidate) {
    const available = candidates.map((item) => item.id).join(", ");
    throw new Error(candidates.length
      ? `Select one skill from this source: ${available}`
      : "No valid SKILL.md directory was found in the source");
  }
  return candidate;
}

async function validateSkillDirectory(root: string): Promise<void> {
  const rootReal = await realpath(root);
  let files = 0;
  let bytes = 0;
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      files += 1;
      if (files > MAX_SKILL_FILES) throw new Error(`Skill contains more than ${MAX_SKILL_FILES} files`);
      const child = join(path, entry.name);
      const info = await lstat(child);
      if (info.isSymbolicLink()) {
        const target = await realpath(child);
        if (!isInside(rootReal, target)) throw new Error(`Skill link '${entry.name}' escapes its root`);
      } else if (info.isDirectory()) {
        await visit(child);
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > MAX_SKILL_BYTES) throw new Error("Skill exceeds the 25 MB installation limit");
      }
    }
  }
  await visit(root);
  const metadata = await readSkillMetadata(join(root, "SKILL.md"), basename(root));
  if (!metadata.name.trim() || !metadata.description.trim()) {
    throw new Error("SKILL.md frontmatter must include name and description");
  }
}

async function readSkillMetadata(path: string, fallbackName: string): Promise<{ name: string; description: string }> {
  const content = await readFile(path, "utf8").catch(() => "");
  return parseSkillMetadata(content, fallbackName);
}

function parseSkillMetadata(content: string, fallbackName: string): { name: string; description: string } {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1] ?? "";
  const name = readFrontmatterString(frontmatter, "name") || fallbackName;
  const description = readFrontmatterString(frontmatter, "description") || "No description provided";
  return { name, description };
}

function readFrontmatterString(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

async function hashDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string, prefix: string): Promise<void> {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = join(path, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(relativePath);
      const info = await lstat(child);
      if (info.isSymbolicLink()) hash.update(`link:${await readlink(child)}`);
      else if (info.isDirectory()) await visit(child, relativePath);
      else if (info.isFile()) hash.update(await readFile(child));
    }
  }
  await visit(root, "");
  return hash.digest("hex");
}

async function resolveRemoteRevision(sourceUrl: string, requestedRef: string): Promise<string> {
  const ref = requestedRef === "HEAD" ? "HEAD" : requestedRef;
  const { stdout } = await execFileAsync("git", ["ls-remote", normalizeGitSource(sourceUrl), ref], { timeout: 30_000 });
  const revision = stdout.trim().split(/\s+/)[0];
  if (!revision) throw new Error(`Unable to resolve '${requestedRef}' from source`);
  return revision;
}

function normalizeGitSource(value: string): string {
  const trimmed = value.trim();
  if (isAbsolute(trimmed) && lstatSync(trimmed).isDirectory()) return trimmed;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed.replace(/\.git$/, "")}.git`;
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("Skill source must be an HTTPS Git URL or owner/repository"); }
  if (url.protocol !== "https:") throw new Error("Only HTTPS skill sources are supported");
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("GitHub source must include owner and repository");
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, "")}.git`;
  }
  url.hash = "";
  return url.toString();
}

function normalizeCatalogPayload(payload: unknown, catalogSourceId = "skills-sh"): MarketplaceSkill[] {
  if (!isRecord(payload)) throw new Error("Marketplace response has an invalid shape");
  const values = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.skills) ? payload.skills : undefined;
  if (!values) throw new Error("Marketplace response has an invalid shape");
  return values.flatMap((value): MarketplaceSkill[] => {
    if (isRecord(value) && typeof value.id === "string" && typeof value.skillId === "string" &&
        typeof value.name === "string" && typeof value.source === "string") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(value.source) || value.id.length > 300 || value.skillId.includes("..")) return [];
      return [{
        id: value.id,
        slug: value.skillId,
        name: humanizeSkillName(value.name),
        source: value.source,
        catalogSourceId,
        installs: typeof value.installs === "number" ? value.installs : undefined,
        installUrl: `https://github.com/${value.source}`,
        url: `https://skills.sh/${value.id}`,
        description: typeof value.description === "string" ? value.description.slice(0, 1000) : undefined,
      }];
    }
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.slug !== "string" ||
        typeof value.name !== "string" || typeof value.source !== "string" || typeof value.installUrl !== "string" ||
        typeof value.url !== "string") return [];
    if (value.id.length > 300 || value.name.length > 200 || value.slug.includes("..")) return [];
    try {
      const installUrl = new URL(value.installUrl);
      const url = new URL(value.url);
      if (installUrl.protocol !== "https:" || url.protocol !== "https:") return [];
    } catch { return []; }
    return [{ id: value.id, slug: value.slug, name: value.name, source: value.source, catalogSourceId,
      installs: typeof value.installs === "number" ? value.installs : undefined,
      installUrl: value.installUrl, url: value.url,
      description: typeof value.description === "string" ? value.description.slice(0, 1000) : undefined }];
  }).sort((left, right) => (right.installs ?? 0) - (left.installs ?? 0));
}

function githubCoordinates(sourceUrl: string): { owner: string; repository: string } | undefined {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "github.com") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return undefined;
    return { owner: parts[0]!, repository: parts[1]!.replace(/\.git$/, "") };
  } catch {
    return undefined;
  }
}

function humanizeSkillName(value: string): string {
  return value.split(/[-_]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function normalizeSkillId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") throw new Error(`Invalid skill name '${value}'`);
  return normalized;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.split(/[/\\]+/).filter(Boolean).join("/");
  if (normalized.split("/").some((part) => part === "..") || isAbsolute(value)) throw new Error("Skill source path must stay inside the repository");
  return normalized;
}

async function isLinkTo(path: string, expectedTarget: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return false;
    return resolve(await realpath(path)) === resolve(await realpath(expectedTarget));
  } catch { return false; }
}

async function removeManagedLink(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return;
  // Windows junctions are reported as symbolic links. Never pass recursive
  // removal for a managed link, otherwise fs.rm can traverse its target.
  await rm(path, { force: true, recursive: !info.isSymbolicLink() });
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return fallback; }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSkillLockEntry(value: unknown): value is SkillLockEntry {
  return isRecord(value) && ["id", "name", "description", "sourceUrl", "sourcePath", "requestedRef", "revision", "contentHash", "installedAt", "updatedAt"]
    .every((key) => typeof value[key] === "string");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
