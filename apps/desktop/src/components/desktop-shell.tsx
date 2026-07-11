import { useState, type ReactNode } from "react";
import {
  Box,
  ChartNoAxesCombined,
  ClipboardList,
  Globe2,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  TerminalSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavView } from "../desktop-model";
import type { DesktopNotice } from "../desktop-feedback";
import type { UiLanguage } from "../i18n";
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
  language,
  languageLabel,
  languageOptions,
  onChangeLanguage,
  children,
  message,
}: {
  brand: string;
  nav: Array<{ view: Exclude<NavView, "overview">; label: string }>;
  currentView: NavView;
  onChangeView: (view: NavView) => void;
  language: UiLanguage;
  languageLabel: string;
  languageOptions: Array<{ value: UiLanguage; label: string }>;
  onChangeLanguage: (language: UiLanguage) => void;
  children: ReactNode;
  message?: DesktopNotice | null;
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
    usage: <ChartNoAxesCombined className="size-5" />,
    operations: <ClipboardList className="size-5" />,
  };

  /* message tone helper */
  const messageClass =
    message?.tone === "success"
      ? "text-sky-700 dark:text-sky-200"
      : message?.tone === "warning"
        ? "text-neutral-800 dark:text-neutral-200"
        : message?.tone === "error"
          ? "text-rose-700 dark:text-rose-200"
          : "text-neutral-800 dark:text-neutral-200";
  const isMacDesktop = platform === "MacIntel";
  const sidebarToggle = (
    <button
      type="button"
      aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
      title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={sidebarExpanded}
      onClick={() => setSidebarExpanded((current) => !current)}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-transparent text-neutral-500 shadow-none transition hover:bg-black/[0.045] hover:text-neutral-900 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white",
        getDesktopShellSidebarToggleClass(platform, sidebarExpanded),
        noDragClass,
      )}
    >
      {sidebarExpanded ? <PanelLeftClose className="size-[18px]" /> : <PanelLeftOpen className="size-[18px]" />}
    </button>
  );

  return (
    <div className="h-screen overflow-hidden bg-[#f7f8fa] text-neutral-900 dark:bg-[#0f1318] dark:text-neutral-100">
      <div className="flex h-full">
        <aside
          className={cn(
            "relative flex shrink-0 flex-col border-r border-black/[0.06] bg-white pb-7 pt-5 dark:border-white/[0.07] dark:bg-[#11151a]",
            "transition-[width,padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
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
            {sidebarExpanded ? (
              <div
                className="min-w-0 overflow-hidden transition-[opacity,transform] duration-200"
              >
                <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">{brand}</div>
              </div>
            ) : null}

            {!isMacDesktop ? sidebarToggle : null}
          </div>

          <nav
            className={cn(
              "flex flex-1 flex-col gap-3",
              isMacDesktop ? "mt-8" : "mt-10",
              sidebarExpanded ? "w-full items-stretch" : "w-full items-center",
            )}
          >
            {nav.map(({ view: item, label }) => {
              const isActive = currentView === item;
              return (
                <button
                  key={item}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => onChangeView(item)}
                  className={cn(
                    "flex h-11 items-center rounded-xl transition-all duration-150",
                    sidebarExpanded ? "w-full justify-start gap-3 px-3.5" : "size-11 justify-center",
                    isActive
                      ? "bg-[#f1f3f5] text-neutral-950 dark:bg-[#1b2129] dark:text-white"
                      : "text-neutral-700 hover:bg-[#f6f7f8] hover:text-neutral-950 dark:text-slate-300 dark:hover:bg-[#171c23] dark:hover:text-white",
                  )}
                >
                  {navIcons[item]}
                  <span
                    className={cn(
                      "min-w-0 truncate text-sm font-semibold transition-[opacity,transform,width] duration-200",
                      sidebarExpanded ? "w-auto translate-x-0 opacity-100" : "w-0 -translate-x-1 opacity-0",
                    )}
                  >
                    {label}
                  </span>
                </button>
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
          <div className={cn("absolute right-8 top-7 z-20 flex items-center gap-3", noDragClass)}>
            <button
              type="button"
              aria-label={languageLabel}
              title={languageLabel}
              onClick={() => {
                const currentIndex = languageOptions.findIndex((item) => item.value === language);
                const next = languageOptions[(currentIndex + 1) % languageOptions.length]?.value ?? language;
                onChangeLanguage(next);
              }}
              className="flex h-10 items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3.5 text-[12px] font-medium text-neutral-800 transition hover:bg-neutral-50 dark:border-white/[0.08] dark:bg-[#161b22] dark:text-slate-100 dark:hover:bg-[#1c232c]"
            >
              <Languages className="size-4" />
              {languageOptions.find((item) => item.value === language)?.label ?? languageLabel}
            </button>
          </div>

          {message && (
            <section
              key={message.text}
              className={cn(
                "fixed right-8 top-20 z-50 min-w-[280px] max-w-[420px] rounded-lg border border-black/[0.08] bg-white px-4 py-3 text-sm font-medium",
                "motion-notice-enter shadow-sm transition-all duration-200",
                messageClass,
              )}
              role="status"
              aria-live="polite"
            >
              {message.text}
            </section>
          )}

          <main key={currentView} className="motion-page-enter relative z-10 min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
}
