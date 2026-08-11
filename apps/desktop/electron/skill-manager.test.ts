import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { SkillManager } from "./skill-manager.js";

const execFileAsync = promisify(execFile);

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "skill-manager-test-"));
  const personal = join(root, "envs", "personal", "home");
  const company = join(root, "envs", "company", "home");
  await Promise.all([mkdir(personal, { recursive: true }), mkdir(company, { recursive: true })]);
  return { root, personal, company };
}

async function makeSkillRepo(root: string, name = "demo-skill", description = "Demo skill") {
  const repo = join(root, `repo-${name}`);
  const skill = join(repo, "skills", name);
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# Demo\n`, "utf8");
  await execFileAsync("git", ["init", repo]);
  await execFileAsync("git", ["-C", repo, "add", "."]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"]);
  return repo;
}

test("installs the same skill independently in two Codex environments", async () => {
  const workspace = await makeWorkspace();
  const repo = await makeSkillRepo(workspace.root);
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    homeDir: join(workspace.root, "user"),
    environments: async () => [
      { name: "personal", homePath: workspace.personal },
      { name: "company", homePath: workspace.company },
    ],
  });

  await manager.install({ envName: "personal", sourceUrl: repo, skillName: "demo-skill" });

  const snapshot = await manager.getSnapshot();
  assert.equal(snapshot.scopes.find((scope) => scope.id === "codex:personal")?.skills.length, 1);
  assert.equal(snapshot.scopes.find((scope) => scope.id === "codex:company")?.skills.length, 0);
});

test("keeps the installed skill when a forced replacement fails validation", async () => {
  const workspace = await makeWorkspace();
  const validRepo = await makeSkillRepo(workspace.root, "stable-skill", "Stable version");
  const invalidRoot = join(workspace.root, "invalid-source");
  await mkdir(invalidRoot, { recursive: true });
  const invalidRepo = await makeSkillRepo(invalidRoot, "stable-skill", "Invalid version");
  const outside = join(workspace.root, "outside.txt");
  await writeFile(outside, "outside", "utf8");
  await symlink(outside, join(invalidRepo, "skills", "stable-skill", "escape"));
  await execFileAsync("git", ["-C", invalidRepo, "add", "."]);
  await execFileAsync("git", ["-C", invalidRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "invalid link"]);
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    environments: async () => [{ name: "personal", homePath: workspace.personal }],
  });

  await manager.install({ envName: "personal", sourceUrl: validRepo, skillName: "stable-skill" });
  const installedPath = join(workspace.personal, "skills", "stable-skill", "SKILL.md");
  const before = await readFile(installedPath, "utf8");

  await assert.rejects(manager.install({
    envName: "personal",
    sourceUrl: invalidRepo,
    skillName: "stable-skill",
    force: true,
  }), /escapes its root/);

  assert.equal(await readFile(installedPath, "utf8"), before);
});

test("binds a global provider to one Codex environment without replacing foreign content", async () => {
  const workspace = await makeWorkspace();
  const source = join(workspace.personal, "skills", "apple-design");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "---\nname: apple-design\ndescription: Apple design guidance\n---\n", "utf8");
  const cursorPath = join(workspace.root, "cursor-skills");
  const foreign = join(cursorPath, "local-only");
  await mkdir(foreign, { recursive: true });
  await writeFile(join(foreign, "SKILL.md"), "---\nname: local-only\ndescription: Local\n---\n", "utf8");
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    homeDir: join(workspace.root, "user"),
    environments: async () => [{ name: "personal", homePath: workspace.personal }],
  });

  const binding = await manager.setProviderBinding({
    providerId: "cursor",
    enabled: true,
    sourceEnv: "personal",
    targetPath: cursorPath,
  });

  assert.equal(binding.status, "healthy");
  assert.equal(await realpath(join(cursorPath, "apple-design")), await realpath(source));
  assert.match(await readFile(join(foreign, "SKILL.md"), "utf8"), /local-only/);
  const cursor = (await manager.getSnapshot()).scopes.find((scope) => scope.id === "provider:cursor");
  assert.deepEqual(cursor?.skills.map((skill) => skill.id), ["apple-design", "local-only"]);
});

