import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicFileOptions {
  mode?: number;
  encoding?: BufferEncoding;
}

/** Replace a file through a same-directory rename and clean failed temp files. */
export async function writeFileAtomically(
  path: string,
  content: string | Uint8Array,
  options?: AtomicFileOptions,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, options);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
