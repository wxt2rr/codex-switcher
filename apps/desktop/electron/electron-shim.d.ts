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
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
    webContents: {
      openDevTools(options?: { mode?: string }): void;
    };
  }

  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: () => void | Promise<void>): void;
    quit(): void;
  };

  export const ipcMain: {
    handle(channel: string, listener: (...args: any[]) => unknown | Promise<unknown>): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<string>;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}
