import { useEffect, useMemo, useState } from "react";

import type { ModelCatalogEntry } from "../bridge";
import {
  MODEL_CATALOG_ENUMS,
  MODEL_CATALOG_FORM_FIELDS,
  type ModelCatalogFieldDefinition,
} from "../model-editor";
import type { UiLanguage } from "../i18n";
import { Field, Input, Select, Textarea } from "./form-primitives";

const REASONING_DESCRIPTIONS: Record<string, string> = {
  none: "No reasoning",
  minimal: "Minimal reasoning",
  low: "Fast responses",
  medium: "Balanced reasoning",
  high: "Deeper reasoning",
  xhigh: "Extra deep reasoning",
  max: "Maximum reasoning depth",
  ultra: "Ultra reasoning depth",
};

const FIELD_GROUPS = [
  {
    title: "基础信息",
    titleEn: "Identity",
    keys: ["slug", "display_name", "description", "provider_id", "provider_display_name", "provider_model_key", "upstream_model_id", "model_source", "protocol", "wire_api", "api_protocol", "supported_protocols"],
  },
  {
    title: "能力与推理",
    titleEn: "Capabilities and reasoning",
    keys: ["default_reasoning_level", "supported_reasoning_levels", "supported_in_api", "supports_reasoning_summaries", "default_reasoning_summary", "support_verbosity", "default_verbosity", "supports_parallel_tool_calls", "supports_image_detail_original", "input_modalities", "supports_search_tool", "prefer_websockets"],
  },
  {
    title: "工具与运行时",
    titleEn: "Tools and runtime",
    keys: ["shell_type", "tool_mode", "apply_patch_tool_type", "web_search_tool_type", "multi_agent_version", "multi_agent_reasoning_effort", "use_responses_lite", "include_skills_usage_instructions", "include_plugin_usage_instructions", "include_apps_usage_instructions", "supports_experimental_context", "supports_reasoning_effort_updates", "node_repl_auto_review_required", "node_repl_disabled", "auto_review_model_override", "auto_compact_token_limit", "comp_hash", "reasoning_summary_format", "minimal_client_version"],
  },
  {
    title: "上下文与高级配置",
    titleEn: "Context and advanced settings",
    keys: ["visibility", "priority", "quality", "default_service_tier", "additional_speed_tiers", "service_tiers", "available_access_programs", "context_window", "max_context_window", "effective_context_window_percent", "base_instructions", "model_messages", "truncation_policy", "experimental_supported_tools", "availability_nux", "upgrade"],
  },
] as const;

function fieldValue(entry: ModelCatalogEntry, key: string): unknown {
  return entry[key];
}

function stringValue(entry: ModelCatalogEntry, key: string): string {
  const value = fieldValue(entry, key);
  return typeof value === "string" ? value : "";
}

function arrayValue(entry: ModelCatalogEntry, key: string): string[] {
  const value = fieldValue(entry, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function displayFieldLabel(field: ModelCatalogFieldDefinition, zh: boolean): string {
  return zh ? field.label : field.labelEn;
}

function displayFieldHint(field: ModelCatalogFieldDefinition, zh: boolean): string | undefined {
  return zh ? field.hint : field.hintEn;
}

function MultiSelectField({
  options,
  selected,
  onChange,
  zh,
}: {
  options: readonly string[];
  selected: string[];
  onChange: (value: string[]) => void;
  zh: boolean;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary p-2">
      {options.map((option) => (
        <label key={option} className="flex min-h-8 items-center gap-2 rounded-md px-2 text-[12px] text-foreground-secondary hover:bg-card/70 dark:hover:bg-card/[0.06]">
          <input
            type="checkbox"
            checked={selectedSet.has(option)}
            onChange={(event) => {
              const next = new Set(selectedSet);
              if (event.target.checked) next.add(option);
              else next.delete(option);
              onChange(options.filter((item) => next.has(item)));
            }}
            className="size-3.5 accent-primary"
          />
          <span>{option}</span>
        </label>
      ))}
      {!options.length ? <span className="col-span-2 px-2 text-[11px] text-muted-foreground">{zh ? "暂无可选项" : "No options"}</span> : null}
    </div>
  );
}

function ReasoningLevelsField({
  entry,
  onChange,
  zh,
}: {
  entry: ModelCatalogEntry;
  onChange: (value: ModelCatalogEntry) => void;
  zh: boolean;
}) {
  const current = Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : [];
  const selected = new Map(current.flatMap((value) => {
    if (typeof value === "string") return [[value, { effort: value, description: REASONING_DESCRIPTIONS[value] ?? value }] as const];
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).effort === "string") {
      const item = value as { effort: string; description?: unknown };
      return [[item.effort, { effort: item.effort, description: typeof item.description === "string" ? item.description : REASONING_DESCRIPTIONS[item.effort] ?? item.effort }] as const];
    }
    return [];
  }));

  return (
    <div className="grid gap-2 rounded-lg bg-secondary p-2">
      {MODEL_CATALOG_ENUMS.reasoningEfforts.map((effort) => (
        <label key={effort} className="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground-secondary hover:bg-card/70 dark:hover:bg-card/[0.06]">
          <input
            type="checkbox"
            checked={selected.has(effort)}
            onChange={(event) => {
              const next = new Map(selected);
              if (event.target.checked) next.set(effort, { effort, description: REASONING_DESCRIPTIONS[effort] ?? effort });
              else next.delete(effort);
              onChange({
                ...entry,
                supported_reasoning_levels: MODEL_CATALOG_ENUMS.reasoningEfforts
                  .filter((item) => next.has(item))
                  .map((item) => next.get(item) ?? { effort: item, description: REASONING_DESCRIPTIONS[item] ?? item }),
              });
            }}
            className="mt-0.5 size-3.5 accent-primary"
          />
          <span className="min-w-0"><span className="font-medium">{effort}</span><span className="ml-2 text-[11px] text-muted-foreground">{selected.get(effort)?.description ?? REASONING_DESCRIPTIONS[effort]}</span></span>
        </label>
      ))}
      {zh ? <p className="px-2 text-[11px] text-muted-foreground">可选推理级别会写回 supported_reasoning_levels 数组。</p> : null}
    </div>
  );
}

