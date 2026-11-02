import type { ResetCardNotificationStatus } from "../src/reset-card-model.js";

export interface DesktopNotificationWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface DesktopNotificationConstructor {
  isSupported(): boolean;
  new (options: { title: string; body?: string; silent?: boolean }): {
    on(event: "click", listener: () => void): unknown;
    show(): void;
  };
}

export interface DesktopNotificationInput {
  title: string;
  body: string;
  accountKey?: string;
  envName?: string;
  accountName?: string;
  tag?: string;
}

export interface DesktopNotificationServiceOptions {
  getWindow?: () => DesktopNotificationWindow | undefined;
  notification?: DesktopNotificationConstructor;
  onFallback?: (input: DesktopNotificationInput) => void;
}

/**
 * Main-process notification boundary.  Renderer code never receives the
 * native Notification constructor and the payload is intentionally limited to
 * safe, human-readable copy plus a canonical account reference.
 */
export class DesktopNotificationService {
  private readonly getWindow: () => DesktopNotificationWindow | undefined;
  private readonly notification?: DesktopNotificationConstructor;
  private readonly onFallback?: DesktopNotificationServiceOptions["onFallback"];
  private enabled = false;

  constructor(options: DesktopNotificationServiceOptions = {}) {
    this.getWindow = options.getWindow ?? (() => undefined);
    this.notification = options.notification;
    this.onFallback = options.onFallback;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getStatus(): ResetCardNotificationStatus {
    const supported = Boolean(this.notification?.isSupported?.());
    return {
      supported,
      permission: supported ? "not-required" : "unsupported",
      enabled: this.enabled,
      ...(supported ? {} : { message: "当前平台不支持 Electron 系统通知，将使用应用内提示" }),
    };
  }

  notify(input: DesktopNotificationInput): { delivered: boolean; fallback: boolean } {
    const status = this.getStatus();
    if (!this.enabled || !status.supported) {
      this.onFallback?.(input);
      this.sendRendererNotice(input);
      return { delivered: false, fallback: true };
    }
    try {
      if (!this.notification) throw new Error("Native notifications are unavailable");
      const notification = new this.notification({
        title: input.title,
        body: input.body,
        silent: false,
      });
      notification.on("click", () => {
        const window = this.getWindow();
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
          window.webContents.send("desktop:resetCardNotificationClick", {
            accountKey: input.accountKey,
            envName: input.envName,
            accountName: input.accountName,
          });
        }
      });
      notification.show();
      return { delivered: true, fallback: false };
    } catch {
      this.onFallback?.(input);
      this.sendRendererNotice(input);
      return { delivered: false, fallback: true };
    }
  }

  private sendRendererNotice(input: DesktopNotificationInput): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send("desktop:resetCardNotification", input);
  }
}
