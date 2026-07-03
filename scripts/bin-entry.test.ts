import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = "/Users/wangxt/myspace/codex-switcher";
const codexSwPath = join(repoRoot, "scripts", "bin", "codex-sw.cjs");
const codexSwNodePath = join(repoRoot, "scripts", "bin", "codex-sw-node.cjs");

test("codex-sw launcher keeps the legacy bash entrypoint on macos", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-bin-legacy-"));
  const legacyLog = join(root, "legacy.log");
  const legacyScript = join(root, "legacy.sh");

  try {
    await writeFile(
      legacyScript,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'args=%s\\n' "$*" > "${legacyLog}"
printf 'invoked=%s\\n' "$CODEX_SWITCHER_INVOKED_AS" >> "${legacyLog}"
`,
      "utf8",
    );
    await chmod(legacyScript, 0o755);

    await execFileAsync(process.execPath, [codexSwPath, "status"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_SWITCHER_BIN_PLATFORM: "darwin",
        CODEX_SWITCHER_BIN_LEGACY_SCRIPT: legacyScript,
      },
    });

    const log = await readFile(legacyLog, "utf8");
    assert.match(log, /args=status/);
    assert.match(log, /invoked=codex-sw/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex-sw launcher routes windows invocations through the node cli entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-bin-win-"));
  const nodeLog = join(root, "node.log");
  const tsxCli = join(root, "fake-tsx.mjs");
  const nodeCli = join(root, "fake-node-cli.ts");

  try {
    await writeFile(
      tsxCli,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(nodeLog)}, JSON.stringify({
  argv: process.argv.slice(2),
  invokedAs: process.env.CODEX_SWITCHER_INVOKED_AS ?? "",
}) + "\\n");
`,
      "utf8",
    );
    await writeFile(nodeCli, "export {};\n", "utf8");

    await execFileAsync(process.execPath, [codexSwPath, "whoami", "-t", "both"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_SWITCHER_BIN_PLATFORM: "win32",
        CODEX_SWITCHER_BIN_TSX_CLI: tsxCli,
        CODEX_SWITCHER_BIN_NODE_CLI: nodeCli,
      },
    });

    const logLines = (await readFile(nodeLog, "utf8")).trim().split("\n");
    assert.equal(logLines.length, 1);
    const payload = JSON.parse(logLines[0]) as { argv: string[]; invokedAs: string };
    assert.equal(payload.argv[0], nodeCli);
    assert.deepEqual(payload.argv.slice(1), ["whoami", "-t", "both"]);
    assert.equal(payload.invokedAs, "codex-sw");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex-switcher alias preserves its invoked name on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-bin-alias-win-"));
  const nodeLog = join(root, "node.log");
  const tsxCli = join(root, "fake-tsx.mjs");
  const nodeCli = join(root, "fake-node-cli.ts");
  const aliasPath = join(root, "codex-switcher");

  try {
    await writeFile(
      tsxCli,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(nodeLog)}, JSON.stringify({
  argv: process.argv.slice(2),
  invokedAs: process.env.CODEX_SWITCHER_INVOKED_AS ?? "",
}) + "\\n");
`,
      "utf8",
    );
    await writeFile(nodeCli, "export {};\n", "utf8");
    await symlink(codexSwPath, aliasPath);

    await execFileAsync(process.execPath, [aliasPath, "status"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_SWITCHER_BIN_PLATFORM: "win32",
        CODEX_SWITCHER_BIN_TSX_CLI: tsxCli,
        CODEX_SWITCHER_BIN_NODE_CLI: nodeCli,
      },
    });

    const logLines = (await readFile(nodeLog, "utf8")).trim().split("\n");
    assert.equal(logLines.length, 1);
    const payload = JSON.parse(logLines[0]) as { argv: string[]; invokedAs: string };
    assert.equal(payload.argv[0], nodeCli);
    assert.deepEqual(payload.argv.slice(1), ["status"]);
    assert.equal(payload.invokedAs, "codex-switcher");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex-sw-node always routes through the node cli entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-bin-node-"));
  const nodeLog = join(root, "node.log");
  const tsxCli = join(root, "fake-tsx.mjs");
  const nodeCli = join(root, "fake-node-cli.ts");

  try {
    await writeFile(
      tsxCli,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(nodeLog)}, JSON.stringify({
  argv: process.argv.slice(2),
  invokedAs: process.env.CODEX_SWITCHER_INVOKED_AS ?? "",
}) + "\\n");
`,
      "utf8",
    );
    await writeFile(nodeCli, "export {};\n", "utf8");

    await execFileAsync(process.execPath, [codexSwNodePath, "tui"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_SWITCHER_BIN_PLATFORM: "darwin",
        CODEX_SWITCHER_BIN_TSX_CLI: tsxCli,
        CODEX_SWITCHER_BIN_NODE_CLI: nodeCli,
      },
    });

    const logLines = (await readFile(nodeLog, "utf8")).trim().split("\n");
    assert.equal(logLines.length, 1);
    const payload = JSON.parse(logLines[0]) as { argv: string[]; invokedAs: string };
    assert.equal(payload.argv[0], nodeCli);
    assert.deepEqual(payload.argv.slice(1), ["tui"]);
    assert.equal(payload.invokedAs, "codex-sw-node");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
