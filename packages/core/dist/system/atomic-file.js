import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
/** Replace a file through a same-directory rename and clean failed temp files. */
export async function writeFileAtomically(path, content, options) {
    // Codex App watches its home files and may restart when one of them is
    // replaced.  Many reconciliation paths run repeatedly with an identical
    // snapshot, so avoid a rename (and the resulting filesystem event) when
    // the bytes are already the desired content.
    const desired = typeof content === "string"
        ? Buffer.from(content, options?.encoding ?? "utf8")
        : Buffer.from(content);
    const existing = await readFile(path).catch((error) => {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    });
    if (existing && Buffer.compare(existing, desired) === 0)
        return;
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, options);
        await rename(temporary, path);
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
//# sourceMappingURL=atomic-file.js.map