import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type UiLanguage = "zh" | "en" | "ja";

const SUPPORTED_LANGUAGES: UiLanguage[] = ["zh", "en", "ja"];

export async function getUiLanguage(): Promise<UiLanguage> {
  const saved = await readSavedLanguage();
  if (saved) {
    return saved;
  }

  return detectSystemLanguage();
}

export async function setUiLanguage(language: string): Promise<UiLanguage> {
  const normalized = normalizeUiLanguage(language);
  if (!normalized) {
    throw new Error(`unsupported ui language: ${language}`);
  }

  const stateDir = getStateDir();
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "ui_lang"), `${normalized}\n`, "utf8");
  return normalized;
}

async function readSavedLanguage(): Promise<UiLanguage | undefined> {
  try {
    const raw = await readFile(join(getStateDir(), "ui_lang"), "utf8");
    return normalizeUiLanguage(raw);
  } catch {
    return undefined;
  }
}

function detectSystemLanguage(): UiLanguage {
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUiLanguage(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "en";
}

function normalizeUiLanguage(value: string | undefined): UiLanguage | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  for (const language of SUPPORTED_LANGUAGES) {
    if (normalized === language || normalized.startsWith(`${language}-`)) {
      return language;
    }
  }

  return undefined;
}

function getStateDir(): string {
  return process.env.CODEX_SWITCHER_STATE_DIR || `${process.env.HOME}/.codex-switcher`;
}
