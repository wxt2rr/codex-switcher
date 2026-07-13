import { createServer, type Server } from "node:http";

export async function startFakeChatModel(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server: Server = createServer(async (request, response) => {
    if (request.url !== "/v1/chat/completions" || request.method !== "POST") { response.statusCode = 404; response.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    if (body.stream === true) {
      response.setHeader("content-type", "text/event-stream");
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "E2E_OK" }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n` +
        "data: [DONE]\n\n");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "chat_fake", model: body.model, choices: [{ index: 0, finish_reason: "stop",
      message: { role: "assistant", content: "E2E_OK" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fake model did not bind");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
