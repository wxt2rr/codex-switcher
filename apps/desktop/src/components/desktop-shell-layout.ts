function isMacDesktop(platform?: string) {
  return platform === "MacIntel";
}

export function getDesktopShellBrandClass(platform?: string) {
  return isMacDesktop(platform) ? "pl-[72px]" : "";
}

export function getDesktopShellHeaderClass(platform?: string) {
  return isMacDesktop(platform) ? "min-h-[78px]" : "";
}

export function getDesktopShellDragStripClass(platform?: string) {
  return isMacDesktop(platform) ? "h-[30px]" : "";
}

export function getDesktopShellDragRegionClass(platform?: string) {
  return isMacDesktop(platform) ? "[-webkit-app-region:drag]" : "";
}

export function getDesktopShellNoDragClass(platform?: string) {
  return isMacDesktop(platform) ? "[-webkit-app-region:no-drag]" : "";
}

export function getDesktopShellSidebarToggleClass(platform: string | undefined, expanded = true) {
  if (!isMacDesktop(platform)) {
    return "";
  }
  return expanded
    ? "absolute right-4 top-0"
    : "absolute left-1/2 top-8 -translate-x-1/2";
}

export function getDesktopShellSidebarBrandRowClass(platform?: string) {
  return isMacDesktop(platform)
    ? "mt-3 w-full justify-start"
    : "mt-8 w-full justify-between gap-3";
}
