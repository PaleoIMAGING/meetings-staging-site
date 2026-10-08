// Node-only helpers shared by the CLI tools and the tests. All real logic
// (validation, recurrence, iCalendar) lives in the UMD modules under
// assets/js/, which are also what the browser and the Worker use.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import YAML from "yaml";

const require = createRequire(import.meta.url);

export const siteRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
export const core = require("../assets/js/meetings-core.js");
export const validator = require("../assets/js/meetings-validate.js");
export const ics = require("../assets/js/meetings-ics.js");

export function loadConfig(root = siteRoot) {
  return YAML.parse(readFileSync(join(root, "_data", "meetings_config.yml"), "utf8"));
}

export function recordsDir(root = siteRoot) {
  return join(root, "_data", "meetings");
}

/** Reads every record in a directory: [{ file, id, record, parseError }]. */
export function readRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const id = basename(file).replace(/\.ya?ml$/, "");
      try {
        return { file, id, record: YAML.parse(readFileSync(join(dir, file), "utf8")) };
      } catch (e) {
        return { file, id, record: null, parseError: e.message.split("\n")[0] };
      }
    });
}

/** Validates every record in `dir`; also reports duplicate ids. */
export function validateDir(dir, config) {
  const seen = new Map();
  return readRecords(dir).map(({ file, id, record, parseError }) => {
    if (parseError) return { file, errors: ["YAML parse error: " + parseError] };
    const errors = validator.validate(record, config, { filenameId: id });
    if (record && typeof record === "object") {
      if (seen.has(record.id)) errors.push(`id: duplicate of ${seen.get(record.id)}`);
      seen.set(record.id, file);
    }
    return { file, errors, record };
  });
}
