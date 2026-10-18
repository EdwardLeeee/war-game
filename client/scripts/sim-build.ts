// Which simulation a game is played on (D-083, sim/PROTOCOL.md 9.1): the sources Rolldown
// bundles into the simulation's Worker (sim/src/worker.ts), as the build does, hashed in path
// order with their contents (SHA-256, the first 12 hex digits). Sent in `init` and `continue`;
// the simulation only compares it. Only a change to what the Worker runs changes it: a release
// of the screen alone, or of core's measuring tools, leaves a game in progress able to go on
// (繼續上一局). vite.config.ts gives it to the page; the tests that make a log in Node use it too.
//
//   node client/scripts/sim-build.ts     prints it and the files

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

/** The repository's root (client/scripts/ is two levels down). */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface SimBuild {
  /** 12 hex digits. */
  id: string;
  /** The sources bundled, relative to the repository, sorted. */
  files: string[];
}

export async function simBuild(repo = REPO): Promise<SimBuild> {
  const bundle = await rolldown({ input: resolve(repo, "sim/src/worker.ts"), logLevel: "silent" });
  try {
    const { output } = await bundle.generate({ format: "es" });
    const ids = output.flatMap((c) => (c.type === "chunk" ? c.moduleIds : []));
    // Rolldown's own helpers start with \0; they are not files.
    const files = [...new Set(ids.filter((id) => !id.startsWith("\0")).map((id) => relative(repo, id).split("\\").join("/")))].sort();
    const h = createHash("sha256");
    for (const f of files) {
      h.update(f);
      h.update("\0");
      h.update(readFileSync(resolve(repo, f)));
      h.update("\0");
    }
    return { id: h.digest("hex").slice(0, 12), files };
  } finally {
    await bundle.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const b = await simBuild();
  console.log(`${b.id} (${b.files.length} files)`);
  for (const f of b.files) console.log(`  ${f}`);
}
