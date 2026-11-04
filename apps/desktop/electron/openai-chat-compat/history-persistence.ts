import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { HistoryPersistence, RouteHistorySnapshot } from "./history-store.js";

function safeRouteId(routeId: string): string {
  const normalized = routeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  // Keep the familiar filename for simple route ids, but add a deterministic
  // suffix whenever sanitization changed the value. This prevents distinct
  // conversation scopes such as `route/a` and `route:a` from colliding on
  // disk while remaining backward-compatible with existing `route-a.json`.
  if (normalized === routeId) return normalized;
  let hash = 0x811c9dc5;
  for (let index = 0; index < routeId.length; index += 1) {
    hash ^= routeId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${normalized}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export class FileHistoryPersistence implements HistoryPersistence {
  constructor(private readonly directory: string) {}

  private path(routeId: string): string { return join(this.directory, `${safeRouteId(routeId)}.json`); }

  async load(routeId: string): Promise<RouteHistorySnapshot | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.path(routeId), "utf8")) as RouteHistorySnapshot;
      return parsed?.routeId === routeId && Array.isArray(parsed.responses) ? parsed : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return undefined;
    }
  }

  async save(snapshot: RouteHistorySnapshot): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(snapshot.routeId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    if (process.platform !== "win32") await chmod(target, 0o600);
  }

  async delete(routeId: string): Promise<void> {
    await rm(this.path(routeId), { force: true });
    // Conversation-scoped snapshots share the route prefix. Remove them when
    // a route/account is deleted so stale call ids cannot be reused later.
    try {
      const sanitizedBase = routeId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const prefixes = [`${sanitizedBase}__conversation_`, `${safeRouteId(routeId)}__conversation_`];
      const entries = await readdir(this.directory);
      await Promise.all(entries.filter((entry) => prefixes.some((prefix) => entry.startsWith(prefix)) && entry.endsWith(".json"))
        .map((entry) => rm(join(this.directory, entry), { force: true })));
    } catch {
      // Missing history directory is equivalent to an already-clean route.
    }
  }
}
