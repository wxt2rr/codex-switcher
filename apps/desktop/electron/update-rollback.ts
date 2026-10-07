import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/**
 * Copy an installed app to a private same-filesystem backup before an update.
 * The temporary copy is renamed into place only after the copy succeeds, so a
 * failed backup never replaces the last known-good rollback image.
 */
export function copyInstallForRollback(sourcePath: string, backupPath: string): void {
  if (!existsSync(sourcePath)) throw new Error(`Current install is not available: ${sourcePath}`);
  mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`;
  rmSync(temporaryPath, { recursive: true, force: true });
  try {
    copyPath(sourcePath, temporaryPath);
    replacePath(temporaryPath, backupPath);
  } catch (error) {
    rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

/** Restore the last known-good app image into the installed app path. */
export function restoreInstallFromRollback(targetPath: string, backupPath: string): void {
  if (!existsSync(backupPath)) throw new Error(`Rollback backup is not available: ${backupPath}`);
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.restore.tmp`;
  rmSync(temporaryPath, { recursive: true, force: true });
  try {
    copyPath(backupPath, temporaryPath);
    replaceInstallPreservingTarget(temporaryPath, targetPath);
  } finally {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
}

function copyPath(sourcePath: string, destinationPath: string): void {
  if (statSync(sourcePath).isDirectory()) cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  else copyFileSync(sourcePath, destinationPath);
}

function replacePath(sourcePath: string, destinationPath: string): void {
  replaceInstallPreservingTarget(sourcePath, destinationPath);
}

/** Replace an installed target without leaving it empty if the final rename fails. */
function replaceInstallPreservingTarget(sourcePath: string, targetPath: string): void {
  const displacedPath = `${targetPath}.${process.pid}.${randomUUID()}.previous.tmp`;
  let displaced = false;
  let installed = false;
  try {
    if (existsSync(targetPath)) {
      rmSync(displacedPath, { recursive: true, force: true });
      renameSync(targetPath, displacedPath);
      displaced = true;
    }
    renameSync(sourcePath, targetPath);
    installed = true;
    if (displaced) rmSync(displacedPath, { recursive: true, force: true });
  } catch (error) {
    if (installed) rmSync(targetPath, { recursive: true, force: true });
    if (displaced && !existsSync(targetPath) && existsSync(displacedPath)) renameSync(displacedPath, targetPath);
    throw error;
  } finally {
    if (!existsSync(targetPath)) rmSync(displacedPath, { recursive: true, force: true });
  }
}
