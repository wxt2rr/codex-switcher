declare module "electron" {
  export interface IpcMainInvokeEvent {}

  export class BrowserWindow {
    constructor(options: {
      width: number;
      height: number;
      minWidth?: number;
      minHeight?: number;
      titleBarStyle?: string;
      backgroundColor?: string;
      webPreferences?: {
        preload?: string;
        contextIsolation?: boolean;
        nodeIntegration?: boolean;
        sandbox?: boolean;
      };
    });
    static getAllWindows(): BrowserWindow[];
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
    webContents: {
      openDevTools(options?: { mode?: string }): void;
      send(channel: string, ...args: unknown[]): void;
    };
    on(event: string, listener: (...args: any[]) => void): void;
  }

  export class Notification {
    constructor(options: { title: string; body?: string; silent?: boolean });
    static isSupported(): boolean;
    on(event: "click", listener: () => void): this;
    show(): void;
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: string): string;
    getVersion(): string;
    getAppPath(): string;
    setLoginItemSettings(settings: { openAtLogin: boolean }): void;
    dock: {
      show(): Promise<void>;
      hide(): void;
    };
    relaunch(): void;
    exit(exitCode?: number): void;
    on(event: string, listener: () => void | Promise<void>): void;
    quit(): void;
  };

  export const ipcMain: {
    handle(channel: string, listener: (...args: any[]) => unknown | Promise<unknown>): void;
  };

  export const powerMonitor: {
    on(event: "resume", listener: () => void): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<string>;
    on(channel: string, listener: (...args: any[]) => void): unknown;
    removeListener(channel: string, listener: (...args: any[]) => void): unknown;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}
