import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { extractTokenUsage, type ExtractedTokenUsage } from "./usage-routing-model.js";

export type GatewayDiagnosticsLevel = "summary" | "full";

export interface GatewayDiagnosticsSettings {
  enabled: boolean;
  level: GatewayDiagnosticsLevel;
  maxRequests: number;
  ttlMs: number;
  captureResponseBody: boolean;
  maxBodyBytes: number;
}

export interface GatewayDiagnosticsStatus extends GatewayDiagnosticsSettings {
  startedAt: number | null;
  expiresAt: number | null;
  remainingRequests: number;
  capturedRequests: number;
  logPath: string;
}

export interface GatewayDiagnosticMetadata {
  requestId: string;
  traceId: string;
  gatewayId: string;
  envName: string;
  method: string;
  path: string;
  ingressProtocol: string;
  requestedModel: string | null;
  routeId: string;
  accountName: string;
  providerId: string | null;
  upstreamModel: string | null;
  upstreamProtocol: string;
  upstreamBaseUrl: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
}

export interface GatewayDiagnosticCapture {
  recordIngressBody(body: Buffer | undefined): void;
  recordTransformedBody(body: Buffer | undefined, stage: string, metadata?: Record<string, unknown>): void;
  recordUpstreamResponse(response: Response, stage: string, metadata?: Record<string, unknown>): void;
  recordFinalResponse(input: {
    status: number;
    headers: Headers;
    body: Buffer | string | undefined;
    usage?: ExtractedTokenUsage | null;
    errorMessage?: string | null;
  }): void;
  finish(extra?: Record<string, unknown>): Promise<void>;
}

interface DiagnosticBody {
  bytes: number;
  sha256: string;
  truncated: boolean;
  format: "json" | "text" | "empty" | "binary";
  summary: BodySummary;
  value?: unknown;
  preview?: string;
}

interface DiagnosticResponse {
  stage: string;
  status: number;
  headers: Record<string, string>;
  body?: DiagnosticBody;
  usage: ExtractedTokenUsage | null;
  metadata?: Record<string, unknown>;
}

interface DiagnosticRecord {
  event: "gateway_diagnostic";
  at: number;
  completedAt: number;
  request: GatewayDiagnosticMetadata;
  ingressBody?: DiagnosticBody;
  transformedBodies: Array<{ stage: string; body?: DiagnosticBody; metadata?: Record<string, unknown> }>;
  upstreamResponses: DiagnosticResponse[];
  finalResponse?: {
    status: number;
    headers: Record<string, string>;
    body?: DiagnosticBody;
    usage: ExtractedTokenUsage | null;
    errorMessage?: string | null;
  };
  [key: string]: unknown;
}

export interface GatewayDiagnosticsQuery {
  requestId?: string;
  limit?: number;
}

const DEFAULT_SETTINGS: GatewayDiagnosticsSettings = {
  enabled: false,
  level: "summary",
  maxRequests: 5,
  ttlMs: 10 * 60_000,
  captureResponseBody: true,
  maxBodyBytes: 4 * 1024 * 1024,
};

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|password|credential|bearer)/i;
const SAFE_RESPONSE_HEADERS = new Set(["content-type", "x-request-id", "request-id", "retry-after", "server", "date"]);

export class GatewayDiagnosticsController {
  private settings: GatewayDiagnosticsSettings = { ...DEFAULT_SETTINGS };
  private startedAt: number | null = null;
  private expiresAt: number | null = null;
  private remainingRequests = 0;
  private capturedRequests = 0;
  private writeQueue = Promise.resolve();
  private readonly activeFinishes = new Set<Promise<void>>();
  private readonly logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  status(): GatewayDiagnosticsStatus {
    this.expireIfNeeded();
    return {
      ...this.settings,
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      remainingRequests: this.settings.enabled ? this.remainingRequests : 0,
      capturedRequests: this.capturedRequests,
      logPath: this.logPath,
    };
  }

  configure(input: Partial<GatewayDiagnosticsSettings>): GatewayDiagnosticsStatus {
    const next = validateSettings({ ...this.settings, ...input });
    this.settings = next;
    if (next.enabled) {
      const now = Date.now();
      this.startedAt = now;
      this.expiresAt = now + next.ttlMs;
      this.remainingRequests = next.maxRequests;
      this.capturedRequests = 0;
    } else {
      this.startedAt = null;
      this.expiresAt = null;
      this.remainingRequests = 0;
    }
    return this.status();
  }

  disable(): GatewayDiagnosticsStatus {
    return this.configure({ enabled: false });
  }

