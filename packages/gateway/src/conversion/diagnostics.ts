import type { GatewayProtocol } from "../protocol.js";

export type ConversionDiagnosticLevel = "warning" | "error";
export type ToolLossPolicy = "allow" | "safe" | "strict";

export interface ConversionDiagnostic {
  code: string;
  level: ConversionDiagnosticLevel;
  message: string;
  source: GatewayProtocol;
  target: GatewayProtocol;
  path?: string;
}

export class ConversionLossError extends Error {
  constructor(public readonly diagnostics: readonly ConversionDiagnostic[]) {
    super(`Protocol conversion lost ${diagnostics.length} unsupported field(s)`);
    this.name = "ConversionLossError";
  }
}

export function enforceToolLossPolicy(
  diagnostics: readonly ConversionDiagnostic[],
  policy: ToolLossPolicy,
): void {
  if (policy === "allow" || diagnostics.length === 0) return;
  const rejected = policy === "strict"
    ? diagnostics
    : diagnostics.filter((diagnostic) => diagnostic.level === "error");
  if (rejected.length) throw new ConversionLossError(rejected);
}
