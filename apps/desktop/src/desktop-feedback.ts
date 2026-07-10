import { getTranslations, type UiLanguage } from "./i18n";

export type DesktopActionItem = {
  id: "refresh" | "switcher-log" | "token-refresh-log" | "launch-cli";
  label: string;
  group: "data" | "logs" | "developer";
  tone?: "default" | "muted";
};

export type DesktopValidationKey = "env-name-required" | "runtime-requires-input";
export type DesktopNoticeTone = "success" | "warning" | "error" | "info";
export type DesktopNotice = {
  tone: DesktopNoticeTone;
  text: string;
};

export function formatCompletedActionLabel(
  language: UiLanguage,
  scope: string,
  action: string,
  args: string[],
): string {
  const text = getTranslations(language);

  if (scope === "ops" && action === "proxy" && args[0] === "test") {
    return text.operations["proxy-test"];
  }
  if (scope === "ops" && action === "token-refresh" && args[0] === "run-once") {
    return text.operations["token-refresh-run-once"];
  }
  if (scope === "ops" && action === "doctor") {
    return text.operations["doctor-fix"];
  }
  if (scope === "ops" && action === "recover") {
    return text.operations["recover-dry-run"];
  }
  if (scope === "log") {
    if (language === "zh") {
      return `${action} 日志`;
    }
    if (language === "ja") {
      return `${action} ログ`;
    }
    return `${action} log`;
  }
  if (scope === "cli" && action === "launch-current") {
    return text.operations["cli-launch-current"] ?? "Launch CLI";
  }

  return `${scope} ${action}`;
}

export function buildDesktopActionItems(language: UiLanguage): DesktopActionItem[] {
  if (language === "zh") {
    return [
      { id: "refresh", label: "重新加载数据", group: "data" },
      { id: "switcher-log", label: "读取 switcher 日志", group: "logs" },
      { id: "token-refresh-log", label: "读取 token-refresh 日志", group: "logs" },
      { id: "launch-cli", label: "打开 CLI 会话", group: "developer" },
    ];
  }

  if (language === "ja") {
    return [
      { id: "refresh", label: "データを再読み込み", group: "data" },
      { id: "switcher-log", label: "switcher ログを読む", group: "logs" },
      { id: "token-refresh-log", label: "token-refresh ログを読む", group: "logs" },
      { id: "launch-cli", label: "CLI セッションを開く", group: "developer" },
    ];
  }

  return [
    { id: "refresh", label: "Reload Data", group: "data" },
    { id: "switcher-log", label: "Read switcher log", group: "logs" },
    { id: "token-refresh-log", label: "Read token-refresh log", group: "logs" },
    { id: "launch-cli", label: "Open CLI Session", group: "developer" },
  ];
}

export function formatDesktopValidationMessage(language: UiLanguage, key: DesktopValidationKey): string {
  const text = getTranslations(language);
  if (key === "env-name-required") {
    return text.message.envNameRequired;
  }
  return text.message.runtimeRequiresInput;
}

export function formatOperationCompletedMessage(language: UiLanguage, label: string): string {
  const text = getTranslations(language);
  return text.message.operationCompleted.replace("{label}", label);
}

export function buildDesktopNotice(
  language: UiLanguage,
  kind: "success" | "validation" | "error" | "info",
  payload: string,
): DesktopNotice {
  if (kind === "success") {
    return { tone: "success", text: formatOperationCompletedMessage(language, payload) };
  }
  if (kind === "validation") {
    return { tone: "warning", text: formatDesktopValidationMessage(language, payload as DesktopValidationKey) };
  }
  if (kind === "error") {
    return { tone: "error", text: payload };
  }
  return { tone: "info", text: payload };
}
