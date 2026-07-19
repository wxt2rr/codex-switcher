export interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
}

export interface WebsiteRelease {
  version: string;
  url: string;
  assets: ReleaseAsset[];
}

const releasesUrl = "https://github.com/wxt2rr/codex-switcher/releases";

export async function getLatestRelease(): Promise<WebsiteRelease> {
  const fallback: WebsiteRelease = { version: "最新版本", url: releasesUrl, assets: [] };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const response = await fetch("https://api.github.com/repos/wxt2rr/codex-switcher/releases?per_page=10", {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return fallback;
    const releases = (await response.json()) as Array<{ tag_name?: string; html_url?: string; draft?: boolean; assets?: Array<{ name: string; browser_download_url: string; size?: number }> }>;
    const release = releases.find((item) => !item.draft && item.tag_name?.startsWith("desktop-v"));
    if (!release) return fallback;
    return {
      version: release.tag_name ?? "最新版本",
      url: release.html_url ?? releasesUrl,
      assets: (release.assets ?? []).map((asset) => ({ name: asset.name, url: asset.browser_download_url, size: asset.size })),
    };
  } catch {
    return fallback;
  }
}

export function findAsset(release: WebsiteRelease, matcher: RegExp): ReleaseAsset | undefined {
  return release.assets.find((asset) => matcher.test(asset.name));
}
