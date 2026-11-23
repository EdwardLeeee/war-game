// Capacitor's versions (D-163, the brief's 「各套件鎖精確版本」): the app's three packages pinned to one
// exact version, the native project's Swift package (capacitor-swift-pm in CapApp-SPM/Package.swift)
// at the same, and, should client/ ever depend on @capacitor/* itself, those at the same too. A
// mismatch fails CI: upgrade them all together (`npm install` the three, then `npx cap sync ios`).
//
//   node scripts/check-versions.ts

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(MOBILE, "..");
const PACKAGES = ["@capacitor/cli", "@capacitor/core", "@capacitor/ios"] as const;
const EXACT = /^\d+\.\d+\.\d+$/;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const deps = (m: Manifest): Record<string, string> => ({ ...m.dependencies, ...m.devDependencies });

const problems: string[] = [];
const mobile = deps(readJson<Manifest>(join(MOBILE, "package.json")));
const pinned = PACKAGES.map((name) => mobile[name]);
for (const [i, name] of PACKAGES.entries()) {
  const v = pinned[i];
  if (v === undefined) problems.push(`mobile/package.json: ${name} missing`);
  else if (!EXACT.test(v)) problems.push(`mobile/package.json: ${name} is "${v}", not an exact version`);
}
const version = pinned[0] ?? "";
for (const [i, name] of PACKAGES.entries()) {
  if (pinned[i] !== undefined && pinned[i] !== version) problems.push(`mobile/package.json: ${name} ${pinned[i]}, ${PACKAGES[0]} ${version}`);
}

// What npm ci installs.
const lock = readJson<{ packages: Record<string, { version?: string }> }>(join(MOBILE, "package-lock.json"));
for (const name of PACKAGES) {
  const got = lock.packages[`node_modules/${name}`]?.version;
  if (got !== version) problems.push(`mobile/package-lock.json: ${name} ${got ?? "missing"}, want ${version}`);
}

// The native side: Capacitor's Swift package, as `npx cap sync ios` writes it.
const swift = readFileSync(join(MOBILE, "ios", "App", "CapApp-SPM", "Package.swift"), "utf8");
const spm = /capacitor-swift-pm\.git",\s*exact:\s*"([^"]+)"/.exec(swift)?.[1];
if (spm !== version) problems.push(`mobile/ios/App/CapApp-SPM/Package.swift: capacitor-swift-pm ${spm ?? "not pinned with exact:"}, want ${version}`);

// The web side: client/ has no @capacitor/* today; any it adds must be the same version.
const client = deps(readJson<Manifest>(join(ROOT, "client", "package.json")));
for (const [name, v] of Object.entries(client)) {
  if (name.startsWith("@capacitor/") && v !== version) problems.push(`client/package.json: ${name} ${v}, want ${version} (mobile's)`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`Capacitor ${version}: mobile/package.json, package-lock.json, CapApp-SPM/Package.swift agree; client/ has ${Object.keys(client).some((n) => n.startsWith("@capacitor/")) ? "the same" : "none"}`);
