import type { GatewayProtocol } from "../protocol.js";

export type ConversionQuality = "good" | "fair" | "discouraged";

export interface ConversionStep {
  id: string;
  from: GatewayProtocol;
  to: GatewayProtocol;
  kind: "identity" | "direct" | "pivot";
}

export interface ConversionPath {
  from: GatewayProtocol;
  to: GatewayProtocol;
  quality: ConversionQuality;
  steps: ConversionStep[];
}

const GOOD_PAIRS = new Set([
  "chat_completions->responses",
  "responses->chat_completions",
]);

const DISCOURAGED_PAIRS = new Set([
  "anthropic->gemini",
  "gemini->anthropic",
]);

export function planConversion(from: GatewayProtocol, to: GatewayProtocol): ConversionPath {
  if (from === to) {
    return {
      from,
      to,
      quality: "good",
      steps: [{ id: "identity", from, to, kind: "identity" }],
    };
  }

  const pair = `${from}->${to}`;
  if (DISCOURAGED_PAIRS.has(pair)) {
    return {
      from,
      to,
      quality: "discouraged",
      steps: [
        { id: `${from}-to-chat`, from, to: "chat_completions", kind: "pivot" },
        { id: `chat-to-${to}`, from: "chat_completions", to, kind: "pivot" },
      ],
    };
  }

  return {
    from,
    to,
    quality: GOOD_PAIRS.has(pair) ? "good" : "fair",
    steps: [{ id: `${from}-to-${to}`, from, to, kind: "direct" }],
  };
}

export function conversionMatrix(): ConversionPath[] {
  const protocols: GatewayProtocol[] = ["responses", "chat_completions", "anthropic", "gemini"];
  return protocols.flatMap((from) => protocols.map((to) => planConversion(from, to)));
}
