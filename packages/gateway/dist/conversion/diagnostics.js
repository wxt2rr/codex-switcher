export class ConversionLossError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super(`Protocol conversion lost ${diagnostics.length} unsupported field(s)`);
        this.diagnostics = diagnostics;
        this.name = "ConversionLossError";
    }
}
export function enforceToolLossPolicy(diagnostics, policy) {
    if (policy === "allow" || diagnostics.length === 0)
        return;
    const rejected = policy === "strict"
        ? diagnostics
        : diagnostics.filter((diagnostic) => diagnostic.level === "error");
    if (rejected.length)
        throw new ConversionLossError(rejected);
}
//# sourceMappingURL=diagnostics.js.map