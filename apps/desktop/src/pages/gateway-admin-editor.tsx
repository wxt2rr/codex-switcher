import { useMemo, useState } from "react";
import { Input } from "../components/form-primitives";
import type { UiLanguage } from "../i18n";

type JsonObject = Record<string, unknown>;
type EditorSection = "providers" | "credentials" | "models" | "routeGroups" | "routeRules" | "agentBindings";
type FieldDefinition = { key: string; zh: string; en: string; boolean?: boolean; json?: boolean };

interface GatewayAdminDraft {
  gateway: JsonObject;
  agentBindings: Record<string, JsonObject>;
}

const SECTIONS: Array<{ id: EditorSection; zh: string; en: string }> = [
  { id: "providers", zh: "Provider", en: "Providers" },
  { id: "credentials", zh: "Credential", en: "Credentials" },
  { id: "models", zh: "Model", en: "Models" },
  { id: "routeGroups", zh: "RouteGroup", en: "RouteGroups" },
  { id: "routeRules", zh: "显式规则", en: "Explicit rules" },
  { id: "agentBindings", zh: "Agent", en: "Agents" },
];

const FIELD_DEFINITIONS: Record<EditorSection, FieldDefinition[]> = {
  providers: [
    { key: "displayName", zh: "名称", en: "Name" },
    { key: "kind", zh: "类型", en: "Kind" },
    { key: "modelDiscovery", zh: "模型发现", en: "Model discovery" },
    { key: "proxyUrl", zh: "Provider 代理", en: "Provider proxy" },
    { key: "requestHeaders", zh: "请求 Header(JSON)", en: "Request headers (JSON)", json: true },
    { key: "enabled", zh: "启用", en: "Enabled", boolean: true },
  ],
  credentials: [
    { key: "displayName", zh: "名称", en: "Name" },
    { key: "providerId", zh: "Provider", en: "Provider" },
    { key: "kind", zh: "类型", en: "Kind" },
    { key: "status", zh: "状态", en: "Status" },
    { key: "proxyUrl", zh: "Credential 代理", en: "Credential proxy" },
    { key: "modelIds", zh: "模型白名单(JSON)", en: "Model allowlist (JSON)", json: true },
    { key: "requestHeaders", zh: "请求 Header(JSON)", en: "Request headers (JSON)", json: true },
  ],
  models: [
    { key: "displayName", zh: "名称", en: "Name" },
    { key: "providerId", zh: "Provider", en: "Provider" },
    { key: "upstreamModelId", zh: "上游模型", en: "Upstream model" },
    { key: "enabled", zh: "启用", en: "Enabled", boolean: true },
  ],
  routeGroups: [
    { key: "displayName", zh: "名称", en: "Name" },
    { key: "exposedModelId", zh: "暴露模型", en: "Exposed model" },
    { key: "strategy", zh: "策略", en: "Strategy" },
    { key: "sessionPolicy", zh: "会话策略", en: "Session policy" },
    { key: "fallbackEnabled", zh: "故障切换", en: "Fallback", boolean: true },
  ],
  routeRules: [
    { key: "targetModelId", zh: "目标模型/路由组", en: "Target model/RouteGroup" },
    { key: "priority", zh: "优先级", en: "Priority" },
    { key: "enabled", zh: "启用", en: "Enabled", boolean: true },
  ],
  agentBindings: [
    { key: "displayName", zh: "名称", en: "Name" },
    { key: "defaultModelId", zh: "默认模型", en: "Default model" },
    { key: "defaultRouteGroupId", zh: "默认路由组", en: "Default route group" },
    { key: "reasoningProfile", zh: "推理档位", en: "Reasoning profile" },
    { key: "fallbackModelId", zh: "备用模型", en: "Fallback model" },
    { key: "subAgentModelId", zh: "子 Agent 模型", en: "Sub-agent model" },
    { key: "enabled", zh: "启用", en: "Enabled", boolean: true },
  ],
};

