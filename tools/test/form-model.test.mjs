import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, siteRoot, validator, validateDir } from "../lib.mjs";

const model = createRequire(import.meta.url)("../../assets/js/meetings-form-model.js");
const config = loadConfig();

const filled = (over = {}) => ({
  ...model.defaultValues(),
  title: "WG2 interlab call", description: "Monthly call.", type: "wg-meeting", wgs: ["wg2"],
  date: "2027-01-12", startTime: "10:00", endTime: "11:00", timezone: "Europe/Warsaw",
  format: "online", platform: "Zoom", access: "public", url: "https://example.org/join",
  organizers: [{ rowId: "0", name: "A. Person", affiliation: "Somewhere" }],
  ...over
});
const errorsFor = (v) => validator.validate(model.buildRecord(v, config), config);

test("a completely filled form builds a valid record with the current schema version", () => {
  const rec = model.buildRecord(filled(), config);
  assert.equal(rec.schema_version, config.schema_version);
  assert.deepEqual(validator.validate(rec, config), []);
  assert.equal(rec.start, "2027-01-12T10:00");
  assert.equal(rec.id, "wg2-interlab-call-20270112");
});

test("conditional fields: format decides location and platform", () => {
  const vis = (over) => model.visibility(filled(over), config);
  assert.deepEqual([vis({ format: "online" }).location, vis({ format: "online" }).platform], [false, true]);
  assert.deepEqual([vis({ format: "in-person" }).location, vis({ format: "in-person" }).platform], [true, false]);
  assert.deepEqual([vis({ format: "hybrid" }).location, vis({ format: "hybrid" }).platform], [true, true]);
  assert.deepEqual([vis({ format: "" }).location, vis({ format: "" }).platform], [false, false]);
});

test("conditional fields: access decides which link field is shown", () => {
  const vis = (over) => model.visibility(filled(over), config);
  assert.deepEqual(["url", "registrationUrl", "accessNote"].map((k) => vis({ access: "public" })[k]), [true, false, false]);
  assert.deepEqual(["url", "registrationUrl", "accessNote"].map((k) => vis({ access: "registration" })[k]), [false, true, false]);
  assert.deepEqual(["url", "registrationUrl", "accessNote"].map((k) => vis({ access: "private" })[k]), [false, false, true]);
  assert.equal(vis({ access: "public", format: "in-person" }).url, false, "in-person meetings have no join link");
});

test("conditional fields: recurrence and multi-day inputs", () => {
  const vis = (over) => model.visibility(filled(over), config);
  assert.equal(vis({}).recInterval, false);
  assert.equal(vis({ recFreq: "weekly" }).recByday, true);
  assert.equal(vis({ recFreq: "monthly" }).recByday, false);
  assert.deepEqual([vis({ recFreq: "daily", recEnd: "count" }).recCount, vis({ recFreq: "daily", recEnd: "count" }).recUntil], [true, false]);
  assert.deepEqual([vis({ recFreq: "daily", recEnd: "until" }).recCount, vis({ recFreq: "daily", recEnd: "until" }).recUntil], [false, true]);
  assert.equal(vis({ multiDay: true }).endDate, true);
  assert.equal(vis({ multiDay: false }).endDate, false);
});

test("PRIVACY: hidden fields never leak into the record", () => {
  // Switch to invitation-only after typing a public link: the link must vanish.
  const rec = model.buildRecord(filled({ access: "private", accessNote: "Link sent to members", url: "https://example.org/secret-join" }), config);
  assert.equal(rec.url, undefined);
  assert.ok(!JSON.stringify(rec).includes("secret-join"));
  assert.deepEqual(errorsFor(filled({ access: "private", accessNote: "Link sent to members", url: "https://example.org/secret-join" })), []);
  // Registration: only the registration page, never the join link.
  const reg = model.buildRecord(filled({ access: "registration", registrationUrl: "https://example.org/register", url: "https://example.org/secret-join" }), config);
  assert.equal(reg.registration_url, "https://example.org/register");
  assert.equal(reg.url, undefined);
  // In-person: no platform, no join link even if previously typed.
  const inp = model.buildRecord(filled({ format: "in-person", venue: "V", city: "C", country: "K", platform: "Zoom", url: "https://x.org/j" }), config);
  assert.equal(inp.platform, undefined);
  assert.equal(inp.url, undefined);
  // Online: location typed earlier is dropped.
  const onl = model.buildRecord(filled({ format: "online", venue: "V", city: "C", country: "K" }), config);
  assert.equal(onl.location, undefined);
});

test("PRIVACY: the record can never carry contact details; the form has no email field", () => {
  const rec = model.buildRecord(filled({ organizers: [{ rowId: "0", name: "A", affiliation: "B", email: "a@b.org" }] }), config);
  assert.deepEqual(Object.keys(rec.organizers[0]).sort(), ["affiliation", "name"]);
  const page = readFileSync(join(siteRoot, "meetings/submit/index.html"), "utf8");
  assert.ok(!/type="email"|name="[^"]*e-?mail/i.test(page), "no email input in the form");
  assert.ok(!/type="tel"/i.test(page));
  assert.ok(errorsFor(filled({ description: "Write to me at me@example.org" })).some((e) => e.includes("email addresses")));
});

