// Validates meeting records against _data/meetings_config.yml.
// Usage: node validate-meetings.mjs [--dir <records dir>]
// Defaults to the published records in _data/meetings/. Rules live in
// assets/js/meetings-validate.js (shared with the browser and the Worker).
import { resolve } from "node:path";
import { loadConfig, recordsDir, validateDir } from "./lib.mjs";

const i = process.argv.indexOf("--dir");
const dir = resolve(i > -1 ? process.argv[i + 1] : recordsDir());
const results = validateDir(dir, loadConfig());

let bad = 0;
for (const r of results) {
  if (r.errors.length) {
    bad++;
    console.error(`FAIL ${r.file}`);
    r.errors.forEach((x) => console.error("   - " + x));
  } else console.log(`ok   ${r.file}`);
}
console.log(`\n${results.length} record(s) in ${dir}, ${bad} with errors`);
process.exit(bad ? 1 : 0);