function parseDraft(value: string): GatewayAdminDraft | null {
  try {
    const parsed = JSON.parse(value) as JsonObject;
    const gateway = parsed.gateway && typeof parsed.gateway === "object" && !Array.isArray(parsed.gateway)
      ? parsed.gateway as JsonObject
      : parsed;
    const agentBindings = parsed.agentBindings && typeof parsed.agentBindings === "object" && !Array.isArray(parsed.agentBindings)
      ? parsed.agentBindings as Record<string, JsonObject>
      : {};
    return { gateway, agentBindings };
  } catch {
    return null;
  }
}

function collectionFor(draft: GatewayAdminDraft, section: EditorSection): Record<string, JsonObject> {
  if (section === "agentBindings") return draft.agentBindings;
  if (section === "routeRules") {
    const rules = draft.gateway.routeRules;
    return Array.isArray(rules)
      ? Object.fromEntries(rules.filter((rule): rule is JsonObject => Boolean(rule && typeof rule === "object" && !Array.isArray(rule))).map((rule) => [String(rule.id ?? ""), rule]))
      : {};
  }
  const collection = draft.gateway[section];
  return collection && typeof collection === "object" && !Array.isArray(collection) ? collection as Record<string, JsonObject> : {};
}

function defaultEntity(section: EditorSection, id: string): JsonObject {
  if (section === "providers") return { id, displayName: id, kind: "custom", endpoints: {}, modelDiscovery: "manual", enabled: true };
  if (section === "credentials") return { id, providerId: "", displayName: id, kind: "api_key", secretRef: `secure/${id}`, supportedProtocols: ["responses"], status: "active" };
  if (section === "models") return { id, providerId: "", upstreamModelId: id, displayName: id, protocols: ["responses"], capabilities: {}, enabled: true };
  if (section === "routeGroups") return { id, displayName: id, exposedModelId: id, members: [], strategy: "smart", sessionPolicy: "auto", fallbackEnabled: true };
  if (section === "routeRules") return { id, targetModelId: "", priority: 0, enabled: true, match: {} };
  return { agentId: id, displayName: id, gatewayId: "", originalConfigRef: `snapshot/${id}`, enabled: true };
}

