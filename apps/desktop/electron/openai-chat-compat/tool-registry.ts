import { createHash } from "node:crypto";

import { CompatibilityError, type ToolRegistry, type ToolRegistryEntry } from "./types.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function toChatToolName(original: string): string {
  const normalized = original.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (normalized.length <= 64) return normalized;
  const suffix = createHash("sha256").update(original).digest("hex").slice(0, 8);
  return `${normalized.slice(0, 55)}_${suffix}`;
}

function requiredName(tool: Record<string, unknown>, index: number): string {
  const implicitTypes = new Set(["tool_search", "web_search", "web_search_preview", "computer_use_preview", "local_shell"]);
  const name = typeof tool.name === "string" ? tool.name.trim()
    : typeof tool.type === "string" && implicitTypes.has(tool.type) ? tool.type : "";
  if (!name) throw new CompatibilityError("INVALID_TOOL", `Tool at index ${index} requires a name`);
  return name;
}

function functionDefinition(name: string, tool: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      parameters: record(tool.parameters) ?? { type: "object", properties: {} },
    },
  };
}

function customDefinition(name: string, tool: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
        additionalProperties: false,
      },
    },
  };
}

export function buildToolRegistry(request: Record<string, unknown>): ToolRegistry {
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const entries: ToolRegistryEntry[] = [];
  const byChatName = new Map<string, ToolRegistryEntry>();
  const byOriginalName = new Map<string, ToolRegistryEntry>();
  const add = (entry: ToolRegistryEntry) => {
    const collision = byChatName.get(entry.chatName);
    if (collision && collision.originalName !== entry.originalName) {
      throw new CompatibilityError("INVALID_TOOL", `Tools '${collision.originalName}' and '${entry.originalName}' map to '${entry.chatName}'`);
    }
    if (byOriginalName.has(entry.originalName)) {
      throw new CompatibilityError("INVALID_TOOL", `Duplicate tool '${entry.originalName}'`);
    }
    entries.push(entry);
    byChatName.set(entry.chatName, entry);
    byOriginalName.set(entry.originalName, entry);
  };

  tools.forEach((raw, index) => {
    const tool = record(raw);
    if (!tool || typeof tool.type !== "string") throw new CompatibilityError("INVALID_TOOL", `Invalid tool at index ${index}`);
    if (tool.type === "namespace") {
      const namespace = requiredName(tool, index);
      const members = Array.isArray(tool.tools) ? tool.tools : [];
      members.forEach((memberRaw, memberIndex) => {
        const member = record(memberRaw);
        if (!member) throw new CompatibilityError("INVALID_TOOL", `Invalid namespace tool at index ${memberIndex}`);
        const memberName = requiredName(member, memberIndex);
        const originalName = `${namespace}.${memberName}`;
        const chatName = toChatToolName(`${namespace}__${memberName}`);
        add({ originalType: "namespace", originalName, namespace, chatName,
          definition: member.type === "custom" ? customDefinition(chatName, member) : functionDefinition(chatName, member) });
      });
      return;
    }
    const originalName = requiredName(tool, index);
    const chatName = toChatToolName(originalName);
    if (tool.type === "function") add({ originalType: "function", originalName, chatName, definition: functionDefinition(chatName, tool) });
    else if (tool.type === "custom") add({ originalType: "custom", originalName, chatName, definition: customDefinition(chatName, tool) });
    else if (["tool_search", "web_search", "web_search_preview", "computer_use_preview", "local_shell"].includes(tool.type)) {
      add({ originalType: "tool_search", originalName, chatName, definition: customDefinition(chatName, tool) });
    }
    else throw new CompatibilityError("INVALID_TOOL", `Unsupported tool type '${tool.type}'`);
  });

  return { entries, chatTools: entries.map((entry) => entry.definition), byChatName, byOriginalName };
}
