import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getDesktopShellBrandClass,
  getDesktopShellDragRegionClass,
  getDesktopShellDragStripClass,
  getDesktopShellHeaderClass,
  getDesktopShellNoDragClass,
  getDesktopShellSidebarBrandRowClass,
  getDesktopShellSidebarToggleClass,
} from "./desktop-shell-layout.js";

const shell = readFileSync(new URL("./desktop-shell.tsx", import.meta.url), "utf8");

test("desktop shell reserves leading and top space on macOS for traffic lights", () => {
  assert.equal(getDesktopShellBrandClass("MacIntel"), "pl-[72px]");
  assert.match(getDesktopShellHeaderClass("MacIntel"), /min-h-\[78px\]/);
  assert.match(getDesktopShellDragStripClass("MacIntel"), /h-\[30px\]/);
});

test("desktop shell keeps default leading spacing on non-macOS platforms", () => {
  assert.equal(getDesktopShellBrandClass("Win32"), "");
  assert.equal(getDesktopShellHeaderClass("Win32"), "");
  assert.equal(getDesktopShellDragStripClass("Win32"), "");
  assert.equal(getDesktopShellBrandClass("Linux x86_64"), "");
  assert.equal(getDesktopShellHeaderClass("Linux x86_64"), "");
  assert.equal(getDesktopShellDragStripClass("Linux x86_64"), "");
  assert.equal(getDesktopShellBrandClass(undefined), "");
  assert.equal(getDesktopShellHeaderClass(undefined), "");
  assert.equal(getDesktopShellDragStripClass(undefined), "");
});

test("desktop shell enables drag region only on macOS custom title bar", () => {
  assert.equal(getDesktopShellDragRegionClass("MacIntel"), "[-webkit-app-region:drag]");
  assert.equal(getDesktopShellNoDragClass("MacIntel"), "[-webkit-app-region:no-drag]");
  assert.equal(getDesktopShellDragRegionClass("Win32"), "");
  assert.equal(getDesktopShellNoDragClass("Win32"), "");
  assert.equal(getDesktopShellDragRegionClass(undefined), "");
  assert.equal(getDesktopShellNoDragClass(undefined), "");
});

test("desktop shell separates the macOS sidebar toggle from the lowered brand row", () => {
  assert.match(getDesktopShellSidebarToggleClass("MacIntel", true), /right-4 top-0/);
  assert.match(getDesktopShellSidebarToggleClass("MacIntel", false), /left-1\/2 top-8 -translate-x-1\/2/);
  assert.match(getDesktopShellSidebarBrandRowClass("MacIntel"), /mt-3/);
  assert.doesNotMatch(getDesktopShellSidebarToggleClass("Win32", false), /absolute/);
  assert.match(getDesktopShellSidebarBrandRowClass("Win32"), /mt-8/);
});

test("desktop shell replays restrained page motion when the view changes", () => {
  assert.match(shell, /key=\{currentView\}/);
  assert.match(shell, /motion-page-enter/);
  assert.match(shell, /motion-notice-enter/);
});
