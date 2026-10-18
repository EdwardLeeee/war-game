// 美術圖集 (D-085, docs/sprite-atlas.md section 2): war-game-ui publishes the atlases as a GitHub
// Release (art-v1, art-v2…); art.lock.json pins its tag and each file's SHA-256. This fetches
// them from the public Release (no key), checks every file against the lock, and unpacks them
// into public/art/<tag>/ for the build (git ignores it: the atlases are never committed). A file
// that does not match fails the build. Downloads are kept in .art-cache/ between runs.
//
//   node scripts/fetch-art.ts              the Release art.lock.json pins (CI, Pages); none pinned: nothing
//   node scripts/fetch-art.ts --dev        this machine only, before a Release: the design-render
//                                          artifacts (gh, signed in), unpacked as public/art/dev/
//
// Layout of public/art/<tag>/, as the Release's archives unpack (and --dev lays them out):
//   x3/units/<unit>/<unit>.json, <unit>_<layer>_<k>.png   x3/effects/effects.json, effects_0.png
//   x2/…                                                   astc-sample/units/<unit>/…astc.ktx

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(CLIENT, ".art-cache");
const OUT = join(CLIENT, "public", "art");

export interface ArtLock {
  repo: string;
  /** The Release's tag, or null before the first one. */
  tag: string | null;
  /** Each file of the Release used, and its SHA-256 (from the Release's SHA256SUMS when pinned). */
  assets: Record<string, string>;
}

export function readLock(file = join(CLIENT, "art.lock.json")): ArtLock {
  return JSON.parse(readFileSync(file, "utf8")) as ArtLock;
}

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Where an archive unpacks under public/art/<tag>/: art-v1-x3.tar.gz → x3, astc-sample.tar.gz → astc-sample. */
export function unpackDir(asset: string): string {
  const name = asset.replace(/\.tar\.gz$/, "");
  return /-(x\d)$/.exec(name)?.[1] ?? name;
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

async function fetchLocked(lock: ArtLock): Promise<void> {
  if (lock.tag === null) {
    console.log("art.lock.json pins no Release yet: no atlases (the game draws its shapes)");
    return;
  }
  const tag = lock.tag;
  const dir = join(CACHE, tag);
  mkdirSync(dir, { recursive: true });
  const target = join(OUT, tag);
  const stamp = join(target, ".lock");
  const want = JSON.stringify(lock.assets);
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === want) {
    console.log(`art ${tag}: already unpacked`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  for (const [asset, hash] of Object.entries(lock.assets)) {
    const file = join(dir, asset);
    let data = existsSync(file) ? readFileSync(file) : null;
    if (data === null || sha256(data) !== hash) {
      const url = `https://github.com/${lock.repo}/releases/download/${tag}/${asset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, data);
    }
    const got = sha256(data);
    if (got !== hash) throw new Error(`${asset}: SHA-256 ${got}, art.lock.json pins ${hash}`);
    if (!asset.endsWith(".tar.gz")) continue;
    const into = join(target, unpackDir(asset));
    mkdirSync(into, { recursive: true });
    run("tar", ["-xzf", file, "-C", into]);
    console.log(`art ${tag}: ${asset} ✓ → public/art/${tag}/${unpackDir(asset)}/`);
  }
  writeFileSync(stamp, want);
}

/**
 * Before a Release: the artifacts war-game-ui named (2026-10-18): the units of run 36849835568,
 * the crossbowman again in 36850248764 (its fall redone), the effects of 36869894736.
 */
const DEV_UNITS = ["farmer_e", "spear_e", "xbow_e", "hcav_e", "mage_e", "farmer_w", "pike_w", "bow_w", "knight_w", "mage_w"];
const DEV_RUN = 36849835568;
const DEV_RUN_FOR: Record<string, number> = { xbow_e: 36850248764 };
const DEV_EFFECTS = { run: 36869894736, artifact: "production-effects-atlas" };

function ghArtifact(runId: number, name: string, zip: string): void {
  if (existsSync(zip)) return;
  const id = spawnSync("gh", ["api", `repos/EdwardLeeee/war-game/actions/runs/${runId}/artifacts?per_page=100`, "--jq", `.artifacts[] | select(.name=="${name}") | .id`], { encoding: "utf8" });
  const artifact = id.stdout.trim();
  if (id.status !== 0 || artifact === "") throw new Error(`no artifact ${name} in run ${runId}`);
  const r = spawnSync("gh", ["api", `repos/EdwardLeeee/war-game/actions/artifacts/${artifact}/zip`], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`downloading ${name} failed`);
  writeFileSync(zip, r.stdout);
}

function fetchDev(): void {
  const dir = join(CACHE, "dev");
  mkdirSync(dir, { recursive: true });
  const target = join(OUT, "dev");
  rmSync(target, { recursive: true, force: true });
  for (const unit of DEV_UNITS) {
    const zip = join(dir, `${unit}.zip`);
    ghArtifact(DEV_RUN_FOR[unit] ?? DEV_RUN, `production-${unit}`, zip);
    for (const x of ["x3", "x2"]) {
      const into = join(target, x, "units", unit);
      mkdirSync(into, { recursive: true });
      // prod/<unit>/atlas_x3/ in the production run; atlas_x3/ at the top in the crossbowman's.
      run("unzip", ["-q", "-o", "-j", zip, `*atlas_${x}/*`, "-d", into]);
    }
    console.log(`art dev: ${unit}`);
  }
  const zip = join(dir, "effects.zip");
  ghArtifact(DEV_EFFECTS.run, DEV_EFFECTS.artifact, zip);
  for (const x of ["x3", "x2"]) {
    const into = join(target, x, "effects");
    mkdirSync(into, { recursive: true });
    run("unzip", ["-q", "-o", "-j", zip, `effects_${x}/*`, "-d", into]);
  }
  console.log(`art dev: effects → public/art/dev/ (${readdirSync(join(target, "x3", "units")).length} units)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--dev")) fetchDev();
  else await fetchLocked(readLock());
}

