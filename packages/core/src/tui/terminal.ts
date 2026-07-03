import { emitKeypressEvents } from "node:readline";

export type TuiKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "backspace"
  | "escape"
  | "quit"
  | `digit:${number}`
  | `char:${string}`
  | "unknown";

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

export function createTerminal(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): TerminalLike {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  const colorEnabled = interactive && process.env.TERM !== "dumb";
  let rawActive = false;
  let altScreenActive = false;

  function enter() {
    if (!interactive) {
      return;
    }
    emitKeypressEvents(stdin);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
      rawActive = true;
    }
    if (!altScreenActive) {
      stdout.write("\u001b[?1049h\u001b[H\u001b[2J");
      altScreenActive = true;
    }
    stdout.write("\u001b[?1007l\u001b[?25l");
  }

  function leave() {
    if (!interactive) {
      return;
    }
    stdout.write("\u001b[?25h\u001b[0m");
    if (altScreenActive) {
      stdout.write("\u001b[?1049l");
      altScreenActive = false;
    }
    if (rawActive && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
      rawActive = false;
    }
  }

  function clear() {
    if (!interactive) {
      return;
    }
    stdout.write("\u001b[H\u001b[2J\u001b[3J");
  }

  async function readKey(timeoutMs = 0): Promise<TuiKey> {
    if (!interactive) {
      return "quit";
    }

    return new Promise<TuiKey>((resolve) => {
      let timer: NodeJS.Timeout | undefined;

      const handler = (_str: string, key: { name?: string; sequence?: string; ctrl?: boolean }) => {
        cleanup();
        resolve(normalizeKey(key));
      };

      const cleanup = () => {
        stdin.off("keypress", handler);
        if (timer) {
          clearTimeout(timer);
        }
      };

      stdin.on("keypress", handler);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve("unknown");
        }, timeoutMs);
      }
    });
  }

  return {
    isInteractive: interactive,
    colorEnabled,
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
    enter,
    leave,
    clear,
    readKey,
  };
}

export function normalizeKey(key: {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}): TuiKey {
  if (key.ctrl && key.name === "c") {
    return "quit";
  }

  switch (key.name) {
    case "up":
    case "down":
    case "left":
    case "right":
      return key.name;
    case "return":
    case "enter":
      return "enter";
    case "backspace":
      return "backspace";
    case "escape":
      return "escape";
    case "q":
      return "quit";
    default:
      break;
  }

  if (key.sequence && /^[0-9]$/.test(key.sequence)) {
    return `digit:${Number(key.sequence)}`;
  }

  if (key.sequence && key.sequence.length === 1) {
    return `char:${key.sequence}`;
  }

  return "unknown";
}
