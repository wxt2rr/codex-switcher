import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { copyInstallForRollback, restoreInstallFromRollback } from "../apps/desktop/electron/update-rollback.js";

const targetPath = process.argv[2];
const backupPath = process.argv[3];

if (!targetPath || !backupPath) {
  throw new Error("target and backup paths are required");
}
if (!statSync(targetPath).isFile()) {
  throw new Error("rollback target must be a file");
}

const beforeDigest = digest(targetPath);
copyInstallForRollback(targetPath, backupPath);
writeFileSync(targetPath, Buffer.from("corrupt-upgrade-probe"));
restoreInstallFromRollback(targetPath, backupPath);

const afterDigest = digest(targetPath);
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
