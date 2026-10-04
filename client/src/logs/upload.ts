// Uploading the kept games (D-056), oldest first, quietly: the player never sees an error.
// A game the Worker took (201) or had already (200) is marked sent; one it will never take
// (400 not a record, 413 too large) is marked rejected; anything else (no network, 503 when
// the day's KV writes are used up) leaves the rest for the next try: when the page opens
// and when the next game ends.

import type { LogStore } from "./store.ts";

/** Posts a body and gives the HTTP status; throws when there is no answer (no network). */
export type Poster = (url: string, body: string) => Promise<number>;

/**
 * Below this size the upload is `keepalive`, so it finishes even if the page closes right
 * after the game; browsers allow keepalive bodies up to 64 KiB in all.
 */
export const KEEPALIVE_MAX = 60_000;

/** The page's poster. text/plain: a "simple" cross-origin request, no preflight. */
export function fetchPoster(fetchFn: typeof fetch = fetch): Poster {
  return async (url, body) => {
    const res = await fetchFn(url, {
      method: "POST",
      body,
      headers: { "content-type": "text/plain;charset=UTF-8" },
      mode: "cors",
      credentials: "omit",
      keepalive: body.length <= KEEPALIVE_MAX,
    });
    return res.status;
  };
}

/** Uploads what is waiting. Returns how many went up. With no URL (not deployed yet), nothing. */
export async function uploadPending(store: LogStore, url: string, post: Poster): Promise<number> {
  if (url === "") return 0;
  let sent = 0;
  for (const entry of await store.pending()) {
    let status: number;
    try {
      status = await post(url, JSON.stringify(entry.rec));
    } catch {
      return sent;
    }
    if (status === 200 || status === 201) {
      await store.mark(entry.id, "sent");
      sent++;
    } else if (status === 400 || status === 413) {
      await store.mark(entry.id, "rejected");
    } else {
      return sent;
    }
  }
  return sent;
}
