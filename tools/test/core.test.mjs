import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const core = createRequire(import.meta.url)("../../assets/js/meetings-core.js");

const base = (over) => ({
  id: "t", start: "2026-11-10T14:00", end: "2026-11-10T15:00", timezone: "UTC", ...over
});
const starts = (m) => core.expandOccurrences(m).map((o) => o.startLocal);

test("parseLocal accepts real local times and rejects impossible ones", () => {
  assert.deepEqual(core.parseLocal("2026-11-10T14:05"), { y: 2026, mo: 11, d: 10, h: 14, mi: 5 });
  for (const bad of ["2026-02-30T10:00", "2026-11-10 14:00", "2026-11-10T24:00", "2026-11-10", "", null, 5])
    assert.equal(core.parseLocal(bad), null, String(bad));
});

test("wallToInstant converts across zones", () => {
  assert.equal(new Date(core.wallToInstant("2026-11-10T14:00", "UTC")).toISOString(), "2026-11-10T14:00:00.000Z");
  assert.equal(new Date(core.wallToInstant("2026-11-10T14:00", "Europe/Warsaw")).toISOString(), "2026-11-10T13:00:00.000Z");
  assert.equal(new Date(core.wallToInstant("2026-07-10T14:00", "Europe/Warsaw")).toISOString(), "2026-07-10T12:00:00.000Z");
  assert.equal(new Date(core.wallToInstant("2026-11-10T09:00", "Asia/Tokyo")).toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(new Date(core.wallToInstant("2026-12-02T15:00", "America/New_York")).toISOString(), "2026-12-02T20:00:00.000Z");
});

test("wallToInstant handles daylight-saving gaps and overlaps", () => {
  // 2026-03-29 02:30 does not exist in Warsaw (clocks jump 02:00 -> 03:00): resolves forward.
  assert.equal(new Date(core.wallToInstant("2026-03-29T02:30", "Europe/Warsaw")).toISOString(), "2026-03-29T01:30:00.000Z");
  // 2026-10-25 02:30 happens twice: the first (summer time) one is used.
  assert.equal(new Date(core.wallToInstant("2026-10-25T02:30", "Europe/Warsaw")).toISOString(), "2026-10-25T00:30:00.000Z");
});

test("isValidTimeZone", () => {
  assert.ok(core.isValidTimeZone("Europe/Warsaw"));
  assert.ok(!core.isValidTimeZone("Mars/Olympus"));
  assert.ok(!core.isValidTimeZone(""));
  assert.ok(!core.isValidTimeZone(undefined));
});

test("single meeting yields one occurrence with a stable id and duration", () => {
  const [o] = core.expandOccurrences(base({}));
  assert.equal(o.startLocal, "2026-11-10T14:00");
  assert.equal(o.endLocal, "2026-11-10T15:00");
  assert.equal(o.endMs - o.startMs, 3600000);
  assert.equal(o.recurring, false);
});

test("daily and weekly series respect interval and count", () => {
  assert.deepEqual(starts(base({ recurrence: { freq: "daily", interval: 2, count: 3 } })),
    ["2026-11-10T14:00", "2026-11-12T14:00", "2026-11-14T14:00"]);
  assert.deepEqual(starts(base({ recurrence: { freq: "weekly", interval: 2, count: 3 } })),
    ["2026-11-10T14:00", "2026-11-24T14:00", "2026-12-08T14:00"]);
});

test("weekly byday expands several weekdays and never precedes the start", () => {
  // 2026-11-10 is a Tuesday.
  assert.deepEqual(starts(base({ recurrence: { freq: "weekly", byday: ["MO", "TU", "FR"], count: 4 } })),
    ["2026-11-10T14:00", "2026-11-13T14:00", "2026-11-16T14:00", "2026-11-17T14:00"]);
});

test("monthly series skips months without the start day (RFC 5545)", () => {
  const m = base({ start: "2026-01-31T10:00", end: "2026-01-31T11:00", recurrence: { freq: "monthly", count: 4 } });
  assert.deepEqual(starts(m), ["2026-01-31T10:00", "2026-03-31T10:00", "2026-05-31T10:00", "2026-07-31T10:00"]);
});

test("until is inclusive and exceptions are removed but still counted", () => {
  assert.deepEqual(starts(base({ recurrence: { freq: "weekly", until: "2026-11-24" } })),
    ["2026-11-10T14:00", "2026-11-17T14:00", "2026-11-24T14:00"]);
  assert.deepEqual(starts(base({ recurrence: { freq: "weekly", count: 3, exceptions: ["2026-11-17"] } })),
    ["2026-11-10T14:00", "2026-11-24T14:00"]);
});

test("recurring local time is stable across daylight saving", () => {
  const m = base({ start: "2026-10-22T10:00", end: "2026-10-22T11:00", timezone: "Europe/Warsaw",
    recurrence: { freq: "weekly", count: 3 } });
  const occ = core.expandOccurrences(m);
  assert.deepEqual(occ.map((o) => o.startLocal), ["2026-10-22T10:00", "2026-10-29T10:00", "2026-11-05T10:00"]);
  // DST ended on 2026-10-25: the UTC hour shifts, the local hour does not.
  assert.equal(new Date(occ[0].startMs).getUTCHours(), 8);
  assert.equal(new Date(occ[1].startMs).getUTCHours(), 9);
});

test("multi-day events keep their wall-clock duration", () => {
  const [o] = core.expandOccurrences(base({ start: "2026-11-18T09:00", end: "2026-11-19T17:00", timezone: "Europe/Berlin" }));
  assert.equal(o.endLocal, "2026-11-19T17:00");
});

test("runaway series are capped, invalid input yields nothing", () => {
  const long = core.expandOccurrences(base({ recurrence: { freq: "daily", count: 100000 } }), { maxOccurrences: 50 });
  assert.equal(long.length, 50);
  assert.deepEqual(core.expandOccurrences(base({ timezone: "Nope/Zone" })), []);
  assert.deepEqual(core.expandOccurrences(base({ start: "garbage" })), []);
});

test("classify", () => {
  const o = { startMs: 1000, endMs: 2000 };
  assert.equal(core.classify(o, 500), "upcoming");
  assert.equal(core.classify(o, 1500), "ongoing");
  assert.equal(core.classify(o, 2500), "past");
});

test("describeRecurrence", () => {
  assert.equal(core.describeRecurrence({ freq: "weekly", interval: 2, count: 8 }), "Every 2 weeks, 8 meetings");
  assert.equal(core.describeRecurrence({ freq: "monthly", until: "2027-01-01" }), "Every month, until 2027-01-01");
  assert.equal(core.describeRecurrence(undefined), "");
});
