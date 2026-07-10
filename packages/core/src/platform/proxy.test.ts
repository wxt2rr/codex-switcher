import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { readUsageProxyState } from "./proxy.js";

async function writeFileRecursive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

test("readUsageProxyState falls back to Clash Verge mixed-port on macOS", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-proxy-"));

  try {
    await writeFileRecursive(
      join(
        root,
        "Library",
        "Application Support",
        "io.github.clash-verge-rev.clash-verge-rev",
        "clash-verge.yaml",
      ),
      "mixed-port: 7899\n",
    );

    const state = await readUsageProxyState(
      join(root, ".codex-switcher"),
      { HOME: root },
      "darwin",
    );

    assert.deepEqual(state, {
      source: "auto-system",
      value: "http://127.0.0.1:7899",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readUsageProxyState reads Clash Verge app config when generated config is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-proxy-verge-"));

  try {
    await writeFileRecursive(
      join(
        root,
        "Library",
        "Application Support",
        "io.github.clash-verge-rev.clash-verge-rev",
        "verge.yaml",
      ),
      "verge_mixed_port: 7899\n",
    );

    const state = await readUsageProxyState(
      join(root, ".codex-switcher"),
      { HOME: root },
      "darwin",
    );

    assert.deepEqual(state, {
      source: "auto-system",
      value: "http://127.0.0.1:7899",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
