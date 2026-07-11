export function maskApiKeyForDisplay(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (!key) return "";
  if (key.length <= 2) return "****";
  if (key.length < 8) return `${key.slice(0, 1)}****${key.slice(-1)}`;
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}
