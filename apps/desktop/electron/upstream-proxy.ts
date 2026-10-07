import { ProxyAgent } from "undici";

type ProxyAwareRequestInit = RequestInit & { dispatcher?: unknown };

const agents = new Map<string, ProxyAgent>();

export function normalizeUpstreamProxyUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid upstream proxy URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("Upstream proxy must be an HTTP(S) URL without embedded credentials");
  }
  if (parsed.port && (Number(parsed.port) <= 0 || Number(parsed.port) > 65535)) {
    throw new Error("Upstream proxy port is invalid");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function fetchWithOptionalProxy(
  url: string,
  init: RequestInit,
  proxyUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!proxyUrl) return fetchImpl(url, init);
  const normalized = normalizeUpstreamProxyUrl(proxyUrl);
  let agent = agents.get(normalized);
  if (!agent) {
    agent = new ProxyAgent(normalized);
    agents.set(normalized, agent);
  }
  return fetchImpl(url, {
    ...init,
    dispatcher: agent,
  } as ProxyAwareRequestInit);
}

export async function closeUpstreamProxyAgents(): Promise<void> {
  const active = [...agents.values()];
  agents.clear();
  await Promise.all(active.map((agent) => agent.close()));
}
