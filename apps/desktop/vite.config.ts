import path from "path";
import { homedir } from "node:os";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { readLegacyState } from "../../packages/core/src/state/legacy";
import { SkillManager } from "./electron/skill-manager";

function desktopPreviewSkillsApi(): Plugin {
  return {
    name: "desktop-preview-skills-api",
    configureServer(server) {
      const userHome = homedir();
      const stateDir = process.env.CODEX_SWITCHER_STATE_DIR || path.join(userHome, ".codex-switcher");
      const envsDir = process.env.CODEX_SWITCHER_ENVS_DIR || path.join(userHome, ".codex-envs");
      const defaultHome = process.env.CODEX_SWITCHER_DEFAULT_HOME || path.join(userHome, ".codex");
      const manager = new SkillManager({
        stateDir,
        catalogUrl: process.env.CODEX_SWITCHER_SKILLS_CATALOG_URL,
        environments: async () => {
          const state = await readLegacyState({ stateDir, envsDir, defaultHome });
          return Object.values(state.envs).map((environment) => ({
            name: environment.name,
            homePath: environment.path,
          }));
        },
      });

      server.middlewares.use("/desktop-preview/skills-snapshot", async (request, response) => {
        try {
          const query = new URL(request.url || "/", "http://127.0.0.1");
          const snapshot = await manager.getSnapshot({ refreshMarketplace: query.searchParams.get("refresh") === "true" });
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(JSON.stringify(snapshot));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

export default defineConfig(async () => ({
  base: "./",
  clearScreen: false,
  plugins: [react(), tailwindcss(), desktopPreviewSkillsApi()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1"
  }
}));
