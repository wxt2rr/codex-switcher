import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectGeneratedImageRecoverySkill,
  reconcileGeneratedImageRecoverySkill,
} from "./generated-image-recovery-skill.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "generated-image-recovery-"));
  const bundledSkillPath = join(root, "bundled");
  await mkdir(join(bundledSkillPath, "scripts"), { recursive: true });
  await writeFile(join(bundledSkillPath, "SKILL.md"), "---\nname: recover-codex-generated-images\ndescription: test\n---\n", "utf8");
  await writeFile(join(bundledSkillPath, "scripts", "recover_current_image.py"), "def recover(args):\n    return {}\n", "utf8");
  const environments = ["Personal", "Company"].map((name) => ({ name, homePath: join(root, name) }));
  return { root, bundledSkillPath, environments };
}

test("enabling installs the bundled recovery skill into every Codex environment", async () => {
  const { bundledSkillPath, environments } = await fixture();
  const status = await reconcileGeneratedImageRecoverySkill({ enabled: true, environments, bundledSkillPath });
  assert.deepEqual(status, { enabled: true, installedEnvironments: 2, totalEnvironments: 2, conflicts: [] });
  for (const environment of environments) {
    assert.match(await readFile(join(environment.homePath, "skills", "recover-codex-generated-images", "SKILL.md"), "utf8"), /recover-codex-generated-images/);
    assert.match(
      await readFile(join(environment.homePath, "skills", "recover-codex-generated-images", "scripts", "recover_current_image.py"), "utf8"),
      /def recover/,
    );
  }
});

test("enabling rejects a bundled recovery skill without its script", async () => {
  const { bundledSkillPath, environments } = await fixture();
  await writeFile(join(bundledSkillPath, "scripts", "recover_current_image.py"), "", "utf8");
  await assert.rejects(
    reconcileGeneratedImageRecoverySkill({ enabled: true, environments, bundledSkillPath }),
    /缺少恢复脚本/,
  );
});

test("disabling removes only owned recovery skills", async () => {
  const { bundledSkillPath, environments } = await fixture();
  await reconcileGeneratedImageRecoverySkill({ enabled: true, environments, bundledSkillPath });
  await reconcileGeneratedImageRecoverySkill({ enabled: false, environments, bundledSkillPath });
  assert.deepEqual(await inspectGeneratedImageRecoverySkill(false, environments), {
    enabled: false, installedEnvironments: 0, totalEnvironments: 2, conflicts: [],
  });
});

test("a foreign same-name directory is preserved and blocks enablement", async () => {
  const { bundledSkillPath, environments } = await fixture();
  const foreign = join(environments[0].homePath, "skills", "recover-codex-generated-images");
  await mkdir(foreign, { recursive: true });
  await writeFile(join(foreign, "SKILL.md"), "user content", "utf8");
  await assert.rejects(
    reconcileGeneratedImageRecoverySkill({ enabled: true, environments, bundledSkillPath }),
    /Personal/,
  );
  assert.equal(await readFile(join(foreign, "SKILL.md"), "utf8"), "user content");
});
