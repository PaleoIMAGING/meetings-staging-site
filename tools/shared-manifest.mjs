// Prints the SHA-256 of every file that other repositories (the private
// Worker) must consume unchanged. The Worker's sync script pins these hashes,
// so drift between the website and the Worker is detected instead of
// silently creating a second validator.
//   node shared-manifest.mjs           print the manifest
//   node shared-manifest.mjs --write   update shared-manifest.json
//   node shared-manifest.mjs --check   fail if shared-manifest.json is stale
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { siteRoot } from "./lib.mjs";

export const SHARED_FILES = [
  "assets/js/meetings-core.js",
  "assets/js/meetings-validate.js",
  "assets/js/meetings-ics.js",
  "_data/meetings_config.yml",
  "tools/test/fixtures/validation-vectors.json"
];

export function manifest() {
  const files = {};
  for (const f of SHARED_FILES) {
    // Normalise line endings so Windows checkouts hash the same as Linux.
    const text = readFileSync(join(siteRoot, f), "utf8").replace(/\r\n/g, "\n");
    files[f] = createHash("sha256").update(text).digest("hex");
  }
  return { description: "Files consumed unchanged by other repositories. Regenerate with npm run shared:write.", files };
}

if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("shared-manifest.mjs")) {
  const path = join(siteRoot, "tools", "shared-manifest.json");
  const next = JSON.stringify(manifest(), null, 2) + "\n";
  if (process.argv.includes("--write")) { writeFileSync(path, next); console.log("wrote " + path); }
  else if (process.argv.includes("--check")) {
    let cur = ""; try { cur = readFileSync(path, "utf8").replace(/\r\n/g, "\n"); } catch { /* stale */ }
    if (cur !== next) { console.error("shared-manifest.json is stale. Run: npm run shared:write"); process.exit(1); }
    console.log("shared-manifest.json is up to date");
  } else process.stdout.write(next);
}
