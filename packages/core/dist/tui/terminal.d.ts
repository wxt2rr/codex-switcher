export type TuiKey = "up" | "down" | "left" | "right" | "enter" | "backspace" | "escape" | "quit" | `digit:${number}` | `char:${string}` | "unknown";
export interface TerminalLike {
    isInteractive: boolean;
    colorEnabled: boolean;
    columns: number;
    rows: number;
    enter(): void;
    leave(): void;
    clear(): void;
    readKey(timeoutMs?: number): Promise<TuiKey>;
}
export declare function createTerminal(stdin?: NodeJS.ReadStream, stdout?: NodeJS.WriteStream): TerminalLike;
export declare function normalizeKey(key: {
    name?: string;
    sequence?: string;
    ctrl?: boolean;
}): TuiKey;
