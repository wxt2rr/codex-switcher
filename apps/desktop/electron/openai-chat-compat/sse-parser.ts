import { CompatibilityError } from "./types.js";

export interface ParsedSseEvent { event?: string; data: string; }

export class SseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";

  push(chunk: Uint8Array): ParsedSseEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): ParsedSseEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.drain(true);
    if (this.buffer.trim()) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Upstream SSE ended with an incomplete event", 502);
    return events;
  }

  private drain(final: boolean): ParsedSseEvent[] {
    const events: ParsedSseEvent[] = [];
    let match: RegExpMatchArray | null;
    while ((match = this.buffer.match(/\r\n\r\n|\n\n|\r\r/))) {
      const boundary = match.index ?? 0;
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + match[0].length);
      const parsed = this.parseBlock(block);
      if (parsed) events.push(parsed);
    }
    if (final && this.buffer && !this.buffer.trim()) this.buffer = "";
    return events;
  }

  private parseBlock(block: string): ParsedSseEvent | undefined {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length ? { ...(event ? { event } : {}), data: data.join("\n") } : undefined;
  }
}
