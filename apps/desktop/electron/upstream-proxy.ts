import * as undici from "undici";

type ProxyAwareRequestInit = RequestInit & { dispatcher?: unknown };

type CloseableProxyAgent = { close(): Promise<void> };

const { ProxyAgent } = undici;
const Socks5ProxyAgent = (undici as typeof undici & {
  Socks5ProxyAgent: new (url: string) => CloseableProxyAgent;
}).Socks5ProxyAgent;

const agents = new Map<string, CloseableProxyAgent>();

const UPSTREAM_HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
];

export type UpstreamProxySource = "route" | "global" | "direct";

export interface UpstreamProxySelection {
  url?: string;
  source: UpstreamProxySource;
}

export function normalizeUpstreamProxyUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid upstream proxy URL");
  }
  if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("Upstream proxy must be an HTTP(S) or SOCKS5 URL without embedded credentials");
  }
  if (parsed.port && (Number(parsed.port) <= 0 || Number(parsed.port) > 65535)) {
    throw new Error("Upstream proxy port is invalid");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function shouldBypassUpstreamProxy(targetUrl: string, noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ""): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return noProxy.split(",").some((rawEntry) => {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry || entry === "*") return Boolean(entry);
    const normalized = entry.replace(/^https?:\/\//, "").split("/")[0] ?? "";
    const lastColon = normalized.lastIndexOf(":");
    const entryPort = lastColon > -1 && normalized.indexOf("]") === -1 ? normalized.slice(lastColon + 1) : "";
    const entryHost = (entryPort ? normalized.slice(0, lastColon) : normalized).replace(/^\[|\]$/g, "");
    if (entryPort && entryPort !== port) return false;
    if (!entryHost) return false;
    return entryHost.startsWith(".")
      ? hostname.endsWith(entryHost) || hostname === entryHost.slice(1)
      : hostname === entryHost || hostname.endsWith(`.${entryHost}`);
  });
}

export function resolveUpstreamProxy(
  targetUrl: string,
  explicitProxyUrl?: string,
  defaultProxyUrl?: string,
): UpstreamProxySelection {
  const explicit = explicitProxyUrl?.trim();
  if (explicit) return { url: normalizeUpstreamProxyUrl(explicit), source: "route" };
  if (shouldBypassUpstreamProxy(targetUrl)) return { source: "direct" };
  const fallback = defaultProxyUrl?.trim();
  if (fallback) return { url: normalizeUpstreamProxyUrl(fallback), source: "global" };
  return { source: "direct" };
}

export function fetchWithOptionalProxy(
  url: string,
  init: RequestInit,
  proxyUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const normalized = proxyUrl ? normalizeUpstreamProxyUrl(proxyUrl) : undefined;
  if (!normalized) return fetchImpl(url, init);
  let agent = agents.get(normalized);
  if (!agent) {
    const created = normalized.startsWith("socks5:")
      ? new Socks5ProxyAgent(normalized)
      : new ProxyAgent(normalized);
    agents.set(normalized, created);
    agent = created;
  }
  // undici calculates the request length from string/Buffer bodies. Keeping a
  // caller-supplied Content-Length here is unsafe: after a proxy dispatcher is
  // attached, undici validates it against its internal body framing and may
  // reject the request before it reaches the upstream.
  const headers = new Headers(init.headers);
  for (const name of ["content-length", ...UPSTREAM_HOP_BY_HOP_HEADERS]) headers.delete(name);
  return fetchImpl(url, {
    ...init,
    headers,
    dispatcher: agent,
  } as ProxyAwareRequestInit);
}

export async function closeUpstreamProxyAgents(): Promise<void> {
  const active = [...agents.values()];
  agents.clear();
  await Promise.all(active.map((agent) => agent.close()));
}
