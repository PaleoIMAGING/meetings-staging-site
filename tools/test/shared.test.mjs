import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { core, ics, loadConfig, siteRoot, validator } from "../lib.mjs";
import { manifest } from "../shared-manifest.mjs";

const read = (p) => readFileSync(join(siteRoot, p), "utf8");
const vectors = JSON.parse(read("tools/test/fixtures/validation-vectors.json"));

// The Worker and the browser load these files without Node. Prove that they
// run in a bare JavaScript realm (only Intl/URL/TextEncoder, which Workers and
// browsers provide) and behave exactly as under Node.
function loadBare(files) {
  const sandbox = { Intl, URL, TextEncoder, Date, Math, Object, Array, String, Number, JSON, Set, RegExp, Error };
  sandbox.self = sandbox; // browser-style global, no `module`, no `require`
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(read(f), sandbox, { filename: f });
  return sandbox;
}

test("shared modules run in a bare browser-like realm", () => {
  const g = loadBare(["assets/js/meetings-core.js", "assets/js/meetings-validate.js", "assets/js/meetings-ics.js"]);
  assert.ok(g.PaleoMeetings && g.PaleoMeetingsValidate && g.PaleoMeetingsIcs);
  assert.equal(typeof g.require, "undefined");
});

test("bare realm and Node produce identical validation results for every vector", () => {
  const config = loadConfig();
  const g = loadBare(["assets/js/meetings-core.js", "assets/js/meetings-validate.js"]);
  for (const c of vectors.cases) {
    const rec = { ...structuredClone(vectors.base), ...structuredClone(c.patch || {}) };
    (c.drop || []).forEach((k) => delete rec[k]);
    const node = validator.validate(rec, config, { filenameId: rec.id });
    const bare = g.PaleoMeetingsValidate.validate(JSON.parse(JSON.stringify(rec)), JSON.parse(JSON.stringify(config)), { filenameId: rec.id });
    assert.deepEqual(JSON.parse(JSON.stringify(bare)), node, c.name);
  }
});

test("shared files contain no Node, DOM or network dependencies", () => {
  for (const f of ["assets/js/meetings-core.js", "assets/js/meetings-validate.js", "assets/js/meetings-ics.js"]) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const banned of [/\bimport\s+[\w{*]/, /require\((?!"\.\/meetings-core\.js")/, /\bprocess\./, /\bdocument\./, /\bwindow\b/, /\bfetch\(/, /\bBuffer\b/, /node:/])
      assert.ok(!banned.test(src), `${f} uses ${banned}`);
  }
});

test("the configuration is plain data a Worker can load (JSON round-trip)", () => {
  const config = loadConfig();
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  assert.equal(config.schema_version, 2);
});

test("committed shared-manifest.json matches the shared files", () => {
  const committed = JSON.parse(read("tools/shared-manifest.json"));
  assert.deepEqual(committed, manifest());
});

test("site code and page use the shared modules, not private copies", () => {
  const page = read("assets/js/meetings-page.js");
  assert.ok(page.includes("PaleoMeetingsIcs") && page.includes("PaleoMeetings"));
  assert.ok(!/BEGIN:VCALENDAR|BAD_TEXT_RE|function wallToInstant/.test(page), "page re-implements shared logic");
});

test("YAML config parses to the same object the validator was tested with", () => {
  assert.deepEqual(YAML.parse(read("_data/meetings_config.yml")), loadConfig());
  assert.ok(core && ics);
});

test("inline JSON in every page escapes < (a decoded escape once made this a silent no-op)", () => {
  const esc = String.fromCharCode(92) + "u003c";
  for (const page of ["meetings/index.html", "meetings/submit/index.html"]) {
    const src = read(page);
    const uses = src.split("jsonify | replace: \"<\", \"").length - 1;
    assert.ok(uses >= 1, page + " embeds JSON");
    assert.equal(src.split("jsonify | replace: \"<\", \"" + esc + "\"").length - 1, uses, page + " must escape every embedded JSON blob");
  }
});
