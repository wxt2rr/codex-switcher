import { CompatibilityError } from "./types.js";
import { fetchWithOptionalProxy } from "../upstream-proxy.js";

export const DEFAULT_TIMEOUTS = { connectMs: 10_000, firstByteMs: 30_000, idleMs: 120_000, totalMs: 600_000 };
const retryableStatuses = new Set([408, 429, 502, 503, 504]);
const allowedHeaders = new Set(["accept", "content-type", "user-agent", "x-request-id", "openai-organization", "openai-project"]);
const blockedForwardHeaders = new Set([
  "authorization", "cookie", "set-cookie", "proxy-authorization", "host", "content-length", "connection",
  "keep-alive", "proxy-authenticate", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "http2-settings",
]);

export interface ChatUpstreamClientOptions {
  fetchImpl?: typeof fetch;
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>;
}

export class ChatUpstreamClient {
  constructor(private readonly options: ChatUpstreamClientOptions = {}) {}

  async execute(input: {
    baseUrl: string; apiKey: string; body: Record<string, unknown>; headers?: HeadersInit; configuredHeaders?: HeadersInit; signal?: AbortSignal; proxyUrl?: string;
  }): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeouts = { ...DEFAULT_TIMEOUTS, ...this.options.timeouts };
    const url = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers = new Headers({ "content-type": "application/json", authorization: `Bearer ${input.apiKey}` });
    const source = new Headers(input.headers);
    source.forEach((value, name) => {
      const normalized = name.toLowerCase();
      if (!blockedForwardHeaders.has(normalized) && allowedHeaders.has(normalized)) headers.set(name, value);
    });
    const configured = new Headers(input.configuredHeaders);
    configured.forEach((value, name) => {
      const normalized = name.toLowerCase();
      if (!blockedForwardHeaders.has(normalized)) headers.set(name, value);
    });
    headers.set("authorization", `Bearer ${input.apiKey}`);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeout = AbortSignal.timeout(Math.min(timeouts.firstByteMs, timeouts.totalMs));
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
      try {
        const response = await fetchWithOptionalProxy(url, { method: "POST", headers, body: JSON.stringify(input.body), signal }, input.proxyUrl, fetchImpl);
        if (attempt === 0 && retryableStatuses.has(response.status)) { await response.body?.cancel(); continue; }
        return response;
      } catch (error) {
        lastError = error;
        if (input.signal?.aborted) throw error;
        if (attempt === 1) break;
      }
    }
    throw new CompatibilityError("UPSTREAM_PROTOCOL", `Chat upstream request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`, 502);
  }
}
