import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const upstreamRoot = new URL("./vendor/ofm/", import.meta.url);

test("upstream free-lane fingerprint preserves caller context and adds it once", async () => {
  const { applyFingerprint } = await import(new URL("src/upstream.js", upstreamRoot));
  const block = { type: "text", text: "caller rules", cache_control: { type: "ephemeral" } };
  const body = { messages: [{ role: "system", content: [block] }, { role: "user", content: "ping" }] };

  applyFingerprint(body, false);
  applyFingerprint(body, false);

  assert.equal(body.messages[0].content[0], block);
  assert.equal(body.messages[0].content.filter((item) => item?.text?.includes("<env>" )).length, 1);
  const environment = body.messages[0].content.find((item) => item?.text?.includes("<env>"));
  assert.match(environment.text, /Working directory:/);
  assert.match(environment.text, /Platform:/);
});

test("upstream free-lane sessions migrate legacy mappings and persist real ids", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "csw-ofm-upstream-sync-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dataDir;
  try {
    const { canonicalizeSession, isCanonicalSession, mintSessionId, sessionForConversation } = await import(new URL(`src/upstream.js?sync=${Date.now()}`, upstreamRoot));
    const legacy = canonicalizeSession("legacy");
    const real = mintSessionId(Date.now() - 1_000);
    const storeDir = path.join(dataDir, "our-free-model");
    fs.mkdirSync(storeDir, { recursive: true });
    const storePath = path.join(storeDir, "session-map.json");
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, sessions: { legacy: legacy, real } }));

    const upgraded = sessionForConversation("legacy");
    assert.notEqual(upgraded, legacy);
    assert.equal(isCanonicalSession(upgraded), true);
    assert.equal(sessionForConversation("legacy"), upgraded);
    assert.equal(sessionForConversation(real), real);

    const saved = JSON.parse(fs.readFileSync(storePath, "utf8"));
    assert.equal(saved.version, 2);
    assert.equal(saved.sessions.legacy, upgraded);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("automatic transport keeps the Node fallback when Bun is unavailable", async () => {
  const { egressFetch } = await import(new URL(`src/egress.js?sync=${Date.now()}`, upstreamRoot));
  const previousFetch = globalThis.fetch;
  const previousTransport = process.env.OUR_FREE_MODEL_FREE_TRANSPORT;
  try {
    let calls = 0;
    globalThis.fetch = async (...args) => {
      calls += 1;
      return new Response("ok", { status: 200, headers: { "x-test-url": String(args[0]) } });
    };
    delete process.env.OUR_FREE_MODEL_FREE_TRANSPORT;
    const response = await egressFetch("https://opencode.ai/inference/v1/chat/completions");
    assert.equal(await response.text(), "ok");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousTransport === undefined) delete process.env.OUR_FREE_MODEL_FREE_TRANSPORT;
    else process.env.OUR_FREE_MODEL_FREE_TRANSPORT = previousTransport;
  }
});
