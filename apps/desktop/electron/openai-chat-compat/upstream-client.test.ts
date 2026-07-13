import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { ChatUpstreamClient } from "./upstream-client.js";

test("upstream client uses chat endpoint, injects upstream token, filters headers and retries 503", async () => {
  let requests = 0; let seen: Record<string, unknown> = {};
  const server = createServer(async (request, response) => {
    requests += 1;
    const body: Buffer[] = []; for await (const chunk of request) body.push(Buffer.from(chunk));
    seen = { url: request.url, authorization: request.headers.authorization, local: request.headers["x-local-token"], body: JSON.parse(Buffer.concat(body).toString()) };
    if (requests === 1) { response.statusCode = 503; response.end("retry"); return; }
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const response = await new ChatUpstreamClient().execute({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "sk-upstream",
    body: { model: "m" }, headers: { "x-local-token": "must-not-pass", authorization: "Bearer local" } });
  assert.equal(response.status, 200); assert.equal(requests, 2);
  assert.deepEqual(seen, { url: "/v1/chat/completions", authorization: "Bearer sk-upstream", local: undefined, body: { model: "m" } });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
