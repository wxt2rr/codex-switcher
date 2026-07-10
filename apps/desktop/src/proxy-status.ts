export function parseProxyStatusOutput(output: string): string {
  const match = output.trim().match(/^usage_api_proxy:\s*(.+)$/i);
  const value = match?.[1]?.trim() ?? "";
  if (!value || value === "off") return "";
  return value.replace(/\s+\((manual|auto-env|auto-system)\)$/i, "");
}

export function shouldAutoLoadProxy(view: string, draftIsDirty: boolean): boolean {
  return view === "operations" && !draftIsDirty;
}
