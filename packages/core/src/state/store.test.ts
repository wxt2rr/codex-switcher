import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCHEMA_VERSION,
  createStateStore,
  type SwitcherState,
} from "./store.js";

const sampleState: SwitcherState = {
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  generatedAt: "2026-06-16T00:00:00.000Z",
  targets: {
    cli: { env: "default", account: "work" },
    app: { env: "default", account: "personal" },
  },
  envs: {
    default: {
      name: "default",
      path: "/tmp/default-home",
      accounts: {
        work: {
          name: "work",
          authMode: "auth",
          runtime: {
            preferredAuthMethod: "chatgpt",
            openaiBaseUrlMode: "default",
          },
        },
      },
    },
  },
  tasks: {
    recent: [],
  },
};

test("state store saves and reloads canonical switcher state", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-"));

  try {
    const store = createStateStore({ rootDir: root });
    await store.save(sampleState);

    const reloaded = await store.load();
    assert.deepEqual(reloaded, sampleState);

    const raw = JSON.parse(
      await readFile(join(root, "core-state.json"), "utf8"),
    ) as SwitcherState;
    assert.equal(raw.schemaVersion, DEFAULT_SCHEMA_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state store rejects malformed persisted state with typed error", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-bad-"));

  try {
    const store = createStateStore({ rootDir: root });
    await store.writeRaw('{"schemaVersion":1,"envs":null}');

    await assert.rejects(
      () => store.load(),
      (error: unknown) => {
        assert.equal(typeof error, "object");
        assert.ok(error !== null);
        assert.equal((error as { code?: string }).code, "INVALID_STATE");
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
