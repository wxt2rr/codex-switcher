export type DesktopView = "overview" | "environments" | "accounts" | "operations";

export interface DesktopViewSection {
  id: string;
}

export function buildDesktopViewSections(view: DesktopView): DesktopViewSection[] {
  switch (view) {
    case "overview":
      return [{ id: "status" }, { id: "quick-switch" }, { id: "recent" }];
    case "environments":
      return [{ id: "environments" }, { id: "switch-env" }, { id: "create-env" }, { id: "delete-env" }];
    case "accounts":
      return [{ id: "switch-account" }, { id: "runtime" }, { id: "account-actions" }];
    case "operations":
      return [{ id: "proxy" }, { id: "token-refresh" }, { id: "app-cli" }, { id: "results" }, { id: "advanced" }, { id: "logs" }];
    default:
      return [];
  }
}
