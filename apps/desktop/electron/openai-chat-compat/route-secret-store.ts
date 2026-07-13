import type { RouteRuntimeSecret } from "../usage-routing-model.js";

function cloneSecret(secret: RouteRuntimeSecret): RouteRuntimeSecret {
  return { ...secret };
}

export class RouteSecretStore {
  private readonly secrets = new Map<string, RouteRuntimeSecret>();

  set(secret: RouteRuntimeSecret): void {
    if (!secret.routeId.trim()) throw new Error("Route ID is required");
    if (!secret.upstreamApiKey.trim()) throw new Error("Upstream API key is required");
    if (!secret.localRouteToken.trim()) throw new Error("Local route token is required");
    if (!Number.isFinite(secret.hydratedAt)) throw new Error("Hydration timestamp is invalid");
    this.secrets.set(secret.routeId, cloneSecret(secret));
  }

  get(routeId: string): RouteRuntimeSecret | undefined {
    const secret = this.secrets.get(routeId);
    return secret ? cloneSecret(secret) : undefined;
  }

  delete(routeId: string): void {
    this.secrets.delete(routeId);
  }

  clear(): void {
    this.secrets.clear();
  }
}
