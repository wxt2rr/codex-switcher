import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const primitives = readFileSync(new URL("./account-list-primitives.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../pages/accounts-page.tsx", import.meta.url), "utf8");
const environments = readFileSync(new URL("../pages/environments-page.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../pages/overview-page.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../pages/operations-page.tsx", import.meta.url), "utf8");
const reactApp = readFileSync(new URL("../react-app.tsx", import.meta.url), "utf8");
const usage = readFileSync(new URL("../pages/usage-page.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("./ui/select.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./ui/button.tsx", import.meta.url), "utf8");

test("shared page layout uses the full content width and defines compact actions", () => {
  assert.match(primitives, /admin-page-content/);
  assert.doesNotMatch(primitives, /max-w-\[1520px\]/);
  assert.match(primitives, /responsive-action-label/);
  assert.match(primitives, /title=\{label\}/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /\.responsive-actions\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.responsive-action-label\s*\{[^}]*display:\s*none/s);
  assert.match(css, /overflow-x:\s*auto/);
});

test("account records keep actions in the row and provide icons for compact controls", () => {
  assert.match(accounts, /admin-page-content/);
  assert.match(accounts, /responsive-account-row/);
  assert.match(accounts, /responsive-actions/);
  assert.doesNotMatch(accounts, /responsive-actions[^\n]*flex-wrap/);
  assert.match(accounts, /Pencil/);
  assert.match(accounts, /Ellipsis/);
  assert.match(accounts, /absolute right-0 top-full z-20 pt-2/);
  assert.match(accounts, /account-runtime-cell/);
  assert.match(accounts, /account-runtime-actions/);
  assert.match(accounts, /account-usage-row/);
  assert.match(css, /\.account-runtime-cell\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s+3\.25rem/s);
  assert.match(css, /\.account-usage-row\s*\{[^}]*grid-template-columns:\s*2rem\s+minmax\(80px, 1fr\)\s+2\.25rem\s+5\.75rem/s);
  assert.doesNotMatch(accounts, /value:\s*"chatgpt",\s*label:\s*localizeAuthMode/);
  assert.doesNotMatch(accounts, /SlidersHorizontal/);
  assert.match(accounts, /RefreshCw/);
  assert.match(accounts, /authRefreshIntervalSeconds/);
  assert.match(accounts, /onRefreshAuthMetrics/);
  assert.match(accounts, /route\?\.originalBaseUrl/);
  assert.match(accounts, /route\?\.localBaseUrl/);
  assert.match(accounts, /已开启代理/);
  assert.doesNotMatch(accounts, /text\.labels\.chatgptMode/);
  assert.doesNotMatch(accounts, /<RunStatusBadge/);
  assert.doesNotMatch(accounts, /<Field label=\{pageCopy\.accounts\.target\}>/);
  assert.match(accounts, /保存 API Key/);
  assert.match(accounts, /保存 sub2api/);
  assert.doesNotMatch(environments, /<RunStatusBadge/);
  assert.doesNotMatch(select, /focus-visible:ring/);
  assert.match(css, /\[data-slot="select-trigger"\]:focus-visible\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(accounts, /data-auth-refresh-input/);
  assert.match(accounts, /w-\[64px\]/);
  assert.match(css, /\[data-auth-refresh-input\]:focus-visible\s*\{[^}]*box-shadow:\s*none/s);
});

test("all management record cards opt into the single-row responsive contract", () => {
  assert.match(environments, /responsive-environment-row/);
  assert.match(overview, /responsive-overview-row/);
  assert.match(operations, /responsive-operation-row/);
  assert.match(environments, /responsive-actions/);
  assert.match(overview, /responsive-actions/);
  assert.match(operations, /responsive-actions/);
  assert.doesNotMatch(operations, /<AvatarTile/);
  assert.doesNotMatch(operations, /<Pager/);
  assert.doesNotMatch(operations, /<SoftBadge/);
  assert.doesNotMatch(overview, /<AvatarTile/);
  assert.match(reactApp, /shouldAutoLoadProxy/);
  assert.match(reactApp, /proxyDraftDirtyRef/);
  assert.doesNotMatch(environments, />CODEX_HOME</);
  assert.doesNotMatch(environments, /language === "zh" \? "当前目标" : "Targets"/);
  assert.match(usage, /buildUsageFilter/);
  assert.match(usage, /REFRESH_INTERVAL_PRESETS/);
  assert.match(usage, /customRefreshEditing/);
  assert.match(usage, /shouldScheduleUsageRefresh/);
});

test("desktop motion is restrained and respects reduced-motion preferences", () => {
  assert.match(css, /@keyframes page-enter/);
  assert.match(css, /@keyframes record-enter/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.motion-page-enter/);
  assert.match(css, /\.responsive-record-row\s*\{[^}]*animation:\s*record-enter/s);
  assert.match(button, /active:scale-\[0\.97\]/);
  assert.match(accounts, /transition-\[width,background-color\] duration-300/);
  assert.match(reactApp, /transition-\[width\] duration-300/);
});
