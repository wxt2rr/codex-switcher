export type CompatibilityStage = "auth" | "text" | "stream" | "sequential_tool" | "parallel_tool" | "reasoning";
export interface CompatibilityProbeResult { stage: CompatibilityStage; required: boolean; ok: boolean; message: string; }
export interface CompatibilityCapabilities { text: boolean; streaming: boolean; sequentialTools: boolean; parallelTools: boolean; reasoning: boolean; }
export interface StagedCompatibilityResult {
  state: "ready" | "degraded" | "failed";
  checkedAt: number;
  probes: CompatibilityProbeResult[];
  capabilities: CompatibilityCapabilities;
}

export async function runCompatibilityCheck(options: {
  probe(stage: CompatibilityStage, signal: AbortSignal): Promise<void>;
  timeoutMs?: number;
}): Promise<StagedCompatibilityResult> {
  const definitions: Array<{ stage: CompatibilityStage; required: boolean }> = [
    { stage: "auth", required: true }, { stage: "text", required: true }, { stage: "stream", required: true },
    { stage: "sequential_tool", required: true }, { stage: "parallel_tool", required: false }, { stage: "reasoning", required: false },
  ];
  const probes: CompatibilityProbeResult[] = [];
  for (const definition of definitions) {
    try {
      await options.probe(definition.stage, AbortSignal.timeout(options.timeoutMs ?? 20_000));
      probes.push({ ...definition, ok: true, message: "Passed" });
    } catch (error) {
      probes.push({ ...definition, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const failed = probes.some((probe) => probe.required && !probe.ok);
  const degraded = probes.some((probe) => !probe.required && !probe.ok);
  const ok = (stage: CompatibilityStage) => probes.find((probe) => probe.stage === stage)?.ok === true;
  return { state: failed ? "failed" : degraded ? "degraded" : "ready", checkedAt: Date.now(), probes,
    capabilities: { text: ok("text"), streaming: ok("stream"), sequentialTools: ok("sequential_tool"),
      parallelTools: ok("parallel_tool"), reasoning: ok("reasoning") } };
}
