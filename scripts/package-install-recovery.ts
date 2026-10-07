import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { copyInstallForRollback, restoreInstallFromRollback } from "../apps/desktop/electron/update-rollback.js";

const targetPath = process.argv[2];
const backupPath = process.argv[3];
const probePath = process.argv[4] ?? targetPath;

if (!targetPath || !backupPath) {
  throw new Error("target and backup paths are required");
}
if (!statSync(targetPath).isFile() && !statSync(targetPath).isDirectory()) {
  throw new Error("rollback target must be a file or directory");
}
if (!statSync(probePath).isFile()) {
  throw new Error("rollback probe must be a file");
}

const beforeDigest = digest(probePath);
copyInstallForRollback(targetPath, backupPath);
writeFileSync(probePath, Buffer.from("corrupt-upgrade-probe"));
restoreInstallFromRollback(targetPath, backupPath);

const afterDigest = digest(probePath);
if (afterDigest !== beforeDigest) {
  throw new Error("rollback did not restore the installed executable byte-for-byte");
}

if (existsSync(backupPath)) {
  rmSync(backupPath, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ status: "passed", target: basename(targetPath) })}\n`);

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
