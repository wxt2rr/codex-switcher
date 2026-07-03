import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

async function read(path: string) {
  return readFile(`${repoRoot}/${path}`, "utf8");
}

test("README files document the current Windows-facing command surface", async () => {
  const zh = await read("README.md");
  const en = await read("README.en.md");

  const requiredZh = [
    "macOS / 类 Unix 终端下：`codex-sw` 默认继续走 Bash 版入口，保持现有工作流稳定",
    "Windows 原生支持：`cmd`、PowerShell、Windows Terminal",
    "`codex-sw-node` 仍保留为显式 Node 入口，便于脚本化调用、验证与排障",
    "macOS 当前仍以现有 Bash 入口为默认工作流，避免打断已有使用习惯",
    "codex-sw ac login <account> [--env <env>] [-t cli\\|app\\|both] [--sync\\|--no-sync] [--mode auth\\|apikey\\|sub2api]",
    "codex-sw ac relogin [account] [--env <env>] [-t cli\\|app\\|both] [--sync\\|--no-sync] [--mode auth\\|apikey\\|sub2api]",
    "codex-sw app status",
    "codex-sw app logout [account]",
    "codex-sw app stop-managed",
    "codex-sw ops list",
    "codex-sw ops proxy [show\\|test\\|off\\|<host:port>\\|<scheme://host:port>]",
    "codex-sw ops init [--shell zsh\\|bash\\|powershell\\|cmd\\|windows-terminal\\|wt] [--dry-run]",
    "codex-sw ops import-default <env> [--with-auth] [--force]",
    "codex-sw ops recover [--dry-run]",
    "codex-sw ops doctor [--fix]",
    "启动 token 自动续期守护（Windows 计划任务 / macOS launchd）",
    "Windows 下从源码安装建议直接运行：`node scripts/bin/codex-sw-node.cjs install --shell powershell`",
    "Windows 下从源码卸载建议直接运行：`node scripts/bin/codex-sw-node.cjs uninstall --shell powershell`",
    "如果需要同时清理 switcher 状态和 env home，可直接追加：`--purge`",
    "Windows 真机验收清单见 [docs/windows-manual-checklist.md](docs/windows-manual-checklist.md)",
    "Windows 真机验收可直接从：`powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-manual-start.ps1 -EvidencePath .\\windows-manual-evidence.txt -ResultPath .\\windows-manual-result.md` 开始",
    "在源码仓库里，也可以直接运行：`npm run windows:manual:start`",
    "如需在 Codex App 外部终端重新打开生命周期敏感测试，可运行：`npm run test:lifecycle`",
    "只想重抓命令证据时，可运行：`npm run windows:manual:capture`",
    "只想重建预填充结果模板时，可运行：`npm run windows:manual:result-template`",
  ];

  const requiredEn = [
    "On macOS and Unix-like terminals: `codex-sw` still defaults to the legacy Bash entrypoint to preserve the current workflow",
    "Windows native support: `cmd`, PowerShell, and Windows Terminal",
    "`codex-sw-node` remains available as the explicit Node entrypoint for scripting, verification, and troubleshooting",
    "macOS currently keeps the existing Bash entrypoints as the default workflow to avoid disrupting established usage",
    "codex-sw ac login <account> [--env <env>] [-t cli\\|app\\|both] [--sync\\|--no-sync] [--mode auth\\|apikey\\|sub2api]",
    "codex-sw ac relogin [account] [--env <env>] [-t cli\\|app\\|both] [--sync\\|--no-sync] [--mode auth\\|apikey\\|sub2api]",
    "codex-sw app status",
    "codex-sw app logout [account]",
    "codex-sw app stop-managed",
    "codex-sw ops list",
    "codex-sw ops proxy [show\\|test\\|off\\|<host:port>\\|<scheme://host:port>]",
    "codex-sw ops init [--shell zsh\\|bash\\|powershell\\|cmd\\|windows-terminal\\|wt] [--dry-run]",
    "codex-sw ops import-default <env> [--with-auth] [--force]",
    "codex-sw ops recover [--dry-run]",
    "codex-sw ops doctor [--fix]",
    "Start token auto-refresh guard (Windows scheduled task / macOS launchd)",
    "On Windows, prefer running from source with: `node scripts/bin/codex-sw-node.cjs install --shell powershell`",
    "On Windows, prefer uninstalling from source with: `node scripts/bin/codex-sw-node.cjs uninstall --shell powershell`",
    "If you also want to remove switcher state and env homes, append: `--purge`",
    "For live Windows validation, see [docs/windows-manual-checklist.md](docs/windows-manual-checklist.md)",
    "To start live Windows validation directly, run: `powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-manual-start.ps1 -EvidencePath .\\windows-manual-evidence.txt -ResultPath .\\windows-manual-result.md`",
    "From a source checkout, you can also run: `npm run windows:manual:start`",
    "To re-enable lifecycle-sensitive coverage from an external terminal outside Codex App, run: `npm run test:lifecycle`",
    "If you only want to recapture command evidence, run: `npm run windows:manual:capture`",
    "If you only want to regenerate the prefilled result template, run: `npm run windows:manual:result-template`",
  ];

  for (const line of requiredZh) {
    assert.ok(zh.includes(line), `README.md should include: ${line}`);
  }

  for (const line of requiredEn) {
    assert.ok(en.includes(line), `README.en.md should include: ${line}`);
  }
});
