import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { HistoryPersistence, RouteHistorySnapshot } from "./history-store.js";

function safeRouteId(routeId: string): string {
  return routeId.replace(/[^a-zA-Z0-9_-]/g, "_");
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
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, target);
    if (process.platform !== "win32") await chmod(target, 0o600);
  }

  async delete(routeId: string): Promise<void> {
    await rm(this.path(routeId), { force: true });
  }
}
