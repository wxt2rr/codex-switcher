import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { downloadUpdate, findGitHubUpdate, selectPreferredUpdateArtifact } from "./github-update.js";
import type { DesktopUpdateIndex } from "./update-security.js";

function response(value: unknown, init?: ResponseInit): Response {
  const body = typeof value === "string" || value instanceof Uint8Array
    ? value as unknown as BodyInit
    : JSON.stringify(value);
  return new Response(body, init);
}

function artifactIndex(version: string, url: string, sha256: string): DesktopUpdateIndex {
  return {
    version,
    channel: "stable",
    releaseUrl: `https://github.com/wxt2rr/codex-switcher/releases/tag/desktop-v${version}`,
    publishedAt: 1,
    artifacts: [{
      platform: "linux-x64",
      kind: "linux-appimage",
      fileName: "codex-switcher.AppImage",
      url,
      sha256,
      size: 14,
    }],
  };
}

test("GitHub updater selects the newest compatible release and platform artifact", async () => {
  const payload = Buffer.from("new-appimage");
  const hash = createHash("sha256").update(payload).digest("hex");
  const index = artifactIndex("2.1.0", "https://downloads.test/codex-switcher.AppImage", hash);
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/releases?")) {
      return response([
        {
          tag_name: "desktop-v2.1.0",
          draft: false,
          prerelease: false,
          assets: [{ name: "latest.json", browser_download_url: "https://downloads.test/latest.json" }],
        },
        {
          tag_name: "desktop-v2.0.0",
          draft: false,
          prerelease: false,
          assets: [{ name: "latest.json", browser_download_url: "https://downloads.test/old.json" }],
        },
      ]);
    }
    if (url === "https://downloads.test/latest.json") return response(index);
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;

  const candidate = await findGitHubUpdate({
    owner: "wxt2rr",
    repo: "codex-switcher",
    platform: "linux-x64",
    currentVersion: "2.0.0",
    fetchImpl,
  });
  assert.equal(candidate?.index.version, "2.1.0");
  assert.equal(candidate?.artifact.kind, "linux-appimage");
  assert.equal(candidate?.signatureVerified, false);
});

test("GitHub updater prefers the DMG when an older index contains duplicate macOS assets", () => {
  const artifacts = [
    {
      platform: "darwin-arm64" as const,
      kind: "mac-zip" as const,
      fileName: "codex-switcher-arm64-mac.zip",
      url: "https://downloads.test/codex-switcher-arm64-mac.zip",
      sha256: "a".repeat(64),
    },
    {
      platform: "darwin-arm64" as const,
      kind: "mac-dmg" as const,
      fileName: "codex-switcher-arm64.dmg",
      url: "https://downloads.test/codex-switcher-arm64.dmg",
      sha256: "b".repeat(64),
    },
  ];
  assert.equal(selectPreferredUpdateArtifact(artifacts, "darwin-arm64")?.kind, "mac-dmg");
  assert.equal(selectPreferredUpdateArtifact(artifacts, "darwin-x64"), undefined);
});

test("GitHub updater downloads and verifies artifact bytes", async () => {
  const payload = Buffer.from("verified-update");
  const hash = createHash("sha256").update(payload).digest("hex");
  const candidate = {
    index: artifactIndex("2.1.0", "https://downloads.test/update.AppImage", hash),
    artifact: artifactIndex("2.1.0", "https://downloads.test/update.AppImage", hash).artifacts[0],
    releaseTag: "desktop-v2.1.0",
    signatureVerified: false,
  };
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-github-update-"));
  try {
    const fetchImpl = (async () => response(payload, { headers: { "content-length": String(payload.byteLength) } })) as typeof fetch;
    const progress: number[] = [];
    const downloaded = await downloadUpdate(candidate, root, fetchImpl, (item) => {
      if (item.percent !== undefined) progress.push(item.percent);
    });
    assert.equal(readFileSync(downloaded.path).toString(), payload.toString());
    assert.equal(progress.at(-1), 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitHub updater removes a partial download when the hash does not match", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-github-update-invalid-"));
  const candidate = {
    index: artifactIndex("2.1.0", "https://downloads.test/update.AppImage", "a".repeat(64)),
    artifact: artifactIndex("2.1.0", "https://downloads.test/update.AppImage", "a".repeat(64)).artifacts[0],
    releaseTag: "desktop-v2.1.0",
    signatureVerified: false,
  };
  try {
    const fetchImpl = (async () => response("tampered")) as typeof fetch;
    await assert.rejects(downloadUpdate(candidate, root, fetchImpl), /SHA-256 verification/);
    assert.deepEqual(requireDirectory(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function requireDirectory(path: string): string[] {
  return readdirSync(path);
}
