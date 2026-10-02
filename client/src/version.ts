// 有新版本 (D-042): the page compares its own commit with the deployed build's, which the
// build writes to version.json. Nothing is cached (no service worker), so this only tells an
// open page that a newer one is out; the player reloads when it suits him, never mid-game.

/** The deployed build's commit, read past every cache; null when there is none (vite dev) or it cannot be read. */
export async function deployedCommit(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchFn(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const v: unknown = await r.json();
    const commit = typeof v === "object" && v !== null ? (v as { commit?: unknown }).commit : undefined;
    return typeof commit === "string" && commit !== "" ? commit : null;
  } catch {
    return null;
  }
}

/** Whether the deployed build is another one than this page. */
export function isNewer(own: string, deployed: string | null): boolean {
  return deployed !== null && deployed !== own;
}