  begin(metadata: GatewayDiagnosticMetadata): GatewayDiagnosticCapture | undefined {
    this.expireIfNeeded();
    if (!this.settings.enabled || this.remainingRequests <= 0) return undefined;
    this.remainingRequests -= 1;
    this.capturedRequests += 1;
    const startedAt = Date.now();
    const record: DiagnosticRecord = {
      event: "gateway_diagnostic",
      at: startedAt,
      completedAt: startedAt,
      request: {
        ...metadata,
        requestHeaders: metadata.requestHeaders ? sanitizeHeaders(metadata.requestHeaders) : undefined,
      },
      transformedBodies: [],
      upstreamResponses: [],
    };
    const pending: Promise<void>[] = [];
    let finished = false;
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    this.activeFinishes.add(completion);
    const capture: GatewayDiagnosticCapture = {
      recordIngressBody: (body) => { record.ingressBody = body ? captureBody(body, this.settings) : undefined; },
      recordTransformedBody: (body, stage, stageMetadata) => {
        record.transformedBodies.push({ stage, ...(body ? { body: captureBody(body, this.settings) } : {}), ...(stageMetadata ? { metadata: sanitizeValue(stageMetadata) as Record<string, unknown> } : {}) });
      },
      recordUpstreamResponse: (response, stage, responseMetadata) => {
        if (!this.settings.captureResponseBody) {
          record.upstreamResponses.push({ stage, status: response.status, headers: sanitizeResponseHeaders(response.headers), usage: null, ...(responseMetadata ? { metadata: sanitizeValue(responseMetadata) as Record<string, unknown> } : {}) });
          return;
        }
        const promise = readResponseCapture(response, stage, this.settings, responseMetadata).then((value) => {
          record.upstreamResponses.push(value);
        }).catch((error) => {
          record.upstreamResponses.push({ stage, status: response.status, headers: sanitizeResponseHeaders(response.headers), usage: null, metadata: { captureError: error instanceof Error ? error.message : String(error) } });
        });
        pending.push(promise);
      },
      recordFinalResponse: (input) => {
        record.finalResponse = {
          status: input.status,
          headers: sanitizeResponseHeaders(input.headers),
          ...(input.body !== undefined ? { body: captureBody(typeof input.body === "string" ? Buffer.from(input.body) : input.body, this.settings) } : {}),
          usage: input.usage ?? null,
          errorMessage: input.errorMessage ?? null,
        };
      },
      finish: async (extra) => {
        if (finished) return;
        finished = true;
        try {
          await Promise.all(pending);
          record.completedAt = Date.now();
          if (extra) Object.assign(record, sanitizeValue(extra));
          await this.append(record);
        } finally {
          this.activeFinishes.delete(completion);
          resolveCompletion();
        }
      },
    };
    return capture;
  }

  async records(query: GatewayDiagnosticsQuery = {}): Promise<DiagnosticRecord[]> {
    await Promise.all([...this.activeFinishes]);
    await this.writeQueue;
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const records: DiagnosticRecord[] = [];
    for (const path of [`${this.logPath}.1`, this.logPath]) {
      const raw = await readFile(path, "utf8").catch(() => "");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line) as DiagnosticRecord;
          if (value.event !== "gateway_diagnostic") continue;
          if (query.requestId && value.request?.requestId !== query.requestId) continue;
          records.push(value);
        } catch {
          // Ignore a partial line while the router is writing.
        }
      }
    }
    records.sort((left, right) => right.at - left.at);
    return records.slice(0, limit);
  }

  private expireIfNeeded(): void {
    if (this.settings.enabled && this.expiresAt !== null && Date.now() >= this.expiresAt) this.disable();
  }

  private append(record: DiagnosticRecord): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.logPath), { recursive: true });
      const current = await stat(this.logPath).catch(() => null);
      if (current && current.size >= 10 * 1024 * 1024) {
        await unlink(`${this.logPath}.1`).catch(() => undefined);
        await rename(this.logPath, `${this.logPath}.1`).catch(() => undefined);
      }
      await appendFile(this.logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(this.logPath, 0o600);
    }).catch(() => undefined);
    return this.writeQueue;
  }
}

function validateSettings(input: GatewayDiagnosticsSettings): GatewayDiagnosticsSettings {
  const maxRequests = clampInteger(input.maxRequests, 1, 100);
  const ttlMs = clampInteger(input.ttlMs, 10_000, 60 * 60_000);
  const maxBodyBytes = clampInteger(input.maxBodyBytes, 16 * 1024, 16 * 1024 * 1024);
  return {
    enabled: input.enabled === true,
    level: input.level === "full" ? "full" : "summary",
    maxRequests,
    ttlMs,
    captureResponseBody: input.captureResponseBody !== false,
    maxBodyBytes,
  };
}

