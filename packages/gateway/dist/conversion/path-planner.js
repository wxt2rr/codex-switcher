import { planConversion } from "./formats.js";
export class ConversionPathPlanner {
    plan(from, to, metadata = {}, options = {}) {
        const path = planConversion(from, to);
        return { path, metadata: { ...metadata }, options: { ...options } };
    }
    stepPaths(from, to) {
        return planConversion(from, to).steps;
    }
}
//# sourceMappingURL=path-planner.js.map