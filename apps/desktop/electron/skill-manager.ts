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
const BINDINGS_VERSION = 1 as const;
const MAX_SKILL_FILES = 2_000;
const MAX_SKILL_BYTES = 25 * 1024 * 1024;
const BACKUP_LIMIT = 3;
const DEFAULT_SKILLS_CATALOG_URL = "https://skills.sh/api/search";

export type SkillProviderId = "claude-code" | "qoder" | "zcode" | "codebuddy" | "cursor";
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
}

export interface ProviderBinding {
  providerId: SkillProviderId;
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
  installs?: number;
  installUrl: string;
  url: string;
  description?: string;
}

export interface MarketplaceSnapshot {
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
  bindings: Partial<Record<SkillProviderId, StoredProviderBinding>>;
  managed: Partial<Record<SkillProviderId, Record<string, string>>>;
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

const queues = new Map<string, Promise<unknown>>();

export const SKILL_PROVIDERS: SkillProviderDefinition[] = [
  { id: "claude-code", name: "Claude Code", aliases: ["Claude"], defaultPath: ".claude/skills" },
  { id: "qoder", name: "Qoder", aliases: ["Qoder CN"], defaultPath: ".qoder/skills" },
  { id: "zcode", name: "ZCode", aliases: [], defaultPath: ".zcode/skills" },
  { id: "codebuddy", name: "CodeBuddy / WorkBuddy", aliases: ["WorkBuddy"], defaultPath: ".codebuddy/skills" },
  { id: "cursor", name: "Cursor", aliases: [], defaultPath: ".cursor/skills" },
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

  async getSnapshot(options: { refreshMarketplace?: boolean } = {}): Promise<SkillManagerSnapshot> {
    const environments = await this.getEnvironments();
    const [marketplace, bindingFile] = await Promise.all([
      this.getMarketplace(options.refreshMarketplace ?? false),
      this.readBindingFile(),
    ]);
    const bindings = await Promise.all(SKILL_PROVIDERS.map((provider) => (
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
    const providerScopes = await Promise.all(SKILL_PROVIDERS.map(async (provider) => {
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
    if (!SKILL_PROVIDERS.some((provider) => provider.id === input.providerId)) {
      throw new Error(`Unsupported skill provider '${input.providerId}'`);
    }
    const environments = await this.getEnvironments();
    if (input.enabled && !environments.some((environment) => environment.name === input.sourceEnv)) {
      throw new Error("An enabled provider must select an existing Codex source environment");
    }
    const file = await this.readBindingFile();
    file.bindings[input.providerId] = {
      enabled: input.enabled,
      sourceEnv: input.enabled ? input.sourceEnv : undefined,
      targetPath: input.targetPath?.trim() || file.bindings[input.providerId]?.targetPath,
    };
    await this.reconcileProvider(input.providerId, file, environments);
    await this.writeBindingFile(file);
    const provider = SKILL_PROVIDERS.find((item) => item.id === input.providerId)!;
    return this.describeBinding(provider, file, environments);
  }

  async repairProvider(providerId: SkillProviderId): Promise<ProviderBinding> {
    const file = await this.readBindingFile();
    const environments = await this.getEnvironments();
    await this.reconcileProvider(providerId, file, environments);
    await this.writeBindingFile(file);
    const provider = SKILL_PROVIDERS.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unsupported skill provider '${providerId}'`);
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
    return override?.trim() || join(this.homeDir, ...provider.defaultPath.split("/"));
  }

  private bindingPath(): string {
    return join(this.options.stateDir, "skills", "provider-bindings.json");
  }

  private catalogCachePath(): string {
    return join(this.options.stateDir, "skills", "catalog-cache.json");
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
    if (!isRecord(parsed) || parsed.version !== BINDINGS_VERSION || !isRecord(parsed.bindings)) {
      return { version: BINDINGS_VERSION, bindings: {}, managed: {} };
    }
    const bindings: BindingFile["bindings"] = {};
    const managed: BindingFile["managed"] = {};
    for (const provider of SKILL_PROVIDERS) {
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
    return { version: BINDINGS_VERSION, bindings, managed };
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
      return { providerId: provider.id, enabled: false, targetPath, status: "disabled", managedLinks: 0, conflicts: 0 };
    }
    if (!environments.some((environment) => environment.name === stored.sourceEnv)) {
      return { providerId: provider.id, enabled: true, sourceEnv: stored.sourceEnv, targetPath,
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
    for (const provider of SKILL_PROVIDERS) {
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
    const provider = SKILL_PROVIDERS.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unsupported skill provider '${providerId}'`);
    const stored = file.bindings[providerId] ?? { enabled: false };
    const targetPath = this.providerPath(provider, stored.targetPath);
    const prior = file.managed[providerId] ?? {};
    for (const [skillId, expectedTarget] of Object.entries(prior)) {
      const path = join(targetPath, skillId);
      if (await isLinkTo(path, expectedTarget)) await rm(path, { force: true, recursive: true });
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
    for (const provider of SKILL_PROVIDERS) {
      const stored = file.bindings[provider.id];
      const expected = file.managed[provider.id]?.[skillId];
      if (!stored?.enabled || stored.sourceEnv !== envName || !expected) continue;
      const targetPath = this.providerPath(provider, stored.targetPath);
      const target = join(targetPath, skillId);
      if (await isLinkTo(target, expected)) await rm(target, { recursive: true, force: true });
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

  private async getMarketplace(refresh: boolean): Promise<MarketplaceSnapshot> {
    const cachePath = this.catalogCachePath();
    const cached = await readJson<MarketplaceSnapshot | undefined>(cachePath, undefined);
    const catalogUrl = this.options.catalogUrl?.trim() || DEFAULT_SKILLS_CATALOG_URL;
    if (!refresh && cached?.items?.length && cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 60_000) {
      return { ...cached, status: "cached" };
    }
    try {
      const endpoint = new URL(catalogUrl);
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
      const items = normalizeCatalogPayload(payload);
      const snapshot: MarketplaceSnapshot = {
        items,
        status: "live",
        fetchedAt: new Date().toISOString(),
        externalUrl: "https://skills.sh",
      };
      await writeJsonAtomic(cachePath, snapshot);
      return snapshot;
    } catch (error) {
      return cached?.items?.length
        ? { ...cached, status: "cached", message: errorMessage(error) }
        : { items: [], status: "error", externalUrl: "https://skills.sh", message: errorMessage(error) };
    }
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

function normalizeCatalogPayload(payload: unknown): MarketplaceSkill[] {
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
    return [{ id: value.id, slug: value.slug, name: value.name, source: value.source,
      installs: typeof value.installs === "number" ? value.installs : undefined,
      installUrl: value.installUrl, url: value.url,
      description: typeof value.description === "string" ? value.description.slice(0, 1000) : undefined }];
  }).sort((left, right) => (right.installs ?? 0) - (left.installs ?? 0));
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