export function GatewayAdminStructuredEditor({ value, onChange, language }: {
  value: string;
  onChange: (value: string) => void;
  language: UiLanguage;
}) {
  const [section, setSection] = useState<EditorSection>("providers");
  const [newId, setNewId] = useState("");
  const draft = useMemo(() => parseDraft(value), [value]);
  const entities = draft ? Object.entries(collectionFor(draft, section)) : [];
  const fields = FIELD_DEFINITIONS[section];

  function updateEntity(id: string, key: string, next: unknown) {
    if (!draft) return;
    const collection = collectionFor(draft, section);
    const current = collection[id];
    if (!current) return;
    const nextDraft: GatewayAdminDraft = { gateway: { ...draft.gateway }, agentBindings: { ...draft.agentBindings } };
    if (section === "agentBindings") nextDraft.agentBindings[id] = { ...current, [key]: next };
    else if (section === "routeRules") {
      const rules = Array.isArray(nextDraft.gateway.routeRules) ? nextDraft.gateway.routeRules : [];
      nextDraft.gateway.routeRules = rules.map((rule) => rule && typeof rule === "object" && String((rule as JsonObject).id ?? "") === id
        ? { ...(rule as JsonObject), [key]: next } : rule);
    }
    else nextDraft.gateway[section] = { ...draft.gateway[section] as JsonObject, [id]: { ...current, [key]: next } };
    onChange(JSON.stringify({ gateway: nextDraft.gateway, agentBindings: nextDraft.agentBindings }, null, 2));
  }

  function updateJsonEntity(id: string, key: string, value: string): void {
    if (!value.trim()) {
      updateEntity(id, key, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") updateEntity(id, key, parsed);
    } catch {
      // Keep the draft unchanged until the JSON is valid.
    }
  }

  function formatJsonField(value: unknown): string {
    return value === undefined ? "" : JSON.stringify(value);
  }

  function addEntity() {
    const id = newId.trim();
    if (!draft || !id || entities.some(([existingId]) => existingId === id)) return;
    const collection = collectionFor(draft, section);
    const created = { ...collection, [id]: defaultEntity(section, id) };
    const nextDraft: GatewayAdminDraft = { gateway: { ...draft.gateway }, agentBindings: { ...draft.agentBindings } };
    if (section === "agentBindings") nextDraft.agentBindings = created;
    else if (section === "routeRules") nextDraft.gateway.routeRules = [...(Array.isArray(draft.gateway.routeRules) ? draft.gateway.routeRules : []), defaultEntity(section, id)];
    else nextDraft.gateway[section] = created;
    onChange(JSON.stringify({ gateway: nextDraft.gateway, agentBindings: nextDraft.agentBindings }, null, 2));
    setNewId("");
  }

  if (!draft) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{language === "zh" ? "JSON 暂不可解析，请切换到高级 JSON 编辑器修复。" : "JSON cannot be parsed; use the advanced JSON editor to repair it."}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 rounded-lg bg-[#f7f8fa] p-1">
        {SECTIONS.map((item) => <button key={item.id} type="button" className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${section === item.id ? "bg-white text-neutral-900 shadow-sm" : "text-slate-500"}`} onClick={() => setSection(item.id)}>{language === "zh" ? item.zh : item.en} ({Object.keys(collectionFor(draft, item.id)).length})</button>)}
      </div>
      <div className="flex gap-2">
        <Input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder={language === "zh" ? "新记录 ID" : "New record ID"} className="h-8 flex-1 bg-white text-[11px]" />
        <button type="button" className="rounded-md bg-[#34C759] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50" disabled={!newId.trim()} onClick={addEntity}>{language === "zh" ? "新增" : "Add"}</button>
      </div>
      {entities.length ? entities.map(([id, entity]) => <div key={id} className="space-y-2 rounded-lg border border-black/[0.06] bg-white p-3">
        <div className="flex items-center justify-between"><span className="font-mono text-[11px] font-semibold text-neutral-800">{id}</span><span className="text-[10px] text-slate-400">{section === "agentBindings" ? "agent binding" : section}</span></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => field.boolean ? <label key={field.key} className="flex items-center gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={entity[field.key] !== false} onChange={(event) => updateEntity(id, field.key, event.target.checked)} />{language === "zh" ? field.zh : field.en}</label> : field.json ? <label key={field.key} className="space-y-1 text-[10px] text-slate-500"><span>{language === "zh" ? field.zh : field.en}</span><Input value={formatJsonField(entity[field.key])} onChange={(event) => updateJsonEntity(id, field.key, event.target.value)} className="h-8 bg-[#fafbfc] font-mono text-[11px]" placeholder={field.key === "modelIds" ? "[\"model-id\"]" : "{\"x-scope\":\"shared\"}"} /></label> : <label key={field.key} className="space-y-1 text-[10px] text-slate-500"><span>{language === "zh" ? field.zh : field.en}</span><Input value={typeof entity[field.key] === "string" ? entity[field.key] as string : ""} onChange={(event) => updateEntity(id, field.key, event.target.value)} className="h-8 bg-[#fafbfc] text-[11px]" /></label>)}
        </div>
      </div>) : <div className="rounded-lg bg-[#fafbfc] px-3 py-5 text-center text-[11px] text-slate-400">{language === "zh" ? "暂无记录" : "No records"}</div>}
      <p className="text-[10px] leading-5 text-slate-400">{language === "zh" ? "Credential 只编辑引用和状态，不会暴露或保存明文密钥；路由仍只使用显式模型、RouteGroup、能力、健康度、配额和策略。" : "Credentials edit references and status only; plaintext secrets are never exposed or saved. Routing remains explicit-model/RouteGroup based."}</p>
    </div>
  );
}
