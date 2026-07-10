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
      ? "bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-200"
      : message?.tone === "warning"
        ? "bg-amber-50/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
        : message?.tone === "error"
          ? "bg-rose-50/80 text-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
          : "bg-sky-50/80 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200";
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
    <div className="h-screen overflow-hidden bg-[linear-gradient(180deg,#fcfcfb_0%,#f7f8fa_100%)] text-neutral-900 dark:bg-[linear-gradient(180deg,#0b0d10_0%,#12161b_100%)] dark:text-neutral-100">
      <div className="flex h-full">
        <aside
          className={cn(
            "relative flex shrink-0 flex-col bg-white/78 pb-7 pt-5 shadow-[18px_0_55px_rgba(31,41,55,0.035)] backdrop-blur-xl dark:bg-[#11151a]/88 dark:shadow-[18px_0_55px_rgba(0,0,0,0.25)]",
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
                      ? "bg-white text-neutral-950 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-[#1b2129] dark:text-white dark:shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
                      : "text-neutral-700 hover:bg-white/85 hover:text-neutral-950 hover:shadow-sm dark:text-slate-300 dark:hover:bg-[#171c23] dark:hover:text-white",
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
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,255,255,0))] dark:bg-[linear-gradient(180deg,rgba(26,31,38,0.88),rgba(11,13,16,0))]" />
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
              className="flex h-10 items-center gap-2 rounded-xl bg-white px-3.5 text-[12px] font-medium text-neutral-800 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:bg-neutral-50 dark:bg-[#161b22] dark:text-slate-100 dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)] dark:hover:bg-[#1c232c]"
            >
              <Languages className="size-4" />
              {languageOptions.find((item) => item.value === language)?.label ?? languageLabel}
            </button>
          </div>

          {message && (
            <section
              className={cn(
                "fixed right-8 top-20 z-50 min-w-[280px] max-w-[420px] rounded-xl px-4 py-3 text-sm font-medium",
                "animate-fade-in shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-sm transition-all duration-200",
                messageClass,
              )}
              role="status"
              aria-live="polite"
            >
              {message.text}
            </section>
          )}

          <main className="relative z-10 min-h-0 flex-1 overflow-hidden animate-fade-in-up">{children}</main>
        </div>
      </div>
    </div>
  );
}
