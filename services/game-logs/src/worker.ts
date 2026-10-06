// Collects game records (D-056): the phone posts one after each game; war-game-ai lists and
// downloads them with the read key. Cloudflare Worker with one KV namespace; deployed by the
// user with wrangler (README.md). The free plan allows 1,000 KV writes a day: one per game,
// and none for a game already stored.
//
//   POST /logs        a record (src/record.ts), from the test page's origin. 201 stored,
//                     200 already stored, 400 not a record, 403 other origin, 413 too large,
//                     503 not stored (the day's writes used up): the phone tries again later.
//   GET  /logs        Authorization: Bearer <READ_KEY>. Summaries, 1,000 at a time:
//                     { logs: RecordSummary[], cursor: string | null }; ?cursor= for more.
//   GET  /logs/<id>   Authorization: Bearer <READ_KEY>. The record as posted.

import { checkRecord, MAX_BYTES, summary } from "./record.ts";

/** The part of Workers KV used here. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface Env {
  LOGS: KV;
  /** Set with `wrangler secret put READ_KEY`; never in the repository. Unset: nothing can be read. */
  READ_KEY?: string;
  /** Origins allowed to post, comma-separated (wrangler.toml [vars]). */
  ALLOWED_ORIGINS?: string;
}

const PREFIX = "log:";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function allowed(env: Env, origin: string | null): boolean {
  if (origin === null) return false;
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "")
    .includes(origin);
}

/** Equal strings, compared in a time that does not depend on where they first differ. */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function reader(request: Request, env: Env): Response | null {
  const key = env.READ_KEY ?? "";
  if (key === "") return json(503, { error: "no read key set" });
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !same(auth.slice("Bearer ".length), key)) return json(401, { error: "read key" });
  return null;
}

async function post(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!allowed(env, origin)) return json(403, { error: "origin" });
  const cors = { "access-control-allow-origin": origin as string, vary: "Origin" };
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return json(413, { error: "too large" }, cors);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return json(413, { error: "too large" }, cors);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return json(400, { error: "not JSON" }, cors);
  }
  const record = checkRecord(value);
  if (typeof record === "string") return json(400, { error: `bad ${record}` }, cors);
  const key = PREFIX + record.id;
  try {
    // A read first: the same game uploaded again costs no write.
    if ((await env.LOGS.get(key)) !== null) return json(200, { ok: true, duplicate: true }, cors);
    await env.LOGS.put(key, body, { metadata: summary(record, new Date().toISOString()) });
  } catch {
    return json(503, { error: "not stored" }, cors);
  }
  return json(201, { ok: true }, cors);
}

async function list(request: Request, env: Env, url: URL): Promise<Response> {
  const denied = reader(request, env);
  if (denied !== null) return denied;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const page = await env.LOGS.list({ prefix: PREFIX, cursor, limit: 1000 });
  return json(200, {
    logs: page.keys.map((k) => k.metadata ?? { id: k.name.slice(PREFIX.length) }),
    cursor: page.list_complete ? null : (page.cursor ?? null),
  });
}

async function download(request: Request, env: Env, id: string): Promise<Response> {
  const denied = reader(request, env);
  if (denied !== null) return denied;
  const body = await env.LOGS.get(PREFIX + id);
  if (body === null) return json(404, { error: "no such log" });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/logs" && request.method === "POST") return post(request, env);
  if (path === "/logs" && request.method === "OPTIONS") {
    // The phone posts text/plain, which needs no preflight; this answers one anyway.
    const origin = request.headers.get("origin");
    if (!allowed(env, origin)) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": origin as string, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", vary: "Origin" },
    });
  }
  if (path === "/logs" && request.method === "GET") return list(request, env, url);
  const one = /^\/logs\/([0-9a-f-]{36})$/.exec(path);
  if (one !== null && request.method === "GET") return download(request, env, one[1]);
  return json(404, { error: "not found" });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
