import type { TerminalLike } from "./terminal.js";
export interface HomeMenuItem {
    title: string;
    description: string;
}
export declare const HOME_MENU_ITEMS: HomeMenuItem[];
export declare function renderHomeScreen(selected?: number, updateHint?: string, setupHint?: string): string;
export declare function runHomeLoop(terminal: TerminalLike, output?: NodeJS.WriteStream, updateHint?: string, setupHint?: string): Promise<number>;
