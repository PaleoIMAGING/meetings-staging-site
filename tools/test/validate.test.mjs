import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, recordsDir, siteRoot, validateDir, validator } from "../lib.mjs";

const config = loadConfig();
const fixtures = join(siteRoot, "tools", "test", "fixtures");
const vectors = JSON.parse(readFileSync(join(fixtures, "validation-vectors.json"), "utf8"));

const build = (c) => {
  const rec = { ...structuredClone(vectors.base), ...structuredClone(c.patch || {}) };
  (c.drop || []).forEach((k) => delete rec[k]);
  return rec;
};

for (const c of vectors.cases) {
  test("vector: " + c.name, () => {
    const rec = build(c);
    const errors = validator.validate(rec, config, { filenameId: rec.id });
    if (c.expect.length === 0) assert.deepEqual(errors, []);
    else for (const needle of c.expect) assert.ok(errors.some((e) => e.includes(needle)), `expected "${needle}" in ${JSON.stringify(errors)}`);
  });
}

test("filename must match id", () => {
  assert.ok(validator.validate(vectors.base, config, { filenameId: "other" }).some((e) => e.includes("must match the file name")));
});

test("non-mapping and prototype-style input do not crash", () => {
  assert.deepEqual(validator.validate(null, config), ["record must be a mapping"]);
  assert.deepEqual(validator.validate([], config), ["record must be a mapping"]);
  assert.ok(validator.validate(JSON.parse('{"__proto__": {"x": 1}}'), config).some((e) => e.includes("required")));
});

test("validateUrl", () => {
  for (const bad of ["http://example.org", "javascript:alert(1)", "https://user:pw@example.org", "ftp://x.org", "not a url", "data:text/html,x", "https://a b.org"])
    assert.ok(validator.validateUrl(bad, 500), bad);
  assert.equal(validator.validateUrl("https://example.org/a?b=c", 500), null);
});

test("published records are valid", () => {
  for (const r of validateDir(recordsDir(), config)) assert.deepEqual(r.errors, [], r.file);
});

test("sample fixtures are valid and cover every format, access level and several WGs", () => {
  const results = validateDir(join(fixtures, "meetings"), config);
  assert.equal(results.length, 8);
  for (const r of results) assert.deepEqual(r.errors, [], r.file);
  const recs = results.map((r) => r.record);
  for (const f of ["online", "in-person", "hybrid"]) assert.ok(recs.some((m) => m.format === f), f);
  for (const a of ["public", "registration", "private"]) assert.ok(recs.some((m) => m.access === a), a);
  assert.ok(recs.some((m) => m.wgs.length > 1) && recs.some((m) => m.wgs[0] === "general") && recs.some((m) => m.recurrence));
});

test("sample records are never published as real meetings", () => {
  for (const r of validateDir(recordsDir(), config)) {
    assert.ok(!r.record || r.record.sample !== true, `${r.file} is marked sample: true`);
    assert.ok(!/^sample-/.test(r.file), `${r.file} looks like a sample`);
  }
});