test("persists custom providers and removes only their managed links when deleted", async () => {
  const workspace = await makeWorkspace();
  const source = join(workspace.personal, "skills", "custom-skill");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "---\nname: custom-skill\ndescription: Custom provider test\n---\n", "utf8");
  const targetPath = join(workspace.root, "custom-provider-skills");
  const options = {
    stateDir: join(workspace.root, "state"),
    homeDir: join(workspace.root, "user"),
    environments: async () => [{ name: "personal", homePath: workspace.personal }],
  };
  const manager = new SkillManager(options);
  const created = await manager.createProvider({ name: "My Provider", targetPath });
  assert.equal(created.custom, true);
  assert.equal(created.enabled, false);

  await manager.setProviderBinding({ providerId: created.providerId, enabled: true, sourceEnv: "personal" });
  assert.equal(await realpath(join(targetPath, "custom-skill")), await realpath(source));

  const restored = await new SkillManager(options).getSnapshot();
  assert.equal(restored.bindings.find((binding) => binding.providerId === created.providerId)?.name, "My Provider");
  assert.ok(restored.scopes.some((scope) => scope.id === `provider:${created.providerId}`));

  await manager.deleteProvider(created.providerId);
  await assert.rejects(realpath(join(targetPath, "custom-skill")));
  const deleted = await manager.getSnapshot();
  assert.ok(!deleted.bindings.some((binding) => binding.providerId === created.providerId));
  assert.ok(!deleted.scopes.some((scope) => scope.id === `provider:${created.providerId}`));
});

test("migrates version 1 provider bindings without losing built-in configuration", async () => {
  const workspace = await makeWorkspace();
  const stateDir = join(workspace.root, "state");
  const bindingDir = join(stateDir, "skills");
  const cursorPath = join(workspace.root, "legacy-cursor-skills");
  await mkdir(bindingDir, { recursive: true });
  await writeFile(join(bindingDir, "provider-bindings.json"), JSON.stringify({
    version: 1,
    bindings: { cursor: { enabled: true, sourceEnv: "personal", targetPath: cursorPath } },
    managed: {},
  }), "utf8");
  const manager = new SkillManager({
    stateDir,
    homeDir: join(workspace.root, "user"),
    environments: async () => [{ name: "personal", homePath: workspace.personal }],
  });

  const binding = (await manager.getSnapshot()).bindings.find((item) => item.providerId === "cursor");
  assert.equal(binding?.enabled, true);
  assert.equal(binding?.sourceEnv, "personal");
  assert.equal(binding?.targetPath, cursorPath);
});

test("loads the public skills.sh search catalog by default", async () => {
  const workspace = await makeWorkspace();
  let requestedUrl = "";
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    environments: async () => [],
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ skills: [{
        id: "vercel-labs/skills/find-skills",
        skillId: "find-skills",
        name: "find-skills",
        installs: 2_559_808,
        source: "vercel-labs/skills",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const snapshot = await manager.getSnapshot();
  assert.equal(snapshot.marketplace.status, "live");
  assert.equal(snapshot.marketplace.items[0]?.name, "Find Skills");
  assert.match(requestedUrl, /q=skill/);
  assert.match(requestedUrl, /limit=100/);
});

test("normalizes and caches a configured marketplace response", async () => {
  const workspace = await makeWorkspace();
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    catalogUrl: "https://catalog.example.test/skills",
    environments: async () => [],
    fetchImpl: async () => new Response(JSON.stringify({ data: [{
      id: "vercel-labs/skills/find-skills",
      slug: "find-skills",
      name: "Find Skills",
      source: "vercel-labs/skills",
      installs: 42,
      installUrl: "https://github.com/vercel-labs/skills",
      url: "https://skills.sh/vercel-labs/skills/find-skills",
    }] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const snapshot = await manager.getSnapshot({ refreshMarketplace: true });
  assert.equal(snapshot.marketplace.status, "live");
  assert.equal(snapshot.marketplace.items[0]?.slug, "find-skills");
  assert.equal(snapshot.marketplace.sourceId, "custom-configured");
  assert.equal(snapshot.catalogSources[0]?.id, "custom-configured");
});

test("discovers Vercel skills from the GitHub tree and preserves the source path", async () => {
  const workspace = await makeWorkspace();
  const requested: string[] = [];
  const manager = new SkillManager({
    stateDir: join(workspace.root, "state"),
    environments: async () => [],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("api.github.com/repos/vercel-labs/agent-skills/git/trees/main")) {
        return new Response(JSON.stringify({ sha: "vercel-tree-sha", tree: [
          { path: "skills/react-best-practices/SKILL.md", type: "blob" },
          { path: "README.md", type: "blob" },
        ] }), { status: 200 });
      }
      if (url.includes("raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md")) {
        return new Response("---\nname: react-best-practices\ndescription: React performance guidance\n---\n", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const snapshot = await manager.getSnapshot({ marketplaceSourceId: "vercel-official", refreshMarketplace: true });
  assert.equal(snapshot.marketplace.sourceId, "vercel-official");
  assert.equal(snapshot.marketplace.items[0]?.sourcePath, "skills/react-best-practices");
  assert.equal(snapshot.marketplace.items[0]?.revision, "vercel-tree-sha");
  assert.equal(snapshot.marketplace.items[0]?.installUrl, "https://github.com/vercel-labs/agent-skills");
  assert.ok(requested.some((url) => url.includes("api.github.com/repos/vercel-labs/agent-skills/git/trees/main")));
  assert.ok(requested.some((url) => url.includes("raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md")));
});
