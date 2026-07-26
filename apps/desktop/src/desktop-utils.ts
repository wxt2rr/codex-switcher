import { getTranslations, type UiLanguage } from "./i18n";

export function localizeLoginState(value: string, language: UiLanguage) {
  const text = getTranslations(language);
  if (value === "logged-in") {
    return text.labels.loggedIn;
  }
  if (value === "not-logged-in") {
    return text.labels.notLoggedIn;
  }
  return value || text.labels.unknown;
}

export function localizeGuard(value: string, language: UiLanguage) {
  const text = getTranslations(language);
  return value === "unknown" ? text.labels.unknown : value;
}

export function localizeAuthMode(value: string, language: UiLanguage) {
  const text = getTranslations(language);
  if (value === "auth") {
    return text.labels.authMode;
  }
  if (value === "apikey") {
    return text.labels.apiKeyMode;
  }
  if (value === "sub2api") {
    return text.labels.sub2apiMode;
  }
  if (value === "cpa") {
    return text.labels.cpaMode;
  }
  if (value === "chatgpt") {
    return text.labels.chatgptMode;
  }
  return value || text.labels.unknown;
}

export function localizeBaseUrlMode(value: string, language: UiLanguage) {
  const text = getTranslations(language);
  if (value === "default") {
    return text.labels.defaultValue;
  }
  if (value === "custom") {
    return text.labels.customValue;
  }
  return value || text.labels.unknown;
}

export function localizeLogKind(value: string, language: UiLanguage) {
  const text = getTranslations(language);
  if (value === "switcher") {
    return text.labels.switcherLog;
  }
  if (value === "token-refresh") {
    return text.labels.tokenRefreshLog;
  }
  return value || text.labels.unknown;
}