export function ModelCatalogForm({
  value,
  language,
  onChange,
}: {
  value: ModelCatalogEntry;
  language: UiLanguage;
  onChange: (value: ModelCatalogEntry) => void;
}) {
  const zh = language === "zh";
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setJsonDrafts(Object.fromEntries(
      MODEL_CATALOG_FORM_FIELDS
        .filter((field) => field.kind === "json")
        .map((field) => [field.key, jsonText(fieldValue(value, field.key))]),
    ));
    setJsonErrors({});
  }, [value]);

  function updateField(key: string, next: unknown) {
    onChange({ ...value, [key]: next });
  }

  function renderField(field: ModelCatalogFieldDefinition) {
    const label = displayFieldLabel(field, zh);
    const hint = displayFieldHint(field, zh);
    const current = fieldValue(value, field.key);

    if (field.kind === "boolean") {
      return (
        <Field key={field.key} label={label} hint={hint}>
          <label className="flex h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-[12px] text-foreground-secondary">
            <input type="checkbox" checked={current === true} onChange={(event) => updateField(field.key, event.target.checked)} className="size-3.5 accent-primary" />
            {zh ? "启用" : "Enabled"}
          </label>
        </Field>
      );
    }

    if (field.kind === "multi_select") {
      return <Field key={field.key} label={label} hint={hint}><MultiSelectField options={field.options ?? []} selected={arrayValue(value, field.key)} onChange={(next) => updateField(field.key, next)} zh={zh} /></Field>;
    }

    if (field.kind === "reasoning_levels") {
      return <Field key={field.key} label={label} hint={hint}><ReasoningLevelsField entry={value} onChange={onChange} zh={zh} /></Field>;
    }

    if (field.kind === "json") {
      const text = jsonDrafts[field.key] ?? jsonText(current);
      return (
        <Field key={field.key} label={label} hint={jsonErrors[field.key] ? (zh ? "JSON 格式无效，失焦后未写入。" : "Invalid JSON; the value was not applied.") : hint} error={jsonErrors[field.key] ? (zh ? "请修正 JSON 后再离开此字段" : "Fix the JSON before leaving this field") : undefined}>
          <Textarea
            value={text}
            onChange={(event) => setJsonDrafts((draft) => ({ ...draft, [field.key]: event.target.value }))}
            onBlur={() => {
              try {
                updateField(field.key, JSON.parse(jsonDrafts[field.key] ?? "null"));
                setJsonErrors((errors) => ({ ...errors, [field.key]: false }));
              } catch {
                setJsonErrors((errors) => ({ ...errors, [field.key]: true }));
              }
            }}
            className="min-h-[88px] font-mono text-[11px] leading-5"
            spellCheck={false}
          />
        </Field>
      );
    }

    if (field.kind === "select") {
      const unsetValue = "__unset__";
      const options = [unsetValue, ...(field.options ?? []).filter((option) => option !== unsetValue)];
      return (
        <Field key={field.key} label={label} hint={hint}>
          <Select
            value={typeof current === "string" && current ? current : unsetValue}
            onValueChange={(next) => updateField(field.key, next === unsetValue ? null : next)}
            items={options.map((option) => ({ value: option, label: option === unsetValue ? (zh ? "未设置" : "Not set") : option }))}
            openOnHover={false}
          />
        </Field>
      );
    }

    if (field.kind === "number") {
      return <Field key={field.key} label={label} hint={hint}><Input type="number" value={typeof current === "number" ? String(current) : ""} onChange={(event) => updateField(field.key, event.target.value === "" ? undefined : Number(event.target.value))} /></Field>;
    }

    const inputValue = stringValue(value, field.key);
    if (field.kind === "textarea") {
      return <Field key={field.key} label={label} hint={hint}><Textarea value={inputValue} onChange={(event) => updateField(field.key, event.target.value)} className="min-h-[82px]" /></Field>;
    }
    return <Field key={field.key} label={label} hint={hint}><Input value={inputValue} onChange={(event) => updateField(field.key, event.target.value)} /></Field>;
  }

  const fieldByKey = new Map(MODEL_CATALOG_FORM_FIELDS.map((field) => [field.key, field]));
  return (
    <div className="space-y-6">
      {FIELD_GROUPS.map((group) => {
        const fields = group.keys.map((key) => fieldByKey.get(key)).filter((field): field is ModelCatalogFieldDefinition => Boolean(field));
        return (
          <section key={group.title} className="space-y-3">
            <div className="border-b border-border-subtle pb-2 text-[12px] font-semibold text-muted-foreground dark:text-muted-foreground">{zh ? group.title : group.titleEn}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => <div key={field.key} className={field.kind === "textarea" || field.kind === "json" || field.kind === "multi_select" || field.kind === "reasoning_levels" ? "md:col-span-2" : undefined}>{renderField(field)}</div>)}
            </div>
          </section>
        );
      })}
      <p className="text-[11px] leading-5 text-muted-foreground">{zh ? "表单会保留 JSON 中未识别的扩展字段；需要编辑未知字段时继续使用 JSON 模式。" : "Unknown extension fields are preserved by the form; use JSON mode to edit fields not yet covered here."}</p>
    </div>
  );
}
