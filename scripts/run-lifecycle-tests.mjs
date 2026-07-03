import { spawn } from "node:child_process";

const child = spawn("npm", ["run", "test:cross-platform"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    CODEX_SWITCHER_ENABLE_APP_LIFECYCLE_TESTS: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
