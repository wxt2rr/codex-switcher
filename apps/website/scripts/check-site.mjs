import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const dist = join(root, "dist");
const required = [
  "zh/index.html",
  "zh/docs/index.html",
  "zh/docs/installation/index.html",
  "zh/docs/troubleshooting/index.html",
  "favicon.svg",
  "og.svg",
  "robots.txt",
];
const missing = required.filter((file) => !existsSync(join(dist, file)));
if (missing.length) {
  console.error(`Website output is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const homepage = readFileSync(join(dist, "zh/index.html"), "utf8");
const docs = readFileSync(join(dist, "zh/docs/index.html"), "utf8");
const checks = [
  [homepage.includes("一个界面，管理多个"), "homepage hero"],
  [homepage.includes("下载桌面版"), "homepage download CTA"],
  [homepage.includes("使用文档"), "homepage docs link"],
  [docs.includes("推荐阅读顺序"), "docs index"],
  [docs.includes("故障排查"), "docs navigation"],
];
const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) {
  console.error(`Website content checks failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`Website output verified (${required.length} required files, ${checks.length} content checks).`);
