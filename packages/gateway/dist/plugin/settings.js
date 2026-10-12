import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
/**
 * Small encrypted-at-rest settings store for plugin configuration. Secrets are
 * never sent back to the renderer as plaintext by the desktop bridge. The key
 * is a per-user 0600 file; OS keychain integration can replace this store
 * later without changing the plugin API.
 */
export class PluginSettingsStore {
    filePath;
    loaded;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async get(pluginId) {
        const all = await this.readAll();
        return { ...(all[pluginId] ?? {}) };
    }
    async set(pluginId, values, schema) {
        const normalized = normalizeSettings(values, schema);
        const all = await this.readAll();
        all[pluginId] = normalized;
        await this.writeAll(all);
        return { ...normalized };
    }
    async clear(pluginId) {
        const all = await this.readAll();
        delete all[pluginId];
        await this.writeAll(all);
    }
    async readAll() {
        if (this.loaded)
            return this.loaded;
        try {
            const encoded = JSON.parse(await readFile(this.filePath, "utf8"));
            if (!encoded.iv || !encoded.tag || !encoded.data)
                throw new Error("Plugin settings payload is incomplete");
            const key = await this.readOrCreateKey();
            const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encoded.iv, "base64"));
            decipher.setAuthTag(Buffer.from(encoded.tag, "base64"));
            const plaintext = Buffer.concat([decipher.update(Buffer.from(encoded.data, "base64")), decipher.final()]).toString("utf8");
            const parsed = JSON.parse(plaintext);
            this.loaded = isSettingsRecord(parsed) ? parsed : {};
        }
        catch {
            this.loaded = {};
        }
        return this.loaded;
    }
    async writeAll(value) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const key = await this.readOrCreateKey();
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
        const payload = JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") }) + "\n";
        await writeFile(this.filePath, payload, { mode: 0o600 });
        await chmod(this.filePath, 0o600).catch(() => undefined);
        this.loaded = value;
    }
    async readOrCreateKey() {
        const keyPath = `${this.filePath}.key`;
        try {
            const key = await readFile(keyPath);
            if (key.length === 32)
                return key;
        }
        catch { /* create below */ }
        const key = randomBytes(32);
        await mkdir(dirname(keyPath), { recursive: true });
        await writeFile(keyPath, key, { mode: 0o600 });
        await chmod(keyPath, 0o600).catch(() => undefined);
        return key;
    }
}
export function normalizeSettings(values, schema) {
    if (!schema)
        return { ...values };
    const result = {};
    for (const [key, property] of Object.entries(schema.properties)) {
        const value = values[key] === undefined ? property.default : values[key];
        if (value === undefined) {
            if (schema.required?.includes(key))
                throw new Error(`Plugin setting '${key}' is required`);
            continue;
        }
        if (property.type === "string" && typeof value !== "string")
            throw new Error(`Plugin setting '${key}' must be a string`);
        if (property.type === "number" && (typeof value !== "number" || !Number.isFinite(value)))
            throw new Error(`Plugin setting '${key}' must be a number`);
        if (property.type === "integer" && (!Number.isInteger(value)))
            throw new Error(`Plugin setting '${key}' must be an integer`);
        if (property.type === "boolean" && typeof value !== "boolean")
            throw new Error(`Plugin setting '${key}' must be a boolean`);
        if (property.type === "select" && (typeof value !== "string" || !property.options?.some((option) => option.value === value)))
            throw new Error(`Plugin setting '${key}' has an invalid option`);
        if (typeof value === "number" && property.minimum !== undefined && value < property.minimum)
            throw new Error(`Plugin setting '${key}' is below the minimum`);
        if (typeof value === "number" && property.maximum !== undefined && value > property.maximum)
            throw new Error(`Plugin setting '${key}' is above the maximum`);
        result[key] = value;
    }
    return result;
}
function isSettingsRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        && Object.values(value).every((item) => typeof item === "object" && item !== null && !Array.isArray(item));
}
//# sourceMappingURL=settings.js.map