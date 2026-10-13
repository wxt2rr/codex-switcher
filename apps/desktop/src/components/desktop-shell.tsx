import { useState, type ReactNode } from "react";
import {
  Box,
  CircleCheck,
  CircleX,
  Gauge,
  Boxes,
  Download,
  Globe2,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  PackageOpen,
  Puzzle,
  Server,
  Settings,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavView } from "../desktop-model";
import type { DesktopNotice } from "../desktop-feedback";
import {
  getDesktopShellDragRegionClass,
  getDesktopShellDragStripClass,
  getDesktopShellNoDragClass,
  getDesktopShellSidebarBrandRowClass,
  getDesktopShellSidebarToggleClass,
} from "./desktop-shell-layout";

/* ============================================================
   DESKTOP SHELL
   Top-level layout: header, navigation, language, tools menu,
   message bar, and the page content area.
   ============================================================ */

export function DesktopShell({
  brand,
  nav,
  currentView,
  onChangeView,
  children,
  message,
  noticeVisible = true,
  onNoticePauseChange,
  updatePrompt,
}: {
  brand: string;
  nav: Array<{ view: Exclude<NavView, "overview">; label: string; section?: "workspace" | "configuration" | "system" }>;
  currentView: NavView;
  onChangeView: (view: NavView) => void;
  children: ReactNode;
  message?: DesktopNotice | null;
  noticeVisible?: boolean;
  onNoticePauseChange?: (paused: boolean) => void;
  updatePrompt?: {
    version: string;
    title: string;
    description: string;
    installLabel: string;
    skipLabel: string;
    onInstall: () => void;
    onSkip: () => void;
    busy?: boolean;
  };
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const platform = globalThis.navigator?.platform;
  const dragRegionClass = getDesktopShellDragRegionClass(platform);
  const dragStripClass = getDesktopShellDragStripClass(platform);
  const noDragClass = getDesktopShellNoDragClass(platform);

  const navIcons: Record<NavView, ReactNode> = {
    overview: <Box className="size-5" />,
    environments: <Globe2 className="size-5" />,
    accounts: <TerminalSquare className="size-5" />,
    providers: <Server className="size-5" />,
    models: <Boxes className="size-5" />,
    plugins: <Puzzle className="size-5" />,
    skills: <PackageOpen className="size-5" />,
    usage: <Gauge className="size-5" />,
    operations: <Settings className="size-5" />,
  };

  /* message tone helpers */
  const messageClass =
    message?.tone === "success"
      ? "text-emerald-700 dark:text-emerald-300"
      : message?.tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : message?.tone === "error"
          ? "text-rose-700 dark:text-rose-200"
          : "text-sky-700 dark:text-sky-300";
  const messageIcon =
    message?.tone === "success" ? (
      <CircleCheck className="size-[18px] shrink-0 text-emerald-600" aria-hidden="true" />
    ) : message?.tone === "error" ? (
      <CircleX className="size-[18px] shrink-0 text-rose-600" aria-hidden="true" />
    ) : message?.tone === "warning" ? (
      <TriangleAlert className="size-[18px] shrink-0 text-amber-600" aria-hidden="true" />
    ) : (
      <Info className="size-[18px] shrink-0 text-sky-600" aria-hidden="true" />
    );
  const isMacDesktop = platform === "MacIntel";
  const sidebarToggle = (
    <button
      type="button"
      aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
      title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={sidebarExpanded}
      onClick={() => setSidebarExpanded((current) => !current)}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[var(--cs-radius-sm)] bg-transparent text-muted-foreground shadow-none transition-[background-color,color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent hover:text-foreground",
        getDesktopShellSidebarToggleClass(platform, sidebarExpanded),
        noDragClass,
      )}
    >
      {sidebarExpanded ? <PanelLeftClose className="size-[18px]" /> : <PanelLeftOpen className="size-[18px]" />}
    </button>
  );

  return (
    <TooltipProvider>
    <div className="desktop-shell-root h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full">
        <aside
          data-expanded={sidebarExpanded}
          className={cn(
            "motion-sidebar-panel relative flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-card pb-7 pt-5",
            sidebarExpanded ? "w-[208px] px-4" : "w-[78px] items-center px-3",
          )}
        >
          {dragStripClass ? (
            <div className={cn("absolute left-0 right-0 top-0", dragStripClass, dragRegionClass)} />
          ) : null}

          {isMacDesktop ? sidebarToggle : null}

          <div
            className={cn(
              "flex min-h-9 items-center",
              getDesktopShellSidebarBrandRowClass(platform),
              !sidebarExpanded && !isMacDesktop && "justify-center",
            )}
          >
            <div className="motion-sidebar-label min-w-0 overflow-hidden">
              <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground">{brand}</div>
            </div>

            {!isMacDesktop ? sidebarToggle : null}
          </div>

          <nav
            className={cn(
              "flex flex-1 flex-col gap-1.5",
              isMacDesktop ? "mt-8" : "mt-10",
              sidebarExpanded ? "w-full items-stretch" : "w-full items-center",
            )}
          >
            {nav.map(({ view: item, label, section }, index) => {
              const isActive = currentView === item;
              const previousSection = nav[index - 1]?.section;
              const showDivider = index > 0 && section && section !== previousSection;
              return (
                <div key={item} className="w-full">
                  {showDivider ? <div className={cn("my-3 h-px bg-border-subtle", !sidebarExpanded && "mx-auto w-8")} aria-hidden="true" /> : null}
                <button
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => onChangeView(item)}
                  className={cn(
                    "group relative flex h-10 items-center rounded-[var(--cs-radius-sm)] transition-[background-color,color] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                    sidebarExpanded ? "w-full justify-start gap-3 px-3.5" : "size-11 justify-center",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  aria-pressed={isActive}
                >
                  <span className={cn("absolute left-0 h-5 w-0.5 rounded-full bg-primary transition-opacity", isActive ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  <span className="flex size-5 shrink-0 items-center justify-center">{navIcons[item]}</span>
                  <span
                    className={cn(
                      "motion-sidebar-label min-w-0 truncate text-sm font-semibold",
                      sidebarExpanded ? "w-auto" : "w-0",
                    )}
                  >
                    {label}
                  </span>
                </button>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          {dragRegionClass ? (
            <>
              <div className={cn("absolute inset-x-0 top-0 z-10 h-[34px]", dragRegionClass)} />
              <div className={cn("absolute left-0 top-[34px] z-10 h-[108px] w-[420px]", dragRegionClass)} />
            </>
          ) : null}
          {message && (
            <div key={message.text} className="pointer-events-none fixed inset-x-0 top-5 z-[60] flex justify-center px-6">
              <section
                data-state={noticeVisible ? "open" : "closed"}
                onMouseEnter={() => onNoticePauseChange?.(true)}
                onMouseLeave={() => onNoticePauseChange?.(false)}
                className={cn(
                  "motion-notice-enter flex min-w-[280px] max-w-[420px] items-center gap-2.5 rounded-[var(--cs-radius-md)] border border-border-subtle bg-card px-4 py-3 text-sm font-medium shadow-md",
                  "pointer-events-auto",
                  messageClass,
                )}
                role={message.tone === "error" ? "alert" : "status"}
                aria-live={message.tone === "error" ? "assertive" : "polite"}
              >
                {messageIcon}
                <span>{message.text}</span>
              </section>
            </div>
          )}

          {updatePrompt ? (
            <section
              className="fixed bottom-5 right-5 z-[60] w-[min(360px,calc(100vw-2rem))] rounded-[var(--cs-radius-lg)] border border-primary/25 bg-card p-4 shadow-lg"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cs-radius-sm)] bg-primary/10 text-primary">
                  <Download className="size-[18px]" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[13px] font-semibold text-foreground">{updatePrompt.title}</h2>
                    <span className="shrink-0 rounded-[var(--cs-radius-xs)] bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">v{updatePrompt.version}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{updatePrompt.description}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-[var(--cs-radius-xs)] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={updatePrompt.onSkip}
                  disabled={updatePrompt.busy}
                >
                  {updatePrompt.skipLabel}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-55"
                  onClick={updatePrompt.onInstall}
                  disabled={updatePrompt.busy}
                >
                  {updatePrompt.installLabel}
                </button>
              </div>
            </section>
          ) : null}

          <main className="relative z-10 min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
