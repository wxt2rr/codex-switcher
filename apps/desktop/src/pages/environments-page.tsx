import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronDown, CircleAlert, Copy, Ellipsis, FolderPlus, LoaderCircle, Monitor, Network, RadioTower, Search, Shuffle, RotateCcw, TerminalSquare, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAdaptiveMenuLayout } from "../components/adaptive-menu-placement";
import { useDelayedUnmount } from "../components/use-delayed-unmount";
import { cn } from "../lib/utils";
import type {
  AccountPoolInput,
  AccountPoolStatus,
  CodexConversationCandidate,
  CodexConversationInspectionResult,
  CodexConversationRepairResult,
  CodexHistorySyncResult,
  DesktopEnvEditableFiles,
  DesktopEnvFileHistoryEntry,
} from "../bridge";
import {
  EmptyList,
  ListCard,
  ListPageFrame,
  ListStack,
  SoftBadge,
} from "../components/account-list-primitives";
import { ConfirmDialog, ProgressDialog, SidePanel } from "../components/admin-primitives";
import { Field, Input, Select, Textarea } from "../components/form-primitives";
import type { EnvironmentModelIdentityMode, EnvironmentRemoteStatus, EnvironmentRoutePreview, EnvironmentRouteStatus, EnvSummary, OverviewPayload } from "../desktop-model";
import { getDesktopCopy } from "../desktop-copy";
import { getTranslations, type UiLanguage } from "../i18n";
import { ProviderIcon } from "../components/provider-icon";

function pageTitle(language: UiLanguage) {
  if (language === "zh") return "环境管理";
  if (language === "ja") return "環境管理";
  return "Environment Management";
}

function pageSubtitle(language: UiLanguage) {
  if (language === "zh") return "管理 Codex 环境、路径和账号归属";
  if (language === "ja") return "Codex 環境、パス、アカウントを管理";
  return "Manage Codex environments, paths, and account ownership";
}

function conversationRepairStatusLabel(status: CodexConversationCandidate["status"], language: UiLanguage) {
  if (language === "zh") {
    return {
      "already-current": "已是当前 provider",
      repairable: "可以修复",
      "provider-missing": "当前 provider 未配置",
      "model-mismatch": "模型不一致",
      "metadata-mismatch": "会话元数据不一致",
      incomplete: "会话元数据不完整",
    }[status];
  }
  if (language === "ja") {
    return {
      "already-current": "現在の provider と一致",
      repairable: "修復可能",
      "provider-missing": "現在の provider が未設定",
      "model-mismatch": "モデルが不一致",
      "metadata-mismatch": "メタデータが不一致",
      incomplete: "メタデータが不完全",
    }[status];
  }
  return {
    "already-current": "Already uses current provider",
    repairable: "Ready to repair",
    "provider-missing": "Current provider is missing",
    "model-mismatch": "Model mismatch",
    "metadata-mismatch": "Metadata mismatch",
    incomplete: "Incomplete metadata",
  }[status];
}

function conversationRepairStatusClass(status: CodexConversationCandidate["status"]) {
  if (status === "repairable" || status === "metadata-mismatch") return "bg-warm-50 text-warm-600";
  if (status === "already-current") return "bg-primary/10 text-primary";
  return "bg-destructive/10 text-destructive";
}

type HistoryFileType = "config.toml" | "auth.json";

type SyncHistoryDialogState = {
  envName: string;
  phase: "running" | "success" | "error";
  step: number;
  result?: CodexHistorySyncResult;
  error?: string;
};

type ConversationRepairDialogState = {
  phase: "input" | "analyzing" | "ready" | "repairing" | "success" | "error";
  conversationId: string;
  preferredEnvName?: string;
  inspection?: CodexConversationInspectionResult;
  result?: CodexConversationRepairResult;
  error?: string;
};

const syncHistorySteps = [
  { zh: "检查环境和运行中的 Codex", ja: "環境と実行中の Codex を確認中", en: "Checking the environment and running Codex instances" },
  { zh: "扫描会话文件和本地索引", ja: "セッションファイルとローカルインデックスをスキャン中", en: "Scanning session files and the local index" },
  { zh: "统一 provider 并写入会话元数据", ja: "provider メタデータをセッションに反映中", en: "Updating provider metadata in sessions" },
  { zh: "保存备份并完成同步", ja: "バックアップを保存して同期を完了中", en: "Saving the backup and finishing the sync" },
];

type HistorySnapshotGroup = {
  key: string;
  createdAt: string;
  source: DesktopEnvFileHistoryEntry["source"];
  files: Record<
    HistoryFileType,
    {
      entryId?: string;
      content: string;
      changed: boolean;
    }
  >;
};

function localizeHistorySource(source: DesktopEnvFileHistoryEntry["source"], language: UiLanguage) {
  if (language === "zh") {
    if (source === "switch-cli") return "切换 CLI";
    if (source === "switch-app") return "切换 App";
    if (source === "restore") return "还原";
    return "手动修改";
  }
  if (source === "switch-cli") return "Switch CLI";
  if (source === "switch-app") return "Switch App";
  if (source === "restore") return "Restore";
  return "Manual edit";
}

function formatHistoryTimestamp(value: string) {
  return value.replace("T", " ").replace("Z", "");
}

