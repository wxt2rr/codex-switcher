const HOSTED_TYPES = new Set(["web_search", "web_search_preview", "web_search_options", "code_interpreter", "code_interpreter_preview", "python", "computer_use", "computer_use_preview", "file_search", "mcp", "tool_search", "image_generation", "shell"]);
/**
 * Protocols other than Responses do not have a namespace envelope. Preserve
 * the namespace boundary in a valid function name instead of sending two
 * same-named children upstream and hoping the provider can disambiguate them.
 * The generated name is request-scoped and is reversed with the explicit map
 * carried in ConversionMetadata; it is never decoded by string heuristics.
 */
export function qualifyToolsForProtocol(protocol, tools) {
    if (protocol === "responses")
        return { tools: [...tools], toolNameMap: {}, toolNamespaceMap: {}, toolKindMap: {}, toolChoiceMap: {} };
    const used = new Set(tools.filter((tool) => !tool.namespace).map((tool) => tool.name));
    const counts = new Map();
    for (const tool of tools)
        if (tool.namespace)
            counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    const toolNameMap = {};
    const toolNamespaceMap = {};
    const toolKindMap = {};
    const toolChoiceMap = {};
    const result = tools.map((tool) => {
        if (!tool.namespace) {
            toolKindMap[tool.name] = tool.kind;
            return { ...tool };
        }
        const base = sanitizeToolName(`${tool.namespace}__${tool.name}`);
        let qualified = base || "tool";
        let suffix = 2;
        while (used.has(qualified))
            qualified = `${trimToolName(base || "tool", 64 - String(suffix).length - 2)}__${suffix++}`;
        used.add(qualified);
        toolNameMap[qualified] = tool.name;
        toolNamespaceMap[qualified] = tool.namespace;
        toolKindMap[qualified] = tool.kind;
        // A bare tool-choice name is only safe when it identifies one child.
        if (counts.get(tool.name) === 1)
            toolChoiceMap[tool.name] = qualified;
        return { ...tool, name: qualified };
    });
    return { tools: result, toolNameMap, toolNamespaceMap, toolKindMap, toolChoiceMap };
}
export function decodeTools(protocol, value) {
    if (!Array.isArray(value))
        return [];
    if (protocol === "gemini") {
        return value.flatMap((item) => {
            if (!isObject(item))
                return [];
            if (Array.isArray(item.functionDeclarations))
                return item.functionDeclarations.flatMap((declaration) => decodeFunctionTool(declaration));
            return decodeGeminiHostedTool(item);
        });
    }
    return value.flatMap((item) => decodeToolItem(protocol, item));
}
function decodeToolItem(protocol, item, namespace, namespaceDescription) {
    if (!isObject(item))
        return [];
    const type = asString(item.type);
    if (type === "namespace") {
        const name = asString(item.name);
        const namespaceDeferLoading = asBoolean(item.defer_loading);
        const children = Array.isArray(item.tools) ? item.tools.flatMap((child) => decodeToolItem("responses", child, name, asString(item.description)).map((decoded) => ({ ...decoded, ...(namespaceDeferLoading !== undefined ? { namespaceDeferLoading } : {}) }))) : [];
        return children.length ? children : name ? [{ kind: "namespace", name, description: asString(item.description), ...(namespaceDeferLoading !== undefined ? { namespaceDeferLoading } : {}), raw: item }] : [];
    }
    if (type === "custom")
        return [{
                kind: "custom",
                name: asString(item.name) ?? "custom",
                description: asString(item.description),
                inputFormat: isObject(item.format) ? item.format : undefined,
                strict: asBoolean(item.strict),
                raw: item,
            }];
    if (isHostedType(type))
        return [decodeHostedTool(item, type)];
    if (protocol === "anthropic")
        return decodeFunctionTool(item, namespace, undefined, namespaceDescription);
    // Chat clients and relays frequently send Anthropic/MCP/bare/Responses
    // definitions. Normalize those foreign shapes before a strict Chat provider
    // sees an empty function name (Magpie does the same at its Chat boundary).
    return decodeFunctionTool(isObject(item.function) ? item.function : item, namespace, item, namespaceDescription);
}
function decodeGeminiHostedTool(item) {
    const key = ["googleSearch", "google_search", "codeExecution", "code_execution", "computerUse", "computer_use", "fileSearch", "file_search", "googleMaps", "google_maps", "enterpriseWebSearch", "enterprise_web_search"].find((candidate) => item[candidate] !== undefined);
    if (!key)
        return [];
    if (key === "googleSearch" || key === "google_search")
        return [{ kind: "web_search", name: key, raw: item }];
    if (key === "codeExecution" || key === "code_execution")
        return [{ kind: "code_interpreter", name: key, raw: item }];
    if (key === "computerUse" || key === "computer_use")
        return [{ kind: "computer_use", name: key, raw: item }];
    return [{ kind: "hosted", name: key, raw: item }];
}
function decodeHostedTool(item, type) {
    if (type.startsWith("web_search"))
        return { kind: "web_search", name: asString(item.name) ?? type, raw: item };
    if (type === "tool_search")
        return { kind: "tool_search", name: asString(item.name) ?? type, raw: item };
    if (["code_interpreter", "code_interpreter_preview", "python"].includes(type))
        return { kind: "code_interpreter", name: asString(item.name) ?? type, raw: item };
    if (["computer_use", "computer_use_preview"].includes(type))
        return { kind: "computer_use", name: asString(item.name) ?? type, raw: item };
    return { kind: "hosted", name: asString(item.name) ?? type, raw: item };
}
function isHostedType(type) {
    return Boolean(type && (HOSTED_TYPES.has(type) || type.startsWith("web_search_") || type.startsWith("code_execution_") || type.startsWith("computer_") || type.startsWith("bash_") || type.startsWith("text_editor_")));
}
function decodeFunctionTool(value, namespace, raw, namespaceDescription) {
    if (!isObject(value))
        return [];
    const name = asString(value.name);
    if (!name)
        return [];
    return [{
            kind: namespace ? "namespace" : "function",
            name,
            namespace,
            namespaceDescription,
            description: asString(value.description),
            inputSchema: isObject(value.parameters) ? value.parameters : isObject(value.input_schema) ? value.input_schema : isObject(value.inputSchema) ? value.inputSchema : undefined,
            strict: asBoolean(value.strict),
            deferLoading: asBoolean(value.defer_loading),
            raw: raw ?? value,
        }];
}
export function encodeTools(protocol, tools, capabilityProfile, capabilityPolicy = "allow", onOmit) {
    if (!tools.length)
        return undefined;
    const result = [];
    const namespaces = new Map();
    for (const tool of tools) {
        if (tool.namespace && protocol === "responses") {
            const group = namespaces.get(tool.namespace) ?? { tool, children: [] };
            group.children.push(tool);
            namespaces.set(tool.namespace, group);
            continue;
        }
        const encoded = encodeOneTool(protocol, tool, capabilityProfile, capabilityPolicy, onOmit);
        if (encoded !== undefined)
            result.push(encoded);
    }
    for (const [, group] of namespaces) {
        const children = group.children.flatMap((child) => {
            const encoded = encodeFunctionTool("responses", child);
            return encoded ? [encoded] : [];
        });
        if (children.length)
            result.push({ type: "namespace", name: group.tool.namespace, ...(group.tool.namespaceDescription ? { description: group.tool.namespaceDescription } : {}), ...(group.tool.namespaceDeferLoading !== undefined ? { defer_loading: group.tool.namespaceDeferLoading } : {}), tools: children });
    }
    if (protocol === "gemini") {
        const declarations = result.flatMap((item) => isObject(item) && Array.isArray(item.functionDeclarations) ? item.functionDeclarations : []);
        const native = result.filter((item) => !(isObject(item) && Array.isArray(item.functionDeclarations)));
        return declarations.length ? [...native, { functionDeclarations: declarations }] : native;
    }
    return result;
}
function encodeOneTool(protocol, tool, capabilityProfile, capabilityPolicy, onOmit) {
    const hosted = ["web_search", "code_interpreter", "computer_use", "tool_search", "hosted"].includes(tool.kind);
    const capability = hosted ? `tools.hosted.${tool.name}` : tool.kind === "function" ? "tools.function" : tool.kind === "custom" ? "tools.custom" : "tools.namespace";
    const observation = capabilityProfile?.[capability];
    if (capabilityPolicy === "safe" && hosted && (!observation || observation.status === "unknown" || observation.status === "unsupported")) {
        onOmit?.(tool, observation?.status === "unsupported" ? "selected route does not support this hosted tool" : "selected route capability is unknown");
        return undefined;
    }
    if (tool.kind === "namespace")
        return encodeFunctionTool(protocol, tool);
    if (tool.kind === "function")
        return encodeFunctionTool(protocol, tool);
    if (tool.kind === "custom") {
        if (protocol === "responses")
            return compactObject({ type: "custom", name: tool.name, description: tool.description, format: tool.inputFormat, strict: tool.strict });
        // Chat/Anthropic/Gemini have no equivalent custom-tool envelope. A custom
        // text tool can still be offered as a function, with a loss diagnostic.
        return encodeFunctionTool(protocol, { ...tool, kind: "function", inputSchema: customToolInputSchema(tool) });
    }
    if (tool.kind === "web_search") {
        if (protocol === "responses")
            return isResponsesHostedRaw(tool.raw, ["web_search", "web_search_preview"]) ? tool.raw : { type: "web_search_preview" };
        if (protocol === "chat_completions")
            return { type: "web_search_options" };
        if (protocol === "gemini")
            return { googleSearch: {} };
    }
    if (tool.kind === "tool_search") {
        if (protocol === "responses")
            return isResponsesHostedRaw(tool.raw, ["tool_search"]) ? tool.raw : { type: "tool_search" };
        // Other protocols have no hosted tool-search envelope. Expose a stable
        // function contract so the client can execute discovery and feed the
        // result back as a normal tool result instead of silently dropping it.
        return encodeFunctionTool(protocol, {
            ...tool,
            kind: "function",
            name: tool.name || "tool_search",
            inputSchema: tool.inputSchema ?? { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
        });
    }
    if (tool.kind === "code_interpreter" && protocol === "gemini")
        return { codeExecution: {} };
    if (tool.kind === "computer_use" && protocol === "gemini")
        return { computerUse: {} };
    if (tool.kind === "hosted" && protocol === "gemini" && tool.raw && ["googleSearch", "google_search", "codeExecution", "code_execution", "computerUse", "computer_use", "fileSearch", "file_search", "googleMaps", "google_maps", "enterpriseWebSearch", "enterprise_web_search"].some((key) => tool.raw?.[key] !== undefined))
        return tool.raw;
    if (protocol === "anthropic" && tool.raw && typeof tool.raw.type === "string" && (tool.raw.type.startsWith("web_search_") || tool.raw.type.startsWith("code_execution_") || tool.raw.type.startsWith("computer_") || tool.raw.type.startsWith("bash_") || tool.raw.type.startsWith("text_editor_")))
        return tool.raw;
    if (tool.kind === "code_interpreter" && protocol === "responses")
        return isResponsesHostedRaw(tool.raw, ["code_interpreter", "code_interpreter_preview"]) ? tool.raw : { type: "code_interpreter" };
    if (tool.kind === "computer_use" && protocol === "responses")
        return isResponsesHostedRaw(tool.raw, ["computer_use", "computer_use_preview"]) ? tool.raw : { type: "computer_use_preview" };
    if (tool.kind === "hosted" && protocol === "responses" && isResponsesHostedRaw(tool.raw, [...HOSTED_TYPES]))
        return tool.raw;
    // There is no standard cross-protocol representation for other hosted
    // tools. Dropping is safer than sending an invalid function definition.
    onOmit?.(tool, `target protocol '${protocol}' has no equivalent hosted-tool shape`);
    return undefined;
}
function isResponsesHostedRaw(raw, types) {
    return typeof raw?.type === "string" && types.includes(raw.type);
}
function encodeFunctionTool(protocol, tool) {
    const schema = sanitizeSchema(tool.inputSchema ?? { type: "object" });
    if (!tool.name)
        return undefined;
    if (protocol === "responses")
        return compactObject({ type: "function", name: tool.name, description: tool.description, parameters: schema, strict: tool.strict, defer_loading: tool.deferLoading });
    if (protocol === "chat_completions")
        return { type: "function", function: compactObject({ name: tool.name, description: tool.description, parameters: schema, strict: tool.strict }) };
    // Anthropic's tool contract has no OpenAI `strict` or Responses
    // `defer_loading` member; schema strictness is therefore enforced by the
    // gateway's validation/history path rather than sent as an unknown field.
    if (protocol === "anthropic")
        return compactObject({ name: tool.name, description: tool.description, input_schema: schema });
    return { functionDeclarations: [compactObject({ name: tool.name, description: tool.description, parameters: schema })] };
}
function customToolInputSchema(tool) {
    if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0)
        return sanitizeSchema(tool.inputSchema);
    return {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
        additionalProperties: false,
    };
}
function sanitizeToolName(value) {
    return trimToolName(value.replace(/[^A-Za-z0-9_-]/g, "_"), 64);
}
function trimToolName(value, max) {
    if (value.length <= max)
        return value;
    const suffix = `__${stableNameHash(value)}`;
    return `${value.slice(0, Math.max(1, max - suffix.length))}${suffix}`;
}
function stableNameHash(value) {
    // Small deterministic FNV-1a hash: names are protocol identifiers, not a
    // security boundary.  The suffix prevents two long namespaces that share
    // the same first 64 characters from silently aliasing.
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function sanitizeSchema(value) {
    const visit = (node, schemaNode) => {
        if (Array.isArray(node))
            return node.map((item) => visit(item, schemaNode));
        if (!isObject(node))
            return node;
        const result = {};
        for (const [key, child] of Object.entries(node)) {
            // Some Responses/MCP producers annotate a schema node as encrypted.
            // Ordinary function providers do not understand that extension; remove
            // only the marker at schema nodes and never a user property named
            // `encrypted` under `properties`.
            if (schemaNode && (key === "encrypted" || key === "x-encrypted") && typeof child === "boolean")
                continue;
            result[key] = visit(child, key === "properties" || key === "items" || key === "additionalProperties" || key === "allOf" || key === "anyOf" || key === "oneOf" || key === "not" || key === "schema");
        }
        return result;
    };
    return visit(value, true);
}
function isObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value) { return typeof value === "string" ? value : undefined; }
function asBoolean(value) { return typeof value === "boolean" ? value : undefined; }
function compactObject(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
//# sourceMappingURL=tool-converter.js.map