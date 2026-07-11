const fs = require("node:fs");
const path = require("node:path");

const electronDir = path.join(__dirname, "..", "electron-dist", "electron");

const commonJsModules = [
  "main",
  "preload",
  "bridge",
  "ui-language",
  "core-runtime",
  "runtime-paths",
  "codex-projects",
  "codex-tool-paths",
  "env-file-history",
  "usage-routing-model",
  "usage-store",
  "usage-router-service",
  "usage-router-service-main",
  "usage-router-manager",
];

for (const file of commonJsModules) {
  const jsPath = path.join(electronDir, `${file}.js`);
  const cjsPath = path.join(electronDir, `${file}.cjs`);
  if (fs.existsSync(jsPath)) {
    fs.renameSync(jsPath, cjsPath);
  }

  const mapPath = path.join(electronDir, `${file}.js.map`);
  const cjsMapPath = path.join(electronDir, `${file}.cjs.map`);
  if (fs.existsSync(mapPath)) {
    fs.renameSync(mapPath, cjsMapPath);
  }
}

for (const file of commonJsModules) {
  const cjsPath = path.join(electronDir, `${file}.cjs`);
  if (!fs.existsSync(cjsPath)) continue;
  let source = fs.readFileSync(cjsPath, "utf8");
  for (const dependency of commonJsModules) {
    source = source.replaceAll(`./${dependency}.js`, `./${dependency}.cjs`);
  }
  fs.writeFileSync(cjsPath, source, "utf8");
}

const mainPath = path.join(electronDir, "main.cjs");
if (fs.existsSync(mainPath)) {
  let source = fs.readFileSync(mainPath, "utf8");
  source = source.replace("preload.js", "preload.cjs");
  fs.writeFileSync(mainPath, source, "utf8");
}

const bridgePath = path.join(electronDir, "bridge.cjs");
if (fs.existsSync(bridgePath)) {
  let source = fs.readFileSync(bridgePath, "utf8");
  fs.writeFileSync(bridgePath, source, "utf8");
}