function buildHistorySnapshotGroups(entries: DesktopEnvFileHistoryEntry[]): HistorySnapshotGroup[] {
  const groups = new Map<string, HistorySnapshotGroup>();

  for (const entry of entries) {
    const key = `${entry.createdAt}__${entry.source}`;
    const current = groups.get(key) ?? {
      key,
      createdAt: entry.createdAt,
      source: entry.source,
      files: {
        "config.toml": { content: "", changed: false },
        "auth.json": { content: "", changed: false },
      },
    };

    current.files[entry.fileType] = {
      entryId: entry.id,
      content: entry.content,
      changed: true,
    };
    groups.set(key, current);
  }

  return Array.from(groups.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getRouteRuntimeSummary(routeStatus: EnvironmentRouteStatus | undefined, language: UiLanguage) {
  if (!routeStatus) {
    return {
      tone: "neutral" as const,
      label: language === "zh" ? "状态未加载" : language === "ja" ? "状態未取得" : "Status unavailable",
      detail: "",
    };
  }

  const accountDetail = routeStatus.routedAccounts > 0
    ? language === "zh"
      ? `${routeStatus.routedAccounts} 个账号已接入`
      : language === "ja"
        ? `${routeStatus.routedAccounts} アカウント接続`
        : `${routeStatus.routedAccounts} accounts connected`
    : "";
  const endpointDetail = routeStatus.port ? `127.0.0.1:${routeStatus.port}` : "";

  if (routeStatus.gatewayEnabled && routeStatus.enabled) {
    return {
      tone: "success" as const,
      label: language === "zh" ? "网关运行中" : language === "ja" ? "ゲートウェイ稼働中" : "Gateway running",
      detail: [endpointDetail, accountDetail].filter(Boolean).join(" · "),
    };
  }
  if (routeStatus.gatewayEnabled) {
    return {
      tone: "warn" as const,
      label: language === "zh" ? "网关已配置，服务未运行" : language === "ja" ? "ゲートウェイ設定済み・停止中" : "Gateway configured, service stopped",
      detail: "",
    };
  }
  if (routeStatus.enabled) {
    return {
      tone: "success" as const,
      label: language === "zh" ? "本地路由运行中" : language === "ja" ? "ローカルルート稼働中" : "Local routing running",
      detail: [endpointDetail, accountDetail].filter(Boolean).join(" · "),
    };
  }
  return {
    tone: "neutral" as const,
    label: language === "zh" ? "服务未运行" : language === "ja" ? "サービス停止中" : "Service stopped",
    detail: "",
  };
}

function EnvironmentActionMenu({
  language,
  busy,
  onEdit,
  onConfig,
  onHistory,
  onSyncHistory,
  onRepairConversation,
  onDelete,
}: {
  language: UiLanguage;
  busy: boolean;
  onEdit: () => void;
  onConfig: () => void;
  onHistory: () => void;
  onSyncHistory: () => void;
  onRepairConversation: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuMounted = useDelayedUnmount(open, 140);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { placement, availableHeight } = useAdaptiveMenuLayout(menuMounted, rootRef, menuRef);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const items = [
    { key: "edit", label: language === "zh" ? "编辑环境" : language === "ja" ? "環境を編集" : "Edit environment", onSelect: onEdit },
    { key: "config", label: language === "zh" ? "修改环境文件" : language === "ja" ? "環境ファイルを変更" : "Edit environment files", onSelect: onConfig },
    { key: "history", label: language === "zh" ? "查看修改历史" : language === "ja" ? "変更履歴を表示" : "View change history", onSelect: onHistory },
    { key: "sync-history", label: language === "zh" ? "同步对话列表" : language === "ja" ? "会話履歴を同期" : "Sync conversation history", onSelect: onSyncHistory },
    { key: "repair-conversation", label: language === "zh" ? "修复指定会话" : language === "ja" ? "指定会話を修復" : "Repair conversation", onSelect: onRepairConversation },
    { key: "delete", label: language === "zh" ? "删除环境" : language === "ja" ? "環境を削除" : "Delete environment", onSelect: onDelete, tone: "danger" as const },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="motion-interactive-color flex size-9 items-center justify-center rounded-lg bg-[#f7f8fa] text-neutral-700 hover:bg-[#eef1f4] hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-55"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-label={language === "zh" ? "更多操作" : language === "ja" ? "その他の操作" : "More actions"}
        title={language === "zh" ? "更多操作" : language === "ja" ? "その他の操作" : "More actions"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis className="size-4" />
      </button>
      {menuMounted ? (
        <div
          ref={menuRef}
          data-state={open ? "open" : "closed"}
          data-menu-placement={placement}
          className={cn(
            "motion-popover-enter absolute right-0 z-40 min-w-[172px] overflow-y-auto rounded-lg border border-black/[0.08] bg-white p-1.5 shadow-md",
            placement === "up" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
          style={{ transformOrigin: placement === "up" ? "bottom right" : "top right", maxHeight: availableHeight }}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "motion-interactive-color flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] font-medium",
                item.tone === "danger" ? "text-destructive hover:bg-destructive/10" : "text-neutral-700 hover:bg-[#f6f7f9]",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              role="menuitem"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type RouteMapEdge = {
  key: string;
  from: string;
  to: string;
  kind: "gateway-model" | "model-provider";
  d: string;
};

function RoutePreviewPanel({ preview, language }: { preview?: EnvironmentRoutePreview; language: UiLanguage }) {
  const detailsId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const gatewayRef = useRef<HTMLDivElement>(null);
  const gatewayAddressRef = useRef<HTMLDivElement>(null);
  const modelStackRef = useRef<HTMLDivElement>(null);
  const modelRefs = useRef<Record<string, HTMLElement | null>>({});
  const providerRefs = useRef<Record<string, HTMLElement | null>>({});
  const centeredLayoutKeyRef = useRef<string | undefined>(undefined);
  const [edgeLayout, setEdgeLayout] = useState<{ width: number; height: number; edges: RouteMapEdge[] }>({ width: 0, height: 0, edges: [] });
  const [gatewayAddressOverflow, setGatewayAddressOverflow] = useState(false);
  const [gatewayAddressShift, setGatewayAddressShift] = useState(0);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>();
  const [expanded, setExpanded] = useState(false);

  const providerNodes = useMemo(() => {
    if (!preview) return [];
    const providers = new Map<string, { providerId: string; displayName: string }>();
    preview.models.forEach((model) => {
      model.routes.forEach((route) => {
        const providerId = route.providerId || "unknown";
        const existing = providers.get(providerId);
        if (!existing) {
          providers.set(providerId, {
            providerId,
            displayName: route.providerDisplayName || providerId,
          });
        }
      });
    });
    // Preserve the first-seen route order from the compiled route groups. This
    // keeps the visual provider order aligned with the configured fallback
    // order instead of re-sorting the graph alphabetically.
    return Array.from(providers.values());
  }, [preview]);

  useEffect(() => {
    if (!preview) return undefined;
    const canvas = canvasRef.current;
    const gateway = gatewayRef.current;
    if (!canvas || !gateway) return undefined;

    let frame = 0;
    const updateEdges = () => {
      frame = 0;
      const canvasRect = canvas.getBoundingClientRect();
      const gatewayRect = gateway.getBoundingClientRect();
      if (!canvasRect.width || !canvasRect.height || !gatewayRect.width) return;
      const startX = gatewayRect.right - canvasRect.left;
      const startY = gatewayRect.top + gatewayRect.height / 2 - canvasRect.top;
      const curvePath = (fromX: number, fromY: number, toX: number, toY: number) => {
        // Keep the control points inside the horizontal gap. A fixed minimum
        // curve makes the model→provider links fold back on themselves when
        // compact columns leave only a few pixels between cards.
        const distance = Math.abs(toX - fromX);
        const curve = Math.min(180, distance * 0.42, Math.max(2, distance / 2 - 2));
        return `M ${fromX.toFixed(1)} ${fromY.toFixed(1)} C ${(fromX + curve).toFixed(1)} ${fromY.toFixed(1)}, ${(toX - curve).toFixed(1)} ${toY.toFixed(1)}, ${toX.toFixed(1)} ${toY.toFixed(1)}`;
      };
      const edges = preview.models.flatMap((model) => {
        const node = modelRefs.current[model.exposedModelId];
        if (!node) return [];
        const nodeRect = node.getBoundingClientRect();
        const modelX = nodeRect.left - canvasRect.left;
        const modelY = nodeRect.top + nodeRect.height / 2 - canvasRect.top;
        const modelKey = `model:${model.exposedModelId}`;
        const modelEdges: RouteMapEdge[] = [{
          key: `gateway->${modelKey}`,
          from: "gateway",
          to: modelKey,
          kind: "gateway-model",
          d: curvePath(startX, startY, modelX, modelY),
        }];
        if (preview.mode !== "unified") return modelEdges;
        const providerIds = new Set(model.routes.map((route) => route.providerId || "unknown"));
        providerIds.forEach((providerId) => {
          const providerNode = providerRefs.current[providerId];
          if (!providerNode) return;
          const providerRect = providerNode.getBoundingClientRect();
          const providerX = providerRect.left - canvasRect.left;
          const providerY = providerRect.top + providerRect.height / 2 - canvasRect.top;
          const providerKey = `provider:${providerId}`;
          modelEdges.push({
            key: `${modelKey}->${providerKey}`,
            from: modelKey,
            to: providerKey,
            kind: "model-provider",
            d: curvePath(nodeRect.right - canvasRect.left, modelY, providerX, providerY),
          });
        });
        return modelEdges;
      });
      const address = gatewayAddressRef.current;
      if (address) {
        const shift = Math.min(0, address.clientWidth - address.scrollWidth);
        const overflowing = shift < 0;
        setGatewayAddressOverflow((current) => current === overflowing ? current : overflowing);
        setGatewayAddressShift((current) => current === shift ? current : shift);
      }
      setEdgeLayout((current) => {
        const next = { width: canvasRect.width, height: canvasRect.height, edges };
        return current.width === next.width && current.height === next.height && current.edges.length === next.edges.length && current.edges.every((edge, index) => edge.key === next.edges[index]?.key && edge.d === next.edges[index]?.d)
          ? current
          : next;
      });
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateEdges);
    };
    const modelStack = modelStackRef.current;
    const layoutKey = `${preview.envName}:${preview.mode}`;
    if (modelStack && centeredLayoutKeyRef.current !== layoutKey && modelStack.scrollHeight > modelStack.clientHeight) {
      modelStack.scrollTop = Math.max(0, (modelStack.scrollHeight - modelStack.clientHeight) / 2);
      centeredLayoutKeyRef.current = layoutKey;
    }
    scheduleUpdate();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleUpdate);
    observer?.observe(canvas);
    observer?.observe(gateway);
    if (gatewayAddressRef.current) observer?.observe(gatewayAddressRef.current);
    preview.models.forEach((model) => {
      const node = modelRefs.current[model.exposedModelId];
      if (node) observer?.observe(node);
    });
    providerNodes.forEach((provider) => {
      const node = providerRefs.current[provider.providerId];
      if (node) observer?.observe(node);
    });
    modelStack?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      modelStack?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [preview?.generatedAt, preview?.models, preview?.mode, providerNodes]);

  useEffect(() => {
    setSelectedNodeKey(undefined);
  }, [preview?.envName, preview?.mode]);

  const highlightedNodeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!preview || !selectedNodeKey) return keys;
    keys.add(selectedNodeKey);
    if (selectedNodeKey === "gateway") {
      preview.models.forEach((model) => keys.add(`model:${model.exposedModelId}`));
    } else if (selectedNodeKey.startsWith("model:")) {
      const modelId = selectedNodeKey.slice("model:".length);
      const model = preview.models.find((candidate) => candidate.exposedModelId === modelId);
      model?.routes.forEach((route) => keys.add(`provider:${route.providerId || "unknown"}`));
    }
    return keys;
  }, [preview, selectedNodeKey]);
  if (!preview) return null;
  const isUnifiedMode = preview.mode === "unified";
  const isScrollable = preview.models.length > 5 || providerNodes.length > 5;
  const healthyCount = preview.models.reduce((total, model) => total + model.routes.filter((route) => route.status === "healthy").length, 0);
  const routeCount = preview.models.reduce((total, model) => total + model.routes.length, 0);
  const providerCount = providerNodes.length;
  const gatewayAddress = preview.baseUrl ?? "127.0.0.1";
  return (
    <div className="route-map-shell" data-expanded={expanded}>
      <div className="route-map-header">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-neutral-900">
            <span className="route-map-title-mark" aria-hidden="true" />
            {language === "zh" ? "路由关系图" : language === "ja" ? "ルートマップ" : "Route map"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {preview.gatewayStatus === "running"
              ? (language === "zh" ? "当前展示已编译并运行中的真实路由" : "Compiled routes currently running in the gateway")
              : (language === "zh" ? "网关开启后展示实际运行路由" : "Actual routes appear when Gateway mode is enabled")}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SoftBadge tone={preview.gatewayStatus === "running" ? "success" : preview.gatewayStatus === "configured" ? "warn" : "neutral"} label={preview.gatewayStatus === "running" ? (language === "zh" ? "运行中" : "Running") : preview.gatewayStatus === "configured" ? (language === "zh" ? "已配置" : "Configured") : (language === "zh" ? "直连" : "Direct")} className="h-5 px-2 text-[10px]" />
          <button
            type="button"
            className="route-map-toggle"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
          >
            {language === "zh" ? "路由详情" : language === "ja" ? "ルート詳細" : "Route details"}
            <ChevronDown className={cn("route-map-chevron", expanded && "is-expanded")} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id={detailsId} className="route-map-details" data-expanded={expanded} aria-hidden={!expanded}>
        <div className="route-map-details-inner">
          {preview.warnings.length ? <div className="mt-3 space-y-1 text-[11px] text-warm-700">{preview.warnings.slice(0, 3).map((warning) => <div key={warning}>· {warning}</div>)}</div> : null}
          <div ref={canvasRef} className={cn("route-map-canvas mt-4", isUnifiedMode ? "is-unified" : "is-account", isScrollable && "is-scrollable")}>
            <svg className="route-map-edges" viewBox={`0 0 ${Math.max(1, edgeLayout.width)} ${Math.max(1, edgeLayout.height)}`} preserveAspectRatio="none" aria-hidden="true">
              {edgeLayout.edges.map((edge) => <path key={edge.key} className={cn(`route-map-edge-${edge.kind}`, selectedNodeKey && edge.from === selectedNodeKey && "is-active", selectedNodeKey && edge.from !== selectedNodeKey && "is-dimmed")} d={edge.d} />)}
            </svg>
            <section className="route-map-core" aria-label={language === "zh" ? "Switcher 网关" : "Switcher gateway"}>
              <div
                ref={gatewayRef}
                className={cn("route-map-gateway-node", selectedNodeKey === "gateway" && "is-selected", highlightedNodeKeys.has("gateway") && selectedNodeKey !== "gateway" && "is-active-downstream", selectedNodeKey && !highlightedNodeKeys.has("gateway") && "is-dimmed")}
                role="button"
                tabIndex={0}
                aria-pressed={selectedNodeKey === "gateway"}
                aria-label={language === "zh" ? "选择 Switcher 网关以高亮下游路由" : "Select the Switcher gateway to highlight downstream routes"}
                onClick={() => setSelectedNodeKey((current) => current === "gateway" ? undefined : "gateway")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedNodeKey((current) => current === "gateway" ? undefined : "gateway");
                  }
                }}
              >
                <div className="route-map-gateway-icon"><img src="./logo.png" alt="" draggable={false} /></div>
                <div className="mt-2 text-[12px] font-semibold text-neutral-950">Switcher Gateway</div>
                <div ref={gatewayAddressRef} className={cn("route-map-gateway-address mt-0.5", gatewayAddressOverflow && "is-overflowing")} title={gatewayAddress}>
                  <span className="route-map-gateway-address-track" style={{ "--route-map-address-shift": `${gatewayAddressShift}px` } as CSSProperties}>{gatewayAddress}</span>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1"><SoftBadge tone={preview.mode === "unified" ? "brand" : "neutral"} label={preview.mode === "unified" ? (language === "zh" ? "统一路由" : "Unified") : (language === "zh" ? "按服务商" : "By provider")} className="h-5 px-1.5 text-[10px]" /></div>
              </div>
            </section>

            <section className="route-map-flow" aria-label={isUnifiedMode ? (language === "zh" ? "统一逻辑模型和服务商路由" : "Unified logical models and provider routes") : (language === "zh" ? "按服务商区分的模型" : "Provider-qualified models")}>
              <div ref={modelStackRef} className={cn("route-map-columns", isUnifiedMode && "is-unified", isScrollable && "is-scrollable")}>
                <div className="route-map-column route-map-model-column">
                  <div className="route-map-column-label">{isUnifiedMode ? (language === "zh" ? "模型" : "Models") : (language === "zh" ? "服务商模型" : "Provider models")}</div>
                  <div className="route-map-model-rail">
                    {preview.models.length ? <div className="route-map-model-stack">
                      {preview.models.map((model) => {
                        const primaryRoute = model.routes[0];
                        const nodeKey = `model:${model.exposedModelId}`;
                        return <article ref={(node) => { modelRefs.current[model.exposedModelId] = node; }} key={model.exposedModelId} className={cn("route-map-model-node", isUnifiedMode ? "is-unified" : "is-account", selectedNodeKey === nodeKey && "is-selected", highlightedNodeKeys.has(nodeKey) && selectedNodeKey !== nodeKey && "is-active-downstream", selectedNodeKey && !highlightedNodeKeys.has(nodeKey) && "is-dimmed")} role="button" tabIndex={0} aria-pressed={selectedNodeKey === nodeKey} aria-label={language === "zh" ? `选择模型 ${model.displayName}` : `Select model ${model.displayName}`} onClick={() => setSelectedNodeKey((current) => current === nodeKey ? undefined : nodeKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedNodeKey((current) => current === nodeKey ? undefined : nodeKey); } }}>
                          <ProviderIcon providerId={primaryRoute?.providerId} displayName={primaryRoute?.providerDisplayName} size={18} className="route-map-model-provider-icon" />
                          <div className="route-map-model-name truncate">{model.displayName}</div>
                        </article>;
                      })}
                    </div> : <div className="route-map-empty-node">{language === "zh" ? "暂无已编译模型路由" : "No compiled model routes"}</div>}
                  </div>
                </div>
                {isUnifiedMode ? <div className="route-map-column route-map-provider-column">
                  <div className="route-map-column-label">{language === "zh" ? "支持的服务商" : "Providers"}</div>
                  <div className="route-map-provider-stack">
                    {providerNodes.length ? providerNodes.map((provider) => {
                      const nodeKey = `provider:${provider.providerId}`;
                      return <article ref={(node) => { providerRefs.current[provider.providerId] = node; }} key={provider.providerId} className={cn("route-map-provider-node", selectedNodeKey === nodeKey && "is-selected", highlightedNodeKeys.has(nodeKey) && selectedNodeKey !== nodeKey && "is-active-downstream", selectedNodeKey && !highlightedNodeKeys.has(nodeKey) && "is-dimmed")} role="button" tabIndex={0} aria-pressed={selectedNodeKey === nodeKey} aria-label={language === "zh" ? `选择服务商 ${provider.displayName}` : `Select provider ${provider.displayName}`} onClick={() => setSelectedNodeKey((current) => current === nodeKey ? undefined : nodeKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedNodeKey((current) => current === nodeKey ? undefined : nodeKey); } }}>
                        <ProviderIcon providerId={provider.providerId} displayName={provider.displayName} size={18} />
                        <span className="route-map-provider-name truncate">{provider.displayName}</span>
                      </article>;
                    }) : <div className="route-map-empty-node">{language === "zh" ? "暂无服务商路由" : "No providers"}</div>}
                  </div>
                </div> : null}
              </div>
            </section>
          </div>
          <div className="route-map-summary mt-4"><span>{language === "zh" ? `${preview.models.length} 个模型` : `${preview.models.length} models`}</span><span>{language === "zh" ? `${providerCount} 个服务商` : `${providerCount} providers`}</span><span>{language === "zh" ? `${healthyCount}/${routeCount} 条路由可用` : `${healthyCount}/${routeCount} routes ready`}</span><span>{language === "zh" ? "会话保持 · 故障切换" : "Session affinity · failover"}</span></div>
        </div>
      </div>
    </div>
  );
}

function EnvCard({
  env,
  language,
  accountCount,
  busy,
  onEdit,
  onConfig,
  onHistory,
  onSyncHistory,
  onRepairConversation,
  onDelete,
  routeStatus,
  remoteStatus,
  canRoute,
  onToggleGateway,
  onToggleLocalAgentAccess,
  onLaunchCli,
  onLaunchApp,
  onCopyLocalAgentValue,
  poolStatus,
  onOpenPool,
  routePreview,
  onSetModelIdentityMode,
  onOpenRemote,
}: {
  env: EnvSummary;
  language: UiLanguage;
  accountCount: number;
  busy: boolean;
  onEdit: () => void;
  onConfig: () => void;
  onHistory: () => void;
  onSyncHistory: () => void;
  onRepairConversation: () => void;
  onDelete: () => void;
  routeStatus?: EnvironmentRouteStatus;
  remoteStatus?: EnvironmentRemoteStatus;
  canRoute: boolean;
  onToggleGateway: () => void;
  onToggleLocalAgentAccess: () => void;
  onLaunchCli: () => void;
  onLaunchApp: () => void;
  onCopyLocalAgentValue: (value: string, label: string) => void;
  poolStatus?: AccountPoolStatus;
  onOpenPool: () => void;
  routePreview?: EnvironmentRoutePreview;
  onSetModelIdentityMode: (mode: EnvironmentModelIdentityMode) => void;
  onOpenRemote: () => void;
}) {
  const runtime = getRouteRuntimeSummary(routeStatus, language);
  const isGatewayEnabled = Boolean(routeStatus?.gatewayEnabled);
  const gatewayIsRunning = isGatewayEnabled && runtime.tone === "success";
  const gatewayNeedsAttention = isGatewayEnabled && runtime.tone === "warn";
  const currentTargetBadges = [
    env.isCurrentCli ? "CLI" : null,
    env.isCurrentApp ? "App" : null,
  ].filter((value): value is string => Boolean(value));
  // The card summarizes whether this environment has a remote account bound.
  // Pairing and sign-in details stay in the remote side panel where they can be
  // acted on, so the card only needs the two stable states users scan for.
  const remoteBound = Boolean(remoteStatus?.remoteAccountName);
  const remoteLabel = remoteBound
    ? language === "zh" ? "已绑定" : language === "ja" ? "バインド済み" : "Bound"
    : language === "zh" ? "待绑定" : language === "ja" ? "未バインド" : "Not bound";
  const remoteTone = remoteBound ? "success" : "warn";

  return (
    <ListCard className="environment-card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-neutral-950">{env.name}</h3>
            {currentTargetBadges.map((target) => <SoftBadge key={target} tone="brand" label={target} className="h-5 px-2 text-[11px]" />)}
            <SoftBadge
              tone={isGatewayEnabled ? "brand" : "neutral"}
              label={language === "zh" ? (isGatewayEnabled ? "网关模式" : "手动模式") : language === "ja" ? (isGatewayEnabled ? "ゲートウェイモード" : "手動モード") : (isGatewayEnabled ? "Gateway mode" : "Manual mode")}
              className="h-5 px-2 text-[11px]"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-medium",
              runtime.tone === "success" && "bg-primary/10 text-primary",
              runtime.tone === "warn" && "bg-warm-50 text-warm-600",
              runtime.tone === "neutral" && "bg-accent text-muted-foreground",
            )}>
              <span className={cn("size-1.5 rounded-lg", runtime.tone === "success" ? "bg-primary/100" : runtime.tone === "warn" ? "bg-warm-500" : "bg-slate-300")} />
              {runtime.label}
            </span>
            <span className="text-muted-foreground">{language === "zh" ? `${accountCount} 个账号` : language === "ja" ? `${accountCount} アカウント` : `${accountCount} accounts`}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="mr-1 text-muted-foreground">{language === "zh" ? "模型标识" : language === "ja" ? "モデル識別" : "Model identity"}</span>
            {(["account", "unified"] as const).map((mode) => <button key={mode} type="button" className={cn("rounded-md px-2 py-1 font-medium transition-colors", env.modelIdentityMode === mode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-black/[0.04] hover:text-neutral-800")} onClick={() => onSetModelIdentityMode(mode)} disabled={busy} aria-pressed={env.modelIdentityMode === mode}>{mode === "account" ? (language === "zh" ? "按服务商区分" : "By provider") : (language === "zh" ? "统一自动路由" : "Unified routing")}</button>)}
          </div>
          {runtime.detail ? <div className="mt-1 font-mono text-[12px] text-muted-foreground">{runtime.detail}</div> : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-[#fbfbfc] px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.035]"
              onClick={onOpenRemote}
              disabled={busy}
            >
              <span className="text-[11px] text-muted-foreground">{language === "zh" ? "手机远程" : language === "ja" ? "スマホ遠隔" : "Phone remote"}</span>
              <SoftBadge tone={remoteTone} label={remoteLabel} className="h-5 px-1.5 text-[10px]" />
            </button>
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-[#fbfbfc] px-3 py-2">
              <span className="text-[11px] text-muted-foreground">{language === "zh" ? "模型服务" : language === "ja" ? "モデルサービス" : "Model service"}</span>
              <span className="truncate text-[11px] font-medium text-neutral-700" title={remoteStatus?.modelServiceLabel}>{remoteStatus?.modelServiceLabel ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="environment-card-actions flex flex-wrap items-center gap-2 xl:justify-end">
          <>
            <Button size="sm" variant="outline" onClick={onLaunchCli} disabled={busy || !canRoute || (isGatewayEnabled && !gatewayIsRunning)}>
              <TerminalSquare className="size-4" />
              {language === "zh" ? "启动 CLI" : language === "ja" ? "CLI を起動" : "Launch CLI"}
            </Button>
            <Button size="sm" variant="outline" onClick={onLaunchApp} disabled={busy || !canRoute || (isGatewayEnabled && !gatewayIsRunning)}>
              <Monitor className="size-4" />
              {language === "zh" ? "启动 App" : language === "ja" ? "App を起動" : "Launch App"}
            </Button>
          </>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              gatewayIsRunning && "border-primary/30 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/20 hover:text-primary",
              gatewayNeedsAttention && "border-warm-200 bg-warm-50 text-warm-600 hover:border-warm-300 hover:bg-warm-100",
            )}
            onClick={onToggleGateway}
            disabled={busy || (!canRoute && !isGatewayEnabled)}
            aria-pressed={isGatewayEnabled}
          >
            <Network className="size-4" />
            {language === "zh" ? (isGatewayEnabled ? "关闭网关" : "开启网关") : language === "ja" ? (isGatewayEnabled ? "ゲートウェイを停止" : "ゲートウェイを有効化") : (isGatewayEnabled ? "Disable gateway" : "Enable gateway")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              routeStatus?.localAgentAccessEnabled && "border-primary/30 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/20 hover:text-primary",
            )}
            onClick={onToggleLocalAgentAccess}
            disabled={busy || !isGatewayEnabled}
            aria-pressed={Boolean(routeStatus?.localAgentAccessEnabled)}
            title={language === "zh" ? "允许本机工具通过此环境网关访问" : language === "ja" ? "この環境ゲートウェイへのローカルツール接続を許可" : "Allow local tools to use this environment gateway"}
          >
            <RadioTower className="size-4" />
            {language === "zh" ? (routeStatus?.localAgentAccessEnabled ? "本地调用已开启" : "开启本地调用") : language === "ja" ? (routeStatus?.localAgentAccessEnabled ? "ローカル呼び出し有効" : "ローカル呼び出し") : (routeStatus?.localAgentAccessEnabled ? "Local calls on" : "Local calls")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn(poolStatus?.enabled && "border-primary/30 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/20 hover:text-primary")}
            onClick={onOpenPool}
            disabled={busy || !canRoute}
            aria-pressed={Boolean(poolStatus?.enabled)}
          >
            <Shuffle className="size-4" />
            {poolStatus?.enabled
              ? language === "zh"
                ? `账号池 · ${poolStatus.readyMembers}/${poolStatus.members.length}`
                : language === "ja"
                  ? `アカウントプール · ${poolStatus.readyMembers}/${poolStatus.members.length}`
                  : `Account pool · ${poolStatus.readyMembers}/${poolStatus.members.length}`
              : language === "zh" ? "账号池" : language === "ja" ? "アカウントプール" : "Account pool"}
          </Button>
          <EnvironmentActionMenu language={language} busy={busy} onEdit={onEdit} onConfig={onConfig} onHistory={onHistory} onSyncHistory={onSyncHistory} onRepairConversation={onRepairConversation} onDelete={onDelete} />
        </div>
      </div>

      <div className="grid gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07] sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{language === "zh" ? "环境路径" : language === "ja" ? "環境パス" : "Environment path"}</div>
          <div className="mt-1 truncate font-mono text-[12px] text-muted-foreground" title={env.path}>{env.path}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{language === "zh" ? "本地网关" : language === "ja" ? "ローカルゲートウェイ" : "Local gateway"}</div>
          <div className={cn("mt-1 truncate font-mono text-[12px]", routeStatus?.localGatewayBaseUrl ? "text-muted-foreground" : "text-muted-foreground")} title={routeStatus?.localGatewayBaseUrl ?? undefined}>
            {routeStatus?.localGatewayBaseUrl ?? (isGatewayEnabled ? (language === "zh" ? "等待服务启动" : language === "ja" ? "サービスの起動を待機中" : "Waiting for service") : (language === "zh" ? "未启用" : language === "ja" ? "未有効" : "Not enabled"))}
          </div>
        </div>
      </div>
      {routeStatus?.localAgentAccessEnabled ? (
        <div className="rounded-xl border border-primary/15 bg-primary/[0.035] px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-neutral-800">{language === "zh" ? "本地调用入口" : language === "ja" ? "ローカル呼び出し入口" : "Local call entry"}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{language === "zh" ? `127.0.0.1:${routeStatus.port ?? "—"}，仅本机可访问，不对局域网或公网开放` : language === "ja" ? `127.0.0.1:${routeStatus.port ?? "—"} のみで待受けます` : `127.0.0.1:${routeStatus.port ?? "—"} · loopback only`}</div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {(["Responses", "Chat Completions", "Anthropic", "Gemini"] as const).map((protocol) => <SoftBadge key={protocol} tone="neutral" label={protocol} className="h-5 px-1.5 text-[10px]" />)}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {([
              [language === "zh" ? "Base URL" : "Base URL", routeStatus.localAgentBaseUrl],
              [language === "zh" ? "Models" : "Models", routeStatus.localAgentModelsUrl],
              [language === "zh" ? "API Key" : "API Key", routeStatus.localAgentAccessToken],
            ] as const).map(([label, value]) => value ? (
              <div key={label} className="min-w-0 rounded-lg border border-black/[0.05] bg-white/70 px-2.5 py-2 dark:border-white/[0.07] dark:bg-white/[0.03]">
                <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-700" title={value}>{label === "API Key" ? `${value.slice(0, 4)}••••${value.slice(-4)}` : value}</div>
                  <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-black/[0.05] hover:text-neutral-800" onClick={() => onCopyLocalAgentValue(value, label)} aria-label={`${label} copy`}>
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null)}
          </div>
        </div>
      ) : null}
      <RoutePreviewPanel preview={routePreview} language={language} />
    </ListCard>
  );
}

export function EnvironmentsPage({
  overview,
  language,
  busy,
  envDraft,
  envSourceDraft,
  envDeleteDraft,
  onEnvDraftChange,
  onEnvSourceDraftChange,
  onEnvDeleteDraftChange,
  onCreateEnv,
  onUpdateEnv,
  onReadEnvFiles,
  onUpdateEnvFiles,
  onListEnvFileHistory,
  onRestoreEnvFileHistory,
  onDeleteEnvFileHistory,
  onSyncEnvironmentConversationHistory,
  onInspectCodexConversation,
  onRepairCodexConversation,
  onImportDefaultEnv,
  onDeleteEnv,
  routeStatuses,
  remoteStatuses,
  routePreviews,
  onToggleGateway,
  onSetModelIdentityMode,
  onToggleLocalAgentAccess,
  onSetRemoteAccount,
  onLaunchEnvironment,
  onCopyLocalAgentValue,
  accountPools,
  onSaveAccountPool,
}: {
  overview: OverviewPayload;
  language: UiLanguage;
  busy: boolean;
  envDraft: string;
  envSourceDraft: string;
  envDeleteDraft: string;
  onEnvDraftChange: (value: string) => void;
  onEnvSourceDraftChange: (value: string) => void;
  onEnvDeleteDraftChange: (value: string) => void;
  onCreateEnv: () => Promise<boolean>;
  onUpdateEnv: (envName: string, nextEnvName: string, homePath: string) => Promise<boolean>;
  onReadEnvFiles: (envName: string) => Promise<DesktopEnvEditableFiles | null>;
  onUpdateEnvFiles: (envName: string, files: DesktopEnvEditableFiles) => Promise<boolean>;
  onListEnvFileHistory: (envName: string) => Promise<DesktopEnvFileHistoryEntry[]>;
  onRestoreEnvFileHistory: (envName: string, entryId: string) => Promise<boolean>;
  onDeleteEnvFileHistory: (envName: string, entryIds: string[]) => Promise<boolean>;
  onSyncEnvironmentConversationHistory: (envName: string) => Promise<CodexHistorySyncResult>;
  onInspectCodexConversation: (conversationId: string) => Promise<CodexConversationInspectionResult>;
  onRepairCodexConversation: (input: { conversationId: string; envName?: string; targetProviderId?: string }) => Promise<CodexConversationRepairResult>;
  onImportDefaultEnv: (envName: string) => void;
  onDeleteEnv: () => void;
  routeStatuses: EnvironmentRouteStatus[];
  remoteStatuses: EnvironmentRemoteStatus[];
  routePreviews: EnvironmentRoutePreview[];
  onToggleGateway: (envName: string, enabled: boolean) => Promise<void>;
  onSetModelIdentityMode: (envName: string, mode: EnvironmentModelIdentityMode) => Promise<void>;
  onToggleLocalAgentAccess: (envName: string, enabled: boolean) => Promise<void>;
  onSetRemoteAccount: (envName: string, accountName?: string) => Promise<void>;
  onLaunchEnvironment: (target: "cli" | "app", envName: string, accountName?: string) => void;
  onCopyLocalAgentValue: (value: string, label: string) => void;
  accountPools: AccountPoolStatus[];
  onSaveAccountPool: (input: AccountPoolInput) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEnvName, setEditEnvName] = useState("");
  const [editNextEnvName, setEditNextEnvName] = useState("");
  const [editHomePath, setEditHomePath] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [configEnvName, setConfigEnvName] = useState("");
  const [configContent, setConfigContent] = useState("");
  const [authContent, setAuthContent] = useState("");
  const [configTab, setConfigTab] = useState<"config.toml" | "auth.json">("config.toml");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEnvName, setHistoryEnvName] = useState("");
  const [historyEntries, setHistoryEntries] = useState<DesktopEnvFileHistoryEntry[]>([]);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "config.toml" | "auth.json">("all");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);
  const [syncHistoryEnvName, setSyncHistoryEnvName] = useState("");
  const [syncHistoryDialog, setSyncHistoryDialog] = useState<SyncHistoryDialogState | null>(null);
  const [conversationRepairOpen, setConversationRepairOpen] = useState(false);
  const [conversationRepairId, setConversationRepairId] = useState("");
  const [conversationRepairEnvName, setConversationRepairEnvName] = useState("");
  const [conversationRepairDialog, setConversationRepairDialog] = useState<ConversationRepairDialogState | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolEnvName, setPoolEnvName] = useState("");
  const [poolProtocol, setPoolProtocol] = useState<"responses" | "chat_completions">("responses");
  const [poolMembers, setPoolMembers] = useState<string[]>([]);
  const [poolWeights, setPoolWeights] = useState<Record<string, number>>({});
  const [poolTtl, setPoolTtl] = useState("1440");
  const [poolSameAccountFailures, setPoolSameAccountFailures] = useState("1");
  const [poolFailover, setPoolFailover] = useState("1");
  const [launchTarget, setLaunchTarget] = useState<"cli" | "app">();
  const [launchEnvName, setLaunchEnvName] = useState("");
  const [remotePanelEnv, setRemotePanelEnv] = useState<string>();
  const pageCopy = getDesktopCopy(language);
  const text = getTranslations(language);

  useEffect(() => {
    if (!syncHistoryDialog || syncHistoryDialog.phase !== "running") return;
    const timer = window.setInterval(() => {
      setSyncHistoryDialog((current) => {
        if (!current || current.phase !== "running") return current;
        return { ...current, step: Math.min(current.step + 1, syncHistorySteps.length - 1) };
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [syncHistoryDialog?.phase]);

  const accountCountByEnv = useMemo(() => {
    const map = new Map<string, number>();
    for (const account of overview.accounts) {
      map.set(account.envName, (map.get(account.envName) ?? 0) + 1);
    }
    return map;
  }, [overview.accounts]);

  const filteredEnvs = useMemo(() => {
    return overview.envs.filter((env) => {
      return (
        !search.trim() ||
        env.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        env.path.toLowerCase().includes(search.trim().toLowerCase())
      );
    });
  }, [overview.envs, search]);

  const visibleHistoryEntries = useMemo(() => {
    return historyEntries.filter((entry) => historyFilter === "all" || entry.fileType === historyFilter);
  }, [historyEntries, historyFilter]);
  const historyGroups = useMemo(() => buildHistorySnapshotGroups(visibleHistoryEntries), [visibleHistoryEntries]);

  const selectedDeleteEnv = overview.envs.find((env) => env.name === envDeleteDraft.trim()) ?? null;
  const selectedDeleteAccounts = selectedDeleteEnv ? accountCountByEnv.get(selectedDeleteEnv.name) ?? 0 : 0;
  const poolEnvAccounts = overview.accounts.filter((account) => account.envName === poolEnvName
    && (poolProtocol === "responses"
      ? account.authMode === "auth" || !account.runtime.apiProtocol || account.runtime.apiProtocol === "responses"
      : account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"));
  const poolStatus = accountPools.find((pool) => pool.envName === poolEnvName);
  const launchCandidates = overview.accounts.filter((account) => account.envName === launchEnvName);
  const remotePanelStatus = remoteStatuses.find((item) => item.envName === remotePanelEnv);
  const remoteCandidates = overview.accounts.filter((account) => account.envName === remotePanelEnv && account.authMode === "auth");
  const repairInspection = conversationRepairDialog?.inspection;
  const selectedRepairCandidate = repairInspection?.candidates.find((candidate) => candidate.envName === conversationRepairEnvName)
    ?? (repairInspection?.candidates.length === 1 ? repairInspection.candidates[0] : undefined);

  function openConversationRepair(envName = "") {
    setConversationRepairId("");
    setConversationRepairEnvName(envName);
    setConversationRepairDialog(null);
    setConversationRepairOpen(true);
  }

  async function inspectConversation() {
    const conversationId = conversationRepairId.trim();
    if (!conversationId) return;
    setConversationRepairDialog({
      phase: "analyzing",
      conversationId,
      preferredEnvName: conversationRepairEnvName || undefined,
    });
    try {
      const inspection = await onInspectCodexConversation(conversationId);
      const preferred = conversationRepairEnvName && inspection.candidates.some((candidate) => candidate.envName === conversationRepairEnvName)
        ? conversationRepairEnvName
        : inspection.candidates.length === 1 ? inspection.candidates[0]?.envName : undefined;
      setConversationRepairEnvName(preferred ?? "");
      setConversationRepairDialog({
        phase: "ready",
        conversationId,
        preferredEnvName: preferred,
        inspection,
      });
    } catch (error) {
      setConversationRepairDialog({
        phase: "error",
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function repairConversation() {
    const dialog = conversationRepairDialog;
    const envName = conversationRepairEnvName.trim() || undefined;
    if (!dialog || dialog.phase !== "ready" || !envName) return;
    setConversationRepairDialog({ ...dialog, phase: "repairing", preferredEnvName: envName });
    try {
      const result = await onRepairCodexConversation({ conversationId: dialog.conversationId, envName });
      setConversationRepairDialog({ ...dialog, phase: "success", preferredEnvName: envName, result });
    } catch (error) {
      setConversationRepairDialog({
        ...dialog,
        phase: "error",
        preferredEnvName: envName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function openPoolEditor(envName: string) {
    const current = accountPools.find((pool) => pool.envName === envName);
    const available = overview.accounts.filter((account) => account.envName === envName
      && (current?.protocol === "chat_completions"
        ? account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"
        : account.authMode === "auth" || !account.runtime.apiProtocol || account.runtime.apiProtocol === "responses"));
    setPoolEnvName(envName);
    setPoolProtocol(current?.protocol ?? "responses");
    setPoolMembers(current?.members.filter((member) => member.enabled).map((member) => member.accountName) ?? available.map((account) => account.name));
    setPoolWeights(Object.fromEntries((current?.members ?? available.map((account, index) => ({ accountName: account.name, weight: 1, priority: index, enabled: true }))).map((member) => [member.accountName, member.weight])));
    setPoolTtl(String(current?.sessionTtlMinutes ?? 1440));
    setPoolSameAccountFailures(String(current?.maxSameAccountFailures ?? 1));
    setPoolFailover(String(current?.maxFailoverAttempts ?? 1));
    setPoolOpen(true);
  }

  function openEnvironmentLauncher(target: "cli" | "app", envName: string) {
    const routeStatus = routeStatuses.find((item) => item.envName === envName);
    if (routeStatus?.gatewayEnabled) {
      onLaunchEnvironment(target, envName);
      return;
    }
    setLaunchTarget(target);
    setLaunchEnvName(envName);
  }

  return (
    <ListPageFrame className="overflow-hidden" contentClassName="h-full gap-3">
      <div className="shrink-0 flex flex-col gap-4">
        <div><h2 className="text-[24px] font-semibold tracking-[-0.04em] text-neutral-950">{pageTitle(language)}</h2><p className="mt-1 text-[13px] leading-6 text-muted-foreground">{pageSubtitle(language)}</p></div>
        <div className="rounded-[14px] border border-black/[0.05] bg-white px-3 py-2.5">
          <div className="responsive-toolbar flex items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={pageCopy.environments.searchPlaceholder} className="h-8 rounded-lg border-transparent bg-[#fbfbfc] pl-10 text-[13px] shadow-none" /></div>
            <Button
              variant="outline"
              className="h-8 rounded-lg px-3.5 text-[13px] shadow-none"
              onClick={() => openConversationRepair()}
              disabled={busy}
            >
              <Wrench className="size-4" />
              {language === "zh" ? "修复指定会话" : language === "ja" ? "指定会話を修復" : "Repair conversation"}
            </Button>
            <Button
              className="ml-auto h-8 rounded-lg bg-neutral-950 px-3.5 text-[13px] shadow-none"
              onClick={() => setDrawerOpen(true)}
              disabled={busy}
            >
              <FolderPlus className="size-4" />
              {pageCopy.environments.create}
            </Button>
          </div>
        </div>
      </div>

      <ListStack>
          {filteredEnvs.length === 0 ? (
            <EmptyList title={overview.envs.length === 0 ? pageCopy.environments.emptyListTitle : pageCopy.environments.emptyFilterTitle} />
          ) : null}
          {filteredEnvs.map((env) => (
            <EnvCard
              key={env.name}
              env={env}
              language={language}
              accountCount={accountCountByEnv.get(env.name) ?? 0}
              busy={busy}
              routeStatus={routeStatuses.find((item) => item.envName === env.name)}
              remoteStatus={remoteStatuses.find((item) => item.envName === env.name)}
              routePreview={routePreviews.find((item) => item.envName === env.name)}
              poolStatus={accountPools.find((item) => item.envName === env.name)}
                  canRoute={overview.accounts.some((account) => account.envName === env.name)}
              onToggleGateway={() => {
                const status = routeStatuses.find((item) => item.envName === env.name);
                void onToggleGateway(env.name, !status?.gatewayEnabled);
              }}
              onSetModelIdentityMode={(mode) => { void onSetModelIdentityMode(env.name, mode); }}
              onToggleLocalAgentAccess={() => {
                const status = routeStatuses.find((item) => item.envName === env.name);
                void onToggleLocalAgentAccess(env.name, !status?.localAgentAccessEnabled);
              }}
              onOpenRemote={() => setRemotePanelEnv(env.name)}
              onLaunchCli={() => openEnvironmentLauncher("cli", env.name)}
              onLaunchApp={() => openEnvironmentLauncher("app", env.name)}
              onCopyLocalAgentValue={onCopyLocalAgentValue}
              onOpenPool={() => openPoolEditor(env.name)}
              onEdit={() => {
                setEditEnvName(env.name);
                setEditNextEnvName(env.name);
                setEditHomePath(env.path);
                setEditOpen(true);
              }}
              onConfig={async () => {
                const files = await onReadEnvFiles(env.name);
                if (files === null) return;
                setConfigEnvName(env.name);
                setConfigContent(files.configToml);
                setAuthContent(files.authJson);
                setConfigTab("config.toml");
                setConfigOpen(true);
              }}
              onHistory={async () => {
                setHistoryEnvName(env.name);
                setHistorySelection([]);
                setHistoryFilter("all");
                setHistoryEntries(await onListEnvFileHistory(env.name));
                setHistoryOpen(true);
              }}
              onSyncHistory={() => {
                setSyncHistoryEnvName(env.name);
                setSyncHistoryOpen(true);
              }}
              onRepairConversation={() => openConversationRepair(env.name)}
              onDelete={() => {
                onEnvDeleteDraftChange(env.name);
                setDeleteOpen(true);
              }}
            />
          ))}
      </ListStack>

      <SidePanel
        open={Boolean(launchTarget)}
        title={launchTarget === "app" ? (language === "zh" ? "启动 App" : language === "ja" ? "App を起動" : "Launch App") : (language === "zh" ? "启动 CLI" : language === "ja" ? "CLI を起動" : "Launch CLI")}
        onClose={() => setLaunchTarget(undefined)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-2">
          {launchCandidates.map((account) => (
            <button
              key={account.name}
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-black/[0.06] bg-white px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.035]"
              onClick={() => {
                if (!launchTarget) return;
                onLaunchEnvironment(launchTarget, launchEnvName, account.name);
                setLaunchTarget(undefined);
              }}
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{account.name}</span>
              <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">{account.authMode === "apikey" ? "API KEY" : account.authMode.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </SidePanel>

      <SidePanel
        open={Boolean(remotePanelEnv)}
        title={remotePanelEnv ? `${remotePanelEnv} · ${language === "zh" ? "手机远程" : language === "ja" ? "スマホ遠隔" : "Phone remote"}` : ""}
        onClose={() => setRemotePanelEnv(undefined)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-[#f7f8fa] px-3.5 py-3">
            <span className="text-[12px] text-muted-foreground">{language === "zh" ? "当前模型服务" : language === "ja" ? "現在のモデルサービス" : "Current model service"}</span>
            <span className="text-[12px] font-semibold text-neutral-800">{remotePanelStatus?.modelServiceLabel ?? "—"}</span>
          </div>
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-neutral-900">{language === "zh" ? "官方账号" : language === "ja" ? "公式アカウント" : "Official account"}</div>
            {remoteCandidates.length ? remoteCandidates.map((account) => {
              const selected = remotePanelStatus?.remoteAccountName === account.name;
              return (
                <button
                  key={account.name}
                  type="button"
                  className={cn("flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-colors", selected ? "border-primary/35 bg-primary/[0.06]" : "border-black/[0.06] bg-white hover:border-primary/30 hover:bg-primary/[0.035]")}
                  onClick={async () => {
                    if (!remotePanelEnv) return;
                    try {
                      await onSetRemoteAccount(remotePanelEnv, account.name);
                      setRemotePanelEnv(undefined);
                    } catch {
                      // The page-level handler already surfaces the error.
                    }
                  }}
                  disabled={busy}
                >
                  <span className="min-w-0 truncate text-[13px] font-medium text-neutral-800">{account.name}</span>
                  {selected ? <SoftBadge tone="success" label={language === "zh" ? "已选" : language === "ja" ? "選択中" : "Selected"} /> : null}
                </button>
              );
            }) : <div className="rounded-lg bg-[#f7f8fa] px-3.5 py-4 text-[12px] text-muted-foreground">{language === "zh" ? "暂无已登录的官方账号" : language === "ja" ? "ログイン済みの公式アカウントはありません" : "No signed-in official account"}</div>}
          </div>
          {remotePanelStatus?.status === "needs_pairing" ? (
            <div className="rounded-lg bg-[#f7f8fa] px-3.5 py-3 text-[12px] leading-5 text-muted-foreground">
              {language === "zh"
                ? "请在 ChatGPT 桌面端“设置 → 连接”中完成手机配对"
                : language === "ja"
                  ? "ChatGPT デスクトップの「設定 → 接続」でスマホをペアリングしてください"
                  : "Finish pairing in ChatGPT desktop: Settings → Connections"}
            </div>
          ) : null}
          {remotePanelStatus?.remoteAccountName ? (
            <Button variant="outline" className="w-full" onClick={async () => {
              if (!remotePanelEnv) return;
              try {
                await onSetRemoteAccount(remotePanelEnv);
                setRemotePanelEnv(undefined);
              } catch {
                // The page-level handler already surfaces the error.
              }
            }} disabled={busy}>
              {language === "zh" ? "取消绑定" : language === "ja" ? "バインドを解除" : "Unbind"}
            </Button>
          ) : null}
        </div>
      </SidePanel>

      <SidePanel open={drawerOpen} title={pageCopy.environments.createTitle} onClose={() => setDrawerOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Input value={envDraft} onChange={(event) => onEnvDraftChange(event.target.value)} placeholder={text.inputs.newEnv} />
          </Field>
          <Field label={pageCopy.environments.source}>
            <Select
              value={envSourceDraft}
              onValueChange={onEnvSourceDraftChange}
              items={[
                { value: "default", label: text.labels.defaultValue },
                { value: "empty", label: text.labels.emptySource },
                ...overview.envs.map((env) => ({ value: env.name, label: env.name })),
              ]}
            />
          </Field>
          <Button
            className="w-full"
            onClick={async () => {
              if (await onCreateEnv()) setDrawerOpen(false);
            }}
            disabled={busy}
          >
            {pageCopy.environments.create}
          </Button>
        </div>
      </SidePanel>

      <SidePanel
        open={conversationRepairOpen}
        title={language === "zh" ? "修复指定会话" : language === "ja" ? "指定会話を修復" : "Repair conversation"}
        description={language === "zh"
          ? "输入 Codex 对话 ID，先定位环境并比较 provider/model；确认后只修改该会话的元数据。"
          : language === "ja"
            ? "Codex の会話 ID を入力し、環境と provider/model を確認してから対象会話だけを修復します。"
            : "Enter a Codex conversation ID to locate its environment and compare provider/model before changing only that conversation."}
        onClose={() => setConversationRepairOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <Field label={language === "zh" ? "对话 ID" : language === "ja" ? "会話 ID" : "Conversation ID"}>
            <Input
              value={conversationRepairId}
              onChange={(event) => {
                setConversationRepairId(event.target.value);
                if (conversationRepairDialog) setConversationRepairDialog(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && conversationRepairId.trim() && !busy) void inspectConversation();
              }}
              placeholder="UUID 或 codex://threads/<id>"
              autoFocus
              spellCheck={false}
              disabled={busy}
            />
          </Field>
          <Button className="w-full" onClick={() => void inspectConversation()} disabled={busy || !conversationRepairId.trim()}>
            {conversationRepairDialog?.phase === "analyzing" ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            {conversationRepairDialog?.phase === "analyzing"
              ? language === "zh" ? "正在分析…" : language === "ja" ? "分析中…" : "Analyzing…"
              : language === "zh" ? "分析会话" : language === "ja" ? "会話を分析" : "Analyze conversation"}
          </Button>

          {conversationRepairDialog?.phase === "analyzing" ? (
            <div className="flex items-center gap-2 rounded-lg bg-[#f7f8fa] px-3 py-3 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {language === "zh" ? "正在扫描所有 Codex 环境…" : language === "ja" ? "すべての Codex 環境をスキャン中…" : "Scanning all Codex environments…"}
            </div>
          ) : null}

          {repairInspection ? (
            <div className="space-y-3 rounded-lg border border-black/[0.06] bg-[#fbfbfc] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{language === "zh" ? "分析结果" : language === "ja" ? "分析結果" : "Inspection result"}</div>
                  <div className="mt-1 break-all font-mono text-[13px] text-neutral-800">{repairInspection.conversationId}</div>
                </div>
                <SoftBadge
                  tone={repairInspection.status === "ambiguous" ? "warn" : "neutral"}
                  label={repairInspection.status === "not-found"
                    ? language === "zh" ? "未找到" : language === "ja" ? "未検出" : "Not found"
                    : repairInspection.status === "ambiguous"
                      ? language === "zh" ? "需选择环境" : language === "ja" ? "環境を選択" : "Select environment"
                      : language === "zh" ? "已定位" : language === "ja" ? "検出済み" : "Found"}
                />
              </div>

              {repairInspection.candidates.length > 1 ? (
                <Field label={language === "zh" ? "匹配环境" : language === "ja" ? "一致した環境" : "Matching environment"}>
                  <Select
                    value={conversationRepairEnvName}
                    onValueChange={setConversationRepairEnvName}
                    items={repairInspection.candidates.map((candidate) => ({ value: candidate.envName, label: candidate.envName }))}
                    placeholder={language === "zh" ? "选择环境" : language === "ja" ? "環境を選択" : "Select an environment"}
                  />
                </Field>
              ) : null}

              {selectedRepairCandidate ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-neutral-900">{selectedRepairCandidate.envName}</span>
                    <span className={cn("rounded-md px-2 py-1 text-[11px] font-semibold", conversationRepairStatusClass(selectedRepairCandidate.status))}>
                      {conversationRepairStatusLabel(selectedRepairCandidate.status, language)}
                    </span>
                  </div>
                  <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                    {[
                      [language === "zh" ? "历史 provider" : "Recorded provider", selectedRepairCandidate.recordedProvider ?? "—"],
                      [language === "zh" ? "当前 provider" : "Current provider", selectedRepairCandidate.currentProvider ?? "—"],
                      [language === "zh" ? "历史模型" : "Recorded model", selectedRepairCandidate.recordedModel ?? "—"],
                      [language === "zh" ? "当前模型" : "Current model", selectedRepairCandidate.currentModel ?? "—"],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="min-w-0 rounded-lg bg-white px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">{label}</div>
                        <div className="mt-1 truncate font-mono text-[12px] text-slate-700" title={String(value)}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[13px] leading-5 text-muted-foreground">{selectedRepairCandidate.statusMessage}</div>
                  {selectedRepairCandidate.gatewayEnabled ? (
                    <div className="rounded-lg bg-sky-50 px-3 py-2 text-[12px] leading-5 text-sky-700">
                      {language === "zh" ? "该环境当前启用了网关模式。" : language === "ja" ? "この環境ではゲートウェイモードが有効です。" : "Gateway mode is enabled for this environment."}
                    </div>
                  ) : null}
                  <Button
                    className="w-full"
                    onClick={() => void repairConversation()}
                    disabled={busy || conversationRepairDialog.phase !== "ready" || !selectedRepairCandidate.canRepair}
                  >
                    <Wrench className="size-4" />
                    {conversationRepairDialog.phase === "repairing"
                      ? language === "zh" ? "正在修复…" : language === "ja" ? "修復中…" : "Repairing…"
                      : language === "zh" ? "确认修复此会话" : language === "ja" ? "この会話を修復" : "Confirm repair"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-[13px] leading-5 text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{repairInspection.message}</span>
                </div>
              )}
            </div>
          ) : null}

          {conversationRepairDialog?.phase === "success" && conversationRepairDialog.result ? (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/10 p-4 text-[13px] leading-5 text-primary">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" />{language === "zh" ? "指定会话修复完成" : language === "ja" ? "指定会話を修復しました" : "Conversation repaired"}</div>
              <div>{conversationRepairDialog.result.message}</div>
              <div>{language === "zh" ? "已更新文件" : "Updated files"}：{conversationRepairDialog.result.filesUpdated.length}</div>
              {conversationRepairDialog.result.backupPath ? <div className="break-all">{language === "zh" ? "备份位置" : "Backup"}：<code>{conversationRepairDialog.result.backupPath}</code></div> : null}
            </div>
          ) : null}

          {conversationRepairDialog?.phase === "error" ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-[13px] leading-5 text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{conversationRepairDialog.error}</span>
            </div>
          ) : null}
        </div>
      </SidePanel>

      <SidePanel open={poolOpen} title={language === "zh" ? `${poolEnvName} · 凭证池` : `${poolEnvName} · Credential pool`} onClose={() => setPoolOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <div className="rounded-lg bg-[#f7f8fa] px-4 py-3 text-xs leading-5 text-muted-foreground">
            {language === "zh" ? "新会话按权重选择账号，同一会话优先保持原账号；只有限流、额度或网络失败才会自动切换。Responses 模式支持 AUTH 与 API Key 混合自动分发。" : "New sessions use weighted selection and stay on one account; failover is limited to rate, quota, and network failures. Responses pools can mix AUTH and API-key accounts."}
          </div>
          {poolStatus?.health.length ? <div className="grid gap-2 sm:grid-cols-2">
            {poolStatus.health.map((item) => <div key={item.accountName} className="flex items-center justify-between rounded-lg border border-black/[0.05] bg-white px-3 py-2 text-xs">
              <span className="truncate font-medium text-neutral-800">{item.accountName}</span>
              <SoftBadge tone={item.state === "healthy" ? "success" : item.state === "cooldown" ? "warn" : "neutral"} label={item.state === "healthy" ? (language === "zh" ? "可用" : "Healthy") : item.state === "cooldown" ? (language === "zh" ? "冷却中" : "Cooldown") : item.state} />
            </div>)}
          </div> : null}
          <Field label={language === "zh" ? "协议" : "Protocol"}>
            <Select value={poolProtocol} onValueChange={(value) => {
              const nextProtocol = value as "responses" | "chat_completions";
              setPoolProtocol(nextProtocol);
              setPoolMembers(overview.accounts.filter((account) => account.envName === poolEnvName
                && (nextProtocol === "responses"
                  ? account.authMode === "auth" || !account.runtime.apiProtocol || account.runtime.apiProtocol === "responses"
                  : account.authMode !== "auth" && account.runtime.apiProtocol === "chat_completions"))
                .map((account) => account.name));
            }} items={[{ value: "responses", label: "Responses" }, { value: "chat_completions", label: "Chat Completions" }]} />
          </Field>
          <Field label={language === "zh" ? "分发策略" : "Dispatch strategy"}>
            <div className="rounded-lg bg-[#f7f8fa] px-3 py-2 text-sm text-slate-700">{language === "zh" ? "会话粘性 + 加权轮询" : "Sticky session + weighted round robin"}</div>
          </Field>
          <Field label={language === "zh" ? "参与轮询的账号" : "Pool members"}>
            <div className="space-y-2 rounded-lg bg-[#f7f8fa] p-3">
              {poolEnvAccounts.map((account, index) => {
                const selected = poolMembers.includes(account.name);
                return <label key={account.name} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                  <input type="checkbox" checked={selected} onChange={(event) => setPoolMembers((current) => event.target.checked ? [...current, account.name] : current.filter((name) => name !== account.name))} />
                  <span className="min-w-0 flex-1 truncate">{account.name}</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={String(poolWeights[account.name] ?? 1)}
                    onChange={(event) => setPoolWeights((current) => ({ ...current, [account.name]: Number(event.target.value) || 1 }))}
                    className="h-7 w-16 text-xs"
                    disabled={!selected}
                    aria-label={`${account.name} ${language === "zh" ? "分配权重" : "distribution weight"}`}
                    title={language === "zh" ? "分配权重：数值越高，新会话分配到该账号的概率越高" : "Distribution weight: higher values receive more new sessions"}
                  />
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={language === "zh" ? "轮询顺序：权重相同时按此顺序选择账号" : "Rotation order used when weights are equal"}
                  >#{index + 1}</span>
                </label>;
              })}
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={language === "zh" ? "会话保持时长（分钟）" : "Session affinity (min)"}
              hint={language === "zh" ? "同一会话在此时间内优先使用原账号，提高缓存命中率" : "Prefer the original account during this period to improve cache hits"}
            ><Input type="number" min={5} max={10080} value={poolTtl} onChange={(event) => setPoolTtl(event.target.value)} /></Field>
            <Field
              label={language === "zh" ? "同一账号最多失败次数" : "Failures before switching"}
              hint={language === "zh" ? "单次请求内，当前账号连续失败达到此次数后才切换账号" : "Retry the current account until this many failures occur in one request"}
            ><Input type="number" min={1} max={3} value={poolSameAccountFailures} onChange={(event) => setPoolSameAccountFailures(event.target.value)} /></Field>
            <Field
              label={language === "zh" ? "单次请求最多切换账号次数" : "Maximum account switches"}
              hint={language === "zh" ? "当前账号达到失败次数后，最多再切换到几个其它账号" : "Maximum number of other accounts tried after the current account fails"}
            ><Input type="number" min={0} max={1} value={poolFailover} onChange={(event) => setPoolFailover(event.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setPoolOpen(false)}>{pageCopy.common.cancel}</Button>
            {poolStatus ? <Button variant="destructive" onClick={async () => { if (await onSaveAccountPool({ envName: poolEnvName, enabled: false, protocol: poolProtocol, members: [] })) setPoolOpen(false); }}>{language === "zh" ? "关闭凭证池" : "Disable credential pool"}</Button> : null}
            <Button onClick={async () => { if (poolMembers.length && await onSaveAccountPool({ envName: poolEnvName, enabled: true, protocol: poolProtocol, members: poolMembers.map((accountName, priority) => ({ accountName, priority, weight: poolWeights[accountName] ?? 1 })), sessionTtlMinutes: Number(poolTtl), maxSameAccountFailures: Number(poolSameAccountFailures), maxFailoverAttempts: Number(poolFailover) })) setPoolOpen(false); }} disabled={busy || poolMembers.length === 0}>{language === "zh" ? "保存凭证池" : "Save credential pool"}</Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={editOpen} title={pageCopy.environments.editTitle} onClose={() => setEditOpen(false)} closeLabel={pageCopy.common.close}>
        <div className="space-y-4">
          <Field label={pageCopy.common.environment}>
            <Input value={editNextEnvName} onChange={(event) => setEditNextEnvName(event.target.value)} disabled={editEnvName === "default"} />
          </Field>
          <Field label={pageCopy.environments.pathColumn}>
            <Input value={editHomePath} onChange={(event) => setEditHomePath(event.target.value)} placeholder={text.inputs.baseUrl} />
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button
              variant="destructive"
              onClick={() => onImportDefaultEnv(editEnvName)}
              disabled={busy || !editEnvName || editEnvName === "default"}
            >
              <ArrowDownToLine className="size-4" />
              {pageCopy.environments.importDefault}
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{pageCopy.common.cancel}</Button>
            <Button
              onClick={async () => {
                if (await onUpdateEnv(editEnvName, editNextEnvName, editHomePath)) setEditOpen(false);
              }}
              disabled={busy}
            >
              {pageCopy.environments.save}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={configOpen}
        title={language === "zh" ? "环境文件修改" : "Environment Files"}
        onClose={() => setConfigOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["config.toml", "auth.json"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={
                  configTab === tab
                    ? "ui-selected-control rounded-lg border px-3 py-1.5 text-xs font-semibold"
                    : "rounded-lg border border-transparent bg-[#f3f4f6] px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                }
                onClick={() => setConfigTab(tab)}
                aria-pressed={configTab === tab}
              >
                {tab}
              </button>
            ))}
          </div>
          <Field label={`${configEnvName} / ${configTab}`}>
            <Textarea
              value={configTab === "config.toml" ? configContent : authContent}
              onChange={(event) => {
                if (configTab === "config.toml") {
                  setConfigContent(event.target.value);
                } else {
                  setAuthContent(event.target.value);
                }
              }}
              className="min-h-[420px] font-mono text-[13px] leading-6"
              spellCheck={false}
            />
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setConfigOpen(false)}>{pageCopy.common.cancel}</Button>
            <Button
              onClick={async () => {
                if (await onUpdateEnvFiles(configEnvName, { configToml: configContent, authJson: authContent })) {
                  setConfigOpen(false);
                }
              }}
              disabled={busy}
            >
              {pageCopy.environments.save}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={historyOpen}
        title={language === "zh" ? "修改历史" : "Change History"}
        onClose={() => setHistoryOpen(false)}
        closeLabel={pageCopy.common.close}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-neutral-900">{historyEnvName}</div>
            <Select
              value={historyFilter}
              onValueChange={(value) => setHistoryFilter(value as "all" | "config.toml" | "auth.json")}
              items={[
                { value: "all", label: language === "zh" ? "全部文件" : "All files" },
                { value: "config.toml", label: "config.toml" },
                { value: "auth.json", label: "auth.json" },
              ]}
              className="h-8 w-[140px] rounded-lg bg-[#f7f8fa] text-[13px]"
            />
          </div>

          <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
            {historyGroups.length === 0 ? (
              <div className="rounded-lg bg-[#f7f8fa] px-4 py-10 text-center text-sm text-muted-foreground">
                {language === "zh" ? "暂无修改历史" : "No history yet"}
              </div>
            ) : null}
            {historyGroups.map((group) => {
              const groupIds = (["config.toml", "auth.json"] as const)
                .map((fileType) => group.files[fileType].entryId)
                .filter((value): value is string => Boolean(value));
              const selected = groupIds.length > 0 && groupIds.every((id) => historySelection.includes(id));
              return (
                <div
                  key={group.key}
                  className="rounded-lg bg-[#f7f8fa] px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        setHistorySelection((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...groupIds]))
                            : current.filter((id) => !groupIds.includes(id)),
                        );
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900">
                        <span>{formatHistoryTimestamp(group.createdAt)}</span>
                        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {localizeHistorySource(group.source, language)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {(["config.toml", "auth.json"] as const).map((fileType) => {
                          const file = group.files[fileType];
                          return (
                            <div key={fileType} className="rounded-lg bg-white px-3 py-3">
                              <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900">
                                <span>{fileType}</span>
                                <span
                                  className={
                                    file.changed
                                      ? "rounded-md bg-[#eef4ff] px-2 py-0.5 text-[11px] font-medium text-sky-700"
                                      : "rounded-md bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                                  }
                                >
                                  {file.changed
                                    ? language === "zh"
                                      ? "已变更"
                                      : "Changed"
                                    : language === "zh"
                                      ? "未变更"
                                      : "Unchanged"}
                                </span>
                              </div>
                              <div className="mt-2 max-h-[140px] overflow-auto rounded-lg bg-[#fbfbfc] px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap break-all">
                                {file.changed
                                  ? file.content || (language === "zh" ? "空文件" : "Empty file")
                                  : language === "zh"
                                    ? "该次修改中此文件未发生变化。"
                                    : "This file did not change in this snapshot."}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-lg bg-white text-muted-foreground"
                      onClick={async () => {
                        let restored = false;
                        for (const entryId of groupIds) {
                          // Restore both files that were actually recorded in this snapshot.
                          restored = (await onRestoreEnvFileHistory(historyEnvName, entryId)) || restored;
                        }
                        if (restored) {
                          setHistoryEntries(await onListEnvFileHistory(historyEnvName));
                        }
                      }}
                      aria-label={language === "zh" ? "还原" : "Restore"}
                      title={language === "zh" ? "还原" : "Restore"}
                      disabled={busy || groupIds.length === 0}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {pageCopy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (historySelection.length === 0) return;
                if (await onDeleteEnvFileHistory(historyEnvName, historySelection)) {
                  setHistoryEntries(await onListEnvFileHistory(historyEnvName));
                  setHistorySelection([]);
                }
              }}
              disabled={busy || historySelection.length === 0}
            >
              <Trash2 className="size-4" />
              {language === "zh" ? `删除所选 (${historySelection.length})` : `Delete Selected (${historySelection.length})`}
            </Button>
          </div>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={syncHistoryOpen}
        title={language === "zh" ? "同步对话列表" : language === "ja" ? "会話履歴を同期" : "Sync conversation history"}
        impact={
          <div className="space-y-2 text-sm text-neutral-500">
            <div>{language === "zh" ? `将环境 ${syncHistoryEnvName} 中旧会话的 provider 标识统一为 codex_switcher_router。` : `Normalize existing sessions in ${syncHistoryEnvName} to codex_switcher_router.`}</div>
            <div>{language === "zh" ? "只修改会话元数据和索引，不修改消息内容。执行前会自动备份；请先关闭该环境正在运行的 Codex。同步列表不保证跨服务商继续上下文。" : "Only metadata and index records change. A backup is created first; close Codex for this environment before continuing. Unified visibility does not guarantee cross-provider continuation."}</div>
          </div>
        }
        confirmLabel={language === "zh" ? "开始同步" : language === "ja" ? "同期を開始" : "Start sync"}
        cancelLabel={pageCopy.common.cancel}
        onCancel={() => setSyncHistoryOpen(false)}
        onConfirm={() => {
          const envName = syncHistoryEnvName;
          setSyncHistoryOpen(false);
          setSyncHistoryDialog({ envName, phase: "running", step: 0 });
          void (async () => {
            try {
              const result = await onSyncEnvironmentConversationHistory(envName);
              setSyncHistoryDialog({ envName, phase: "success", step: syncHistorySteps.length - 1, result });
            } catch (error) {
              setSyncHistoryDialog({
                envName,
                phase: "error",
                step: 0,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })();
        }}
      />

      {syncHistoryDialog ? (
        <ProgressDialog
          open
          phase={syncHistoryDialog.phase}
          title={syncHistoryDialog.phase === "running"
            ? language === "zh" ? "正在同步对话列表" : language === "ja" ? "会話履歴を同期中" : "Syncing conversation history"
            : syncHistoryDialog.phase === "success"
              ? language === "zh" ? "对话列表同步完成" : language === "ja" ? "会話履歴の同期が完了しました" : "Conversation history synced"
              : language === "zh" ? "对话列表同步失败" : language === "ja" ? "会話履歴の同期に失敗しました" : "Conversation history sync failed"}
          confirmLabel={language === "zh" ? "确定" : language === "ja" ? "確認" : "OK"}
          busyLabel={language === "zh" ? "正在处理…" : language === "ja" ? "処理中…" : "Working…"}
          onConfirm={() => setSyncHistoryDialog(null)}
        >
          {syncHistoryDialog.phase === "running" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm font-medium text-neutral-800">
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                <span>
                  {language === "zh"
                    ? syncHistorySteps[syncHistoryDialog.step]?.zh
                    : language === "ja"
                      ? syncHistorySteps[syncHistoryDialog.step]?.ja
                      : syncHistorySteps[syncHistoryDialog.step]?.en}
                </span>
                <span className="ml-auto shrink-0 text-[13px] font-normal text-muted-foreground">
                  {syncHistoryDialog.step + 1}/{syncHistorySteps.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-lg bg-accent" aria-label={language === "zh" ? "同步进度" : "Sync progress"}>
                <div
                  className="h-full rounded-lg bg-primary/100 transition-[width] duration-500"
                  style={{ width: `${Math.round(((syncHistoryDialog.step + 1) / syncHistorySteps.length) * 100)}%` }}
                />
              </div>
              <div className="text-[13px] leading-5 text-muted-foreground">
                {language === "zh"
                  ? `环境：${syncHistoryDialog.envName}。请稍候，完成前不要关闭应用。`
                  : language === "ja"
                    ? `環境：${syncHistoryDialog.envName}。完了するまでアプリを閉じないでください。`
                    : `Environment: ${syncHistoryDialog.envName}. Please wait until the operation finishes.`}
              </div>
            </div>
          ) : syncHistoryDialog.phase === "success" && syncHistoryDialog.result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm font-medium text-primary">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>
                  {language === "zh"
                    ? `环境 ${syncHistoryDialog.envName} 已同步 ${syncHistoryDialog.result.sessionsUpdated} 个会话、${syncHistoryDialog.result.threadsUpdated} 条索引记录。`
                    : language === "ja"
                      ? `${syncHistoryDialog.envName} の ${syncHistoryDialog.result.sessionsUpdated} 件のセッションと ${syncHistoryDialog.result.threadsUpdated} 件のインデックスを同期しました。`
                      : syncHistoryDialog.result.message}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  [language === "zh" ? "扫描会话" : language === "ja" ? "スキャンしたセッション" : "Scanned", syncHistoryDialog.result.sessionsScanned],
                  [language === "zh" ? "更新会话" : language === "ja" ? "更新したセッション" : "Sessions", syncHistoryDialog.result.sessionsUpdated],
                  [language === "zh" ? "更新索引" : language === "ja" ? "更新したスレッド" : "Threads", syncHistoryDialog.result.threadsUpdated],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-white px-3 py-2.5 text-center">
                    <div className="text-[12px] text-muted-foreground">{label}</div>
                    <div className="mt-1 text-base font-semibold text-neutral-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-[13px] leading-5 text-muted-foreground">
                <div>Provider：<code className="break-all text-slate-700">{syncHistoryDialog.result.providerId}</code></div>
                {syncHistoryDialog.result.backupPath ? (
                  <div>{language === "zh" ? "备份位置" : language === "ja" ? "バックアップ先" : "Backup"}：<code className="break-all text-slate-700">{syncHistoryDialog.result.backupPath}</code></div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm leading-6 text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{syncHistoryDialog.error || (language === "zh" ? "同步失败，请查看错误提示后重试。" : "The sync failed. Review the error and try again.")}</span>
            </div>
          )}
        </ProgressDialog>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={pageCopy.environments.deleteTitle}
        impact={
          selectedDeleteEnv ? (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.common.environment}</span>
                <span className="font-medium text-neutral-700">{selectedDeleteEnv.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-neutral-400">{pageCopy.environments.countColumn}</span>
                <span className="font-medium text-neutral-700">{selectedDeleteAccounts}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">{pageCopy.environments.deleteMissing}</div>
          )
        }
        confirmLabel={pageCopy.environments.deleteConfirm}
        cancelLabel={pageCopy.common.cancel}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onDeleteEnv();
          setDeleteOpen(false);
        }}
      />
    </ListPageFrame>
  );
}
