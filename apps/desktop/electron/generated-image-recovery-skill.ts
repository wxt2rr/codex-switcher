import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const GENERATED_IMAGE_RECOVERY_SKILL_ID = "recover-codex-generated-images";
const OWNER_MARKER = ".codex-switcher-owned.json";
const OWNER_ID = "codex-switcher:generated-image-recovery";

export interface CodexSkillEnvironment {
  name: string;
  homePath: string;
}

export interface GeneratedImageRecoveryStatus {
  enabled: boolean;
  installedEnvironments: number;
  totalEnvironments: number;
  conflicts: string[];
}

export async function inspectGeneratedImageRecoverySkill(
  enabled: boolean,
  environments: CodexSkillEnvironment[],
): Promise<GeneratedImageRecoveryStatus> {
  let installedEnvironments = 0;
  const conflicts: string[] = [];
  for (const environment of environments) {
    const target = targetPath(environment);
    if (!(await pathExists(target))) continue;
    if (await isOwned(target)) installedEnvironments += 1;
    else conflicts.push(environment.name);
  }
  return { enabled, installedEnvironments, totalEnvironments: environments.length, conflicts };
}

export async function reconcileGeneratedImageRecoverySkill(input: {
  enabled: boolean;
  environments: CodexSkillEnvironment[];
  bundledSkillPath: string;
}): Promise<GeneratedImageRecoveryStatus> {
  if (input.enabled) {
    await assertBundledSkill(input.bundledSkillPath);
    const conflicts = await findConflicts(input.environments);
    if (conflicts.length > 0) {
      throw new Error(`以下环境存在非 codex-switcher 管理的同名 Skill，未进行覆盖：${conflicts.join("、")}`);
    }
    for (const environment of input.environments) {
      await installOwnedSkill(environment, input.bundledSkillPath);
    }
  } else {
    for (const environment of input.environments) {
      const target = targetPath(environment);
      if (await isOwned(target)) await rm(target, { recursive: true, force: true });
    }
  }
  return inspectGeneratedImageRecoverySkill(input.enabled, input.environments);
}

function targetPath(environment: CodexSkillEnvironment): string {
  return join(environment.homePath, "skills", GENERATED_IMAGE_RECOVERY_SKILL_ID);
}

async function findConflicts(environments: CodexSkillEnvironment[]): Promise<string[]> {
  const conflicts: string[] = [];
  for (const environment of environments) {
    const target = targetPath(environment);
    if ((await pathExists(target)) && !(await isOwned(target))) conflicts.push(environment.name);
  }
  return conflicts;
}

async function installOwnedSkill(environment: CodexSkillEnvironment, bundledSkillPath: string): Promise<void> {
  const target = targetPath(environment);
  await mkdir(dirname(target), { recursive: true });
  const stagingRoot = await mkdtemp(join(dirname(target), `.${basename(target)}-install-`));
  const staged = join(stagingRoot, GENERATED_IMAGE_RECOVERY_SKILL_ID);
  try {
    await cp(bundledSkillPath, staged, { recursive: true, dereference: false });
    await writeFile(join(staged, OWNER_MARKER), `${JSON.stringify({ owner: OWNER_ID, version: 1 }, null, 2)}\n`, "utf8");
    if (await pathExists(target)) await rm(target, { recursive: true, force: true });
    await rename(staged, target);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function assertBundledSkill(path: string): Promise<void> {
  const skillFile = join(path, "SKILL.md");
  const recoveryScript = join(path, "scripts", "recover_current_image.py");
  const content = await readFile(skillFile, "utf8").catch(() => "");
  if (!content.includes(`name: ${GENERATED_IMAGE_RECOVERY_SKILL_ID}`)) {
    throw new Error(`内置图片恢复 Skill 不完整：${skillFile}`);
  }
  const script = await readFile(recoveryScript, "utf8").catch(() => "");
  if (!script.includes("def recover(")) {
    throw new Error(`内置图片恢复 Skill 缺少恢复脚本：${recoveryScript}`);
  }
}

async function isOwned(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(path, OWNER_MARKER), "utf8")) as { owner?: unknown };
    return value.owner === OWNER_ID;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