function clampInteger(value: unknown, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, number));
}

function sanitizeHeaders(input: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : value]));
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) result[key] = value.slice(0, 512); });
  return result;
}

function sanitizeValue(value: unknown, depth = 0, maxStringLength = 32 * 1024): unknown {
  if (depth > 12) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") {
    const redacted = redactString(value);
    return redacted.length > maxStringLength ? `${redacted.slice(0, maxStringLength)}…[TRUNCATED]` : redacted;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1, maxStringLength));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(item, depth + 1, maxStringLength)]));
  }
  return value;
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, (match) => match.replace(/[:=].*$/, ": [REDACTED]"));
}

interface BodySummary {
  jsonKeys: string[];
  arrayCount: number;
  stringCount: number;
  stringChars: number;
  toolCount: number;
  inputItemCount: number;
  imageCount: number;
}

function captureBody(body: Buffer, settings: GatewayDiagnosticsSettings): DiagnosticBody {
  const bytes = body.byteLength;
  const capped = body.subarray(0, settings.maxBodyBytes);
  const truncated = bytes > capped.byteLength;
  const sha256 = createHash("sha256").update(body).digest("hex");
  const text = capped.toString("utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  const format: DiagnosticBody["format"] = bytes === 0 ? "empty" : parsed !== undefined ? "json" : isLikelyText(text) ? "text" : "binary";
  const summary = summarizeBody(parsed ?? text);
  const result: DiagnosticBody = { bytes, sha256, truncated, format, summary };
  if (settings.level === "full") {
    if (parsed !== undefined) result.value = sanitizeValue(parsed, 0, settings.maxBodyBytes);
    else if (format === "text") result.preview = text.slice(0, settings.maxBodyBytes);
  } else if (format === "text") {
    result.preview = text.slice(0, 512);
  }
  return result;
}

function summarizeBody(value: unknown): BodySummary {
  const summary: BodySummary = { jsonKeys: [], arrayCount: 0, stringCount: 0, stringChars: 0, toolCount: 0, inputItemCount: 0, imageCount: 0 };
  const walk = (current: unknown, key?: string): void => {
    if (typeof current === "string") { summary.stringCount += 1; summary.stringChars += current.length; if (current.includes("image_url") || current.includes("data:image/")) summary.imageCount += 1; return; }
    if (Array.isArray(current)) { summary.arrayCount += 1; if (key === "tools") summary.toolCount += current.length; if (key === "input" || key === "messages" || key === "contents") summary.inputItemCount += current.length; current.forEach((item) => walk(item, key)); return; }
    if (current && typeof current === "object") { for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) { if (summary.jsonKeys.length < 100 && !summary.jsonKeys.includes(childKey)) summary.jsonKeys.push(childKey); walk(child, childKey); } }
  };
  walk(value);
  return summary;
}

async function readResponseCapture(response: Response, stage: string, settings: GatewayDiagnosticsSettings, metadata?: Record<string, unknown>): Promise<DiagnosticResponse> {
  const cloned = response.clone();
  const bytes = await readResponseBytes(cloned, settings.maxBodyBytes);
  const body = captureBody(bytes.value, settings);
  body.truncated ||= bytes.truncated;
  return { stage, status: response.status, headers: sanitizeResponseHeaders(response.headers), body, usage: extractUsage(bytes.value), ...(metadata ? { metadata: sanitizeValue(metadata) as Record<string, unknown> } : {}) };
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<{ value: Buffer; truncated: boolean }> {
  if (!response.body) return { value: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value?.byteLength) continue;
      const chunk = Buffer.from(next.value);
      const remaining = maxBytes - size;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length, remaining); }
      if (chunk.length > remaining) { truncated = true; await reader.cancel(); break; }
    }
  } finally { reader.releaseLock(); }
  return { value: Buffer.concat(chunks), truncated };
}

function extractUsage(body: Buffer): ExtractedTokenUsage | null {
  try {
    const json = JSON.parse(body.toString("utf8")) as unknown;
    return extractTokenUsage(json);
  } catch {
    let latest: ExtractedTokenUsage | null = null;
    for (const line of body.toString("utf8").split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { latest = extractTokenUsage(JSON.parse(data)) ?? latest; } catch { /* partial SSE */ }
    }
    return latest;
  }
}

function isLikelyText(value: string): boolean {
  return !value.includes("\u0000");
}
