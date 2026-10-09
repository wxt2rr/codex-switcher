import { useEffect, useState } from "react";
import type { CSSProperties, SVGProps } from "react";

interface ProviderIconMeta {
  label: string;
  background: string;
  foreground: string;
}

const PROVIDER_ICON_META: Record<string, ProviderIconMeta> = {
  openai: { label: "◎", background: "#111827", foreground: "#ffffff" },
  anthropic: { label: "A", background: "#d97757", foreground: "#ffffff" },
  google: { label: "G", background: "#4285f4", foreground: "#ffffff" },
  deepseek: { label: "D", background: "#2563eb", foreground: "#ffffff" },
  moonshot: { label: "K", background: "#111827", foreground: "#ffffff" },
  kimi: { label: "K", background: "#111827", foreground: "#ffffff" },
  zhipu: { label: "智", background: "#2563eb", foreground: "#ffffff" },
  zai: { label: "智", background: "#2563eb", foreground: "#ffffff" },
  minimax: { label: "M", background: "#111827", foreground: "#ffffff" },
  stepfun: { label: "S", background: "#7c3aed", foreground: "#ffffff" },
  qwen: { label: "Q", background: "#2563eb", foreground: "#ffffff" },
  qianfan: { label: "千", background: "#2563eb", foreground: "#ffffff" },
  "tencent-cloud": { label: "T", background: "#2563eb", foreground: "#ffffff" },
  huawei: { label: "华", background: "#dc2626", foreground: "#ffffff" },
  volcengine: { label: "火", background: "#ea580c", foreground: "#ffffff" },
  mistral: { label: "M", background: "#f59e0b", foreground: "#111827" },
  groq: { label: "G", background: "#111827", foreground: "#ffffff" },
  xai: { label: "𝕏", background: "#111827", foreground: "#ffffff" },
  openrouter: { label: "OR", background: "#6d28d9", foreground: "#ffffff" },
  together: { label: "T", background: "#0f766e", foreground: "#ffffff" },
  fireworks: { label: "F", background: "#ea580c", foreground: "#ffffff" },
  siliconflow: { label: "Si", background: "#0891b2", foreground: "#ffffff" },
  nvidia: { label: "N", background: "#65a30d", foreground: "#ffffff" },
  modelscope: { label: "MS", background: "#0284c7", foreground: "#ffffff" },
  ollama: { label: "O", background: "#111827", foreground: "#ffffff" },
  lmstudio: { label: "LM", background: "#475569", foreground: "#ffffff" },
  mimo: { label: "Mi", background: "#dc2626", foreground: "#ffffff" },
  cursor: { label: "C", background: "#111827", foreground: "#ffffff" },
  chatgpt: { label: "◎", background: "#111827", foreground: "#ffffff" },
  "codex-subscription": { label: "◎", background: "#111827", foreground: "#ffffff" },
  "claude-subscription": { label: "A", background: "#d97757", foreground: "#ffffff" },
  "github-copilot": { label: "⌘", background: "#111827", foreground: "#ffffff" },
  devin: { label: "Dv", background: "#2563eb", foreground: "#ffffff" },
  custom: { label: "?", background: "#64748b", foreground: "#ffffff" },
};

// Keep the application catalog ids separate from the brand catalog ids. Some
// providers have aliases in our adapter catalog, while LobeHub uses the
// vendor's public brand name as the icon slug.
const LOBE_ICON_SLUGS: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  moonshot: "moonshot",
  kimi: "moonshot",
  zhipu: "zhipu",
  zai: "zhipu",
  minimax: "minimax",
  stepfun: "stepfun",
  qwen: "qwen",
  qianfan: "baiducloud",
  "tencent-cloud": "tencentcloud",
  huawei: "huaweicloud",
  "huawei-maas": "huaweicloud",
  volcengine: "volcengine",
  "volcengine-ark": "volcengine",
  mistral: "mistral",
  groq: "groq",
  xai: "xai",
  openrouter: "openrouter",
  together: "together",
  fireworks: "fireworks",
  siliconflow: "siliconcloud",
  nvidia: "nvidia",
  "nvidia-nim": "nvidia",
  modelscope: "modelscope",
  ollama: "ollama",
  lmstudio: "lmstudio",
  mimo: "xiaomimimo",
  cursor: "cursor",
  chatgpt: "openai",
  "codex-subscription": "openai",
  "claude-subscription": "anthropic",
  "copilot-subscription": "githubcopilot",
  "gemini-subscription": "google",
  "grok-subscription": "xai",
  "cursor-subscription": "cursor",
  "devin-subscription": "devin",
  "github-copilot": "githubcopilot",
  devin: "devin",
};

const LOBE_ICON_CDN_BASES = [
  "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/",
  "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/",
] as const;

function fallbackMeta(providerId?: string, displayName?: string): ProviderIconMeta {
  const label = (displayName?.trim() || providerId?.trim() || "?").slice(0, 2).toUpperCase();
  return { label, background: "#64748b", foreground: "#ffffff" };
}

export function providerIconUrls(providerId?: string): string[] {
  const slug = providerId ? LOBE_ICON_SLUGS[providerId.trim().toLowerCase()] : undefined;
  return slug ? LOBE_ICON_CDN_BASES.map((base) => `${base}${slug}.svg`) : [];
}

function FallbackProviderIcon({
  providerId,
  displayName,
  size,
  className,
  ...svgProps
}: {
  providerId?: string;
  displayName?: string;
  size: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox">) {
  const meta = (providerId ? PROVIDER_ICON_META[providerId] : undefined) ?? fallbackMeta(providerId, displayName);
  const style: CSSProperties = { flex: "none" };
  return (
    <svg
      {...svgProps}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={displayName || providerId || "Provider"}
      className={className}
      style={style}
      data-provider-icon-fallback="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill={meta.background} />
      <text
        x="16"
        y="17"
        dominantBaseline="middle"
        textAnchor="middle"
        fill={meta.foreground}
        fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        fontSize={meta.label.length > 2 ? "8" : "13"}
        fontWeight="700"
      >
        {meta.label}
      </text>
    </svg>
  );
}

export function ProviderIcon({
  providerId,
  displayName,
  size = 24,
  className,
  ...svgProps
}: {
  providerId?: string;
  displayName?: string;
  size?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox">) {
  const urls = providerIconUrls(providerId);
  const [urlIndex, setUrlIndex] = useState(0);
  useEffect(() => setUrlIndex(0), [providerId]);

  const iconUrl = urls[urlIndex];
  if (iconUrl) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", width: size, height: size, flex: "none", alignItems: "center", justifyContent: "center" }}
        role="img"
        aria-label={displayName || providerId || "Provider"}
        data-provider-icon-source="lobehub"
      >
        <img
          src={iconUrl}
          width={size}
          height={size}
          alt=""
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
          onError={() => setUrlIndex((current) => current + 1)}
        />
      </span>
    );
  }

  return (
    <FallbackProviderIcon
      {...svgProps}
      providerId={providerId}
      displayName={displayName}
      size={size}
      className={className}
    />
  );
}

export function providerIconMeta(providerId: string): ProviderIconMeta {
  return PROVIDER_ICON_META[providerId] ?? fallbackMeta(providerId);
}
