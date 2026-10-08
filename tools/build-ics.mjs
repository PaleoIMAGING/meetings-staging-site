// Generates the subscribable iCalendar feed from _data/meetings/*.yml.
//   node build-ics.mjs --out ../meetings/feed.ics   write the feed
//   node build-ics.mjs --check                      fail if the committed feed is stale
//   --dir <records dir>   use another records directory
// The feed is built by assets/js/meetings-ics.js: CRLF, folded lines and
// embedded VTIMEZONE blocks, which Jekyll's Liquid cannot produce.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ics, loadConfig, recordsDir, siteRoot, validateDir } from "./lib.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const feedPath = resolve(arg("--out") || join(siteRoot, "meetings", "feed.ics"));
const config = loadConfig();

const results = validateDir(resolve(arg("--dir") || recordsDir()), config);
const invalid = results.filter((r) => r.errors.length);
if (invalid.length) {
  invalid.forEach((r) => console.error(`invalid record ${r.file}: ${r.errors.join("; ")}`));
  process.exit(1);
}

const origin = config.ui.site_url;
const text = ics.buildCalendar(results.map((r) => r.record), config, { stamp: Date.now(), origin });

// DTSTAMP changes on every run, so staleness ignores it.
const normalise = (s) => s.replace(/^DTSTAMP:.*$/gm, "DTSTAMP:-");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(feedPath, "utf8"); } catch { /* missing counts as stale */ }
  if (normalise(current) !== normalise(text)) {
    console.error(`${feedPath} is out of date. Run: npm run build:ics`);
    process.exit(1);
  }
  console.log("feed.ics is up to date");
} else {
  writeFileSync(feedPath, text, { encoding: "utf8" });
  console.log(`wrote ${feedPath} (${results.length} record(s))`);
}
