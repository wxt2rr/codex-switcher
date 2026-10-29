import type { JsonObject } from "../protocol.js";
export declare function upstreamRequiresMoonshotSchema(baseUrl: string | undefined): boolean;
/** Rewrites `$ref` siblings to the draft-07-compatible allOf form. */
export declare function normalizeMoonshotChatTools(body: JsonObject): number;