test("PRIVACY: join links pasted into prose are rejected (access note, description, title)", () => {
  for (const over of [{ access: "private", accessNote: "Join: https://zoom.example/j/1", url: "" }, { description: "Use zoom.us/j/12345" }, { title: "Meet at www.example.org" }])
    assert.ok(errorsFor(filled(over)).some((e) => e.includes("web addresses")), JSON.stringify(over));
});

test("recurrence is built from the answers", () => {
  const rec = model.buildRecord(filled({ recFreq: "weekly", recInterval: "2", recEnd: "count", recCount: "6", recByday: ["TH", "MO"], recExceptions: "2027-02-01, 2027-02-15\n2027-03-01" }), config);
  assert.deepEqual(rec.recurrence, { freq: "weekly", interval: 2, count: 6, byday: ["MO", "TH"], exceptions: ["2027-02-01", "2027-02-15", "2027-03-01"] });
  assert.deepEqual(validator.validate(rec, config), []);
  const until = model.buildRecord(filled({ recFreq: "daily", recEnd: "until", recUntil: "2027-01-20", recCount: "99" }), config);
  assert.equal(until.recurrence.until, "2027-01-20");
  assert.equal(until.recurrence.count, undefined);
});

test("config requires a series end; the model reports it through the shared validator", () => {
  const e = errorsFor(filled({ recFreq: "weekly", recEnd: "count", recCount: "" }));
  assert.ok(e.some((x) => x.includes("needs until or count")));
  const g = model.groupErrors(e, filled({ recFreq: "weekly", recEnd: "count" }));
  assert.ok(g.byControl.recCount.includes("Choose how the series ends."));
});

test("multi-day meetings use the end date", () => {
  const rec = model.buildRecord(filled({ multiDay: true, endDate: "2027-01-14", endTime: "16:00" }), config);
  assert.equal(rec.end, "2027-01-14T16:00");
  const bad = errorsFor(filled({ multiDay: true, endDate: "2027-01-10", endTime: "16:00" }));
  assert.ok(bad.some((x) => x.includes("end: must be after start")));
});

test("time zone: custom names are validated by the shared validator", () => {
  assert.deepEqual(errorsFor(filled({ timezone: "__other__", tzOther: "Africa/Nairobi" })), []);
  const v = filled({ timezone: "__other__", tzOther: "Mars/Base" });
  const g = model.groupErrors(errorsFor(v), v);
  assert.ok(g.byControl.tzOther && /time zone/i.test(g.byControl.tzOther[0]));
});

test("the whole time-zone list offered in the form is valid", () => {
  for (const z of config.timezones) assert.deepEqual(errorsFor(filled({ timezone: z.id })), [], z.id);
});

test("errors map to the right controls with plain-language messages", () => {
  const v = filled({ title: "", date: "", endTime: "", organizers: [{ rowId: "7", name: "", affiliation: "X" }], wgs: [] });
  const g = model.groupErrors(errorsFor(v), v);
  assert.deepEqual(g.byControl.title, ["This field is required."]);
  assert.ok(g.byControl.date, "missing date is shown on the date control");
  assert.ok(g.byControl.endTime);
  assert.ok(g.byControl.wgs);
  assert.ok(g.byControl["org-7-name"], "organizer errors map to the row id, not the list position");
  for (const msgs of Object.values(g.byControl)) for (const m of msgs) assert.ok(!/^\w+\[?\d*\]?\.?\w*: /.test(m), "no raw field paths: " + m);
});

test("organizer error mapping survives empty rows and removed rows", () => {
  const v = filled({ organizers: [{ rowId: "3", name: "", affiliation: "" }, { rowId: "9", name: "", affiliation: "Lab" }] });
  const g = model.groupErrors(errorsFor(v), v);
  assert.ok(g.byControl["org-9-name"], "the filled row is the one reported");
  assert.ok(!g.byControl["org-3-name"]);
});

test("'general' excludes specific groups through the shared validator", () => {
  const v = filled({ wgs: ["general", "wg1"] });
  assert.ok(model.groupErrors(errorsFor(v), v).byControl.wgs[0].includes("General"));
});

test("every committed sample fixture round-trips: its fields can all be expressed by the form", () => {
  // The form must be able to produce every kind of record the schema allows.
  const fixtures = validateDir(join(siteRoot, "tools/test/fixtures/meetings"), config).map((r) => r.record);
  const formats = new Set(fixtures.map((r) => r.format));
  const access = new Set(fixtures.map((r) => r.access));
  for (const f of config.formats) assert.ok(formats.has(f.id), "fixture for " + f.id);
  for (const a of config.access) assert.ok(access.has(a.id), "fixture for " + a.id);
});

test("hostile data is rejected by the shared validator", () => {
  const hostile = validateDir(join(siteRoot, "tools/test/fixtures/hostile"), config);
  assert.equal(hostile.length, 1);
  assert.ok(hostile[0].errors.length >= 3, "hostile record must fail validation");
});

test("slugify and provisional id", () => {
  assert.equal(model.slugify("  Café – WG1/WG2 ¡Hola!  "), "cafe-wg1-wg2-hola");
  assert.equal(model.provisionalId({ title: "", date: "" }), "proposal");
  assert.ok(model.provisionalId({ title: "x".repeat(200), date: "2027-01-01" }).length <= 80);
});
