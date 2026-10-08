import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import ICAL from "ical.js";
import { core, ics, loadConfig, siteRoot, validateDir } from "../lib.mjs";

const config = loadConfig();
const records = validateDir(join(siteRoot, "tools", "test", "fixtures", "meetings"), config).map((r) => r.record);
const STAMP = Date.UTC(2026, 9, 8, 12);
const feed = ics.buildCalendar(records, config, { stamp: STAMP, origin: config.ui.site_url });
const enc = new TextEncoder();

test("escapeText neutralises separators and line breaks", () => {
  assert.equal(ics.escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("foldLine folds at 75 octets without splitting characters", () => {
  const long = "SUMMARY:" + "é".repeat(100) + "😀".repeat(30);
  const lines = ics.foldLine(long).split("\r\n");
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(enc.encode(l).length <= 75, "line too long");
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(""), long);
});

test("feed is RFC-shaped: CRLF only, folded, no blank lines, bracketed", () => {
  assert.ok(feed.startsWith("BEGIN:VCALENDAR\r\n") && feed.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(feed), "bare LF found");
  const physical = feed.split("\r\n").slice(0, -1);
  for (const l of physical) {
    assert.ok(l.length > 0, "blank line");
    assert.ok(enc.encode(l).length <= 75, "line over 75 octets: " + l.slice(0, 40));
  }
  assert.match(feed, /\r\nPRODID:/);
  assert.equal((feed.match(/BEGIN:VEVENT/g) || []).length, 8);
});

test("an empty calendar is still valid", () => {
  const empty = ics.buildCalendar([], config, { stamp: STAMP });
  assert.match(empty, /^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/);
  assert.ok(!empty.includes("VEVENT"));
  new ICAL.Component(ICAL.parse(empty)); // must parse
});

test("an independent parser reads the feed and agrees with our recurrence and time-zone maths", () => {
  const comp = new ICAL.Component(ICAL.parse(feed));
  for (const tzc of comp.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tzc);
  const events = comp.getAllSubcomponents("vevent");
  assert.equal(events.length, 8);

  for (const rec of records) {
    const vevent = events.find((e) => e.getFirstPropertyValue("uid") === `${rec.id}@paleoimaging.github.io`);
    assert.ok(vevent, "missing event " + rec.id);
    const ev = new ICAL.Event(vevent);
    const ours = core.expandOccurrences(rec).map((o) => o.startMs);

    let theirs = [];
    if (ev.isRecurring()) {
      const it = ev.iterator();
      for (let t = it.next(); t && theirs.length < 400; t = it.next()) theirs.push(t.toJSDate().getTime());
    } else theirs = [ev.startDate.toJSDate().getTime()];

    assert.deepEqual(theirs, ours, `${rec.id}: occurrences differ`);

    const first = core.expandOccurrences(rec)[0];
    assert.equal(ev.endDate.toJSDate().getTime(), first.endMs, `${rec.id}: end differs`);
  }
});

test("DST: VTIMEZONE reproduces real offset changes (Europe/Warsaw, autumn 2026)", () => {
  const trs = ics.transitions("Europe/Warsaw", Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
  assert.deepEqual(trs.map((t) => new Date(t.at).toISOString()), ["2026-03-29T01:00:00.000Z", "2026-10-25T01:00:00.000Z"]);
  assert.deepEqual(trs.map((t) => [t.from / 3600000, t.to / 3600000]), [[1, 2], [2, 1]]);
});

test("UTC zones use UTC times, other zones carry TZID and a VTIMEZONE", () => {
  assert.match(feed, /DTSTART:20260715T140000Z\r\n/); // monthly UTC series
  assert.match(feed, /DTSTART;TZID=Europe\/Warsaw:20261014T100000\r\n/);
  assert.match(feed, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Warsaw\r\n/);
  assert.ok(!/TZID:UTC/.test(feed));
});

test("weekly series carry WKST, until becomes an exact UTC bound, exceptions become EXDATE", () => {
  const m = {
    id: "t", title: "T", wgs: ["wg1"], format: "online", access: "public", url: "https://example.org/x",
    start: "2026-11-10T14:00", end: "2026-11-10T15:00", timezone: "Asia/Tokyo",
    recurrence: { freq: "weekly", interval: 2, until: "2026-12-31", exceptions: ["2026-11-24"] }
  };
  const out = ics.buildCalendar([m], config, { stamp: STAMP });
  assert.match(out, /RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;UNTIL=20261222T050000Z\r\n/); // 2026-12-22 14:00 JST
  assert.match(out, /EXDATE;TZID=Asia\/Tokyo:20261124T140000\r\n/);
});

test("private joins never reach the feed; cancelled maps to STATUS:CANCELLED", () => {
  assert.ok(!feed.includes("private.example"));
  const cancelled = feed.split("BEGIN:VEVENT").find((b) => b.includes("sample-wg3-cancelled-tutorial"));
  assert.match(cancelled, /STATUS:CANCELLED\r\n/);
  const priv = feed.split("BEGIN:VEVENT").find((b) => b.includes("sample-wg1-wg2-joint-session"));
  assert.match(priv, /URL:https:\/\/paleoimaging\.github\.io\/meetings\/#sample-wg1-wg2-joint-session\r\n/);
});

test("hostile text cannot inject extra properties", () => {
  const m = {
    id: "t", title: "x\r\nBEGIN:VEVENT\r\nSUMMARY:pwned", wgs: ["wg1"], format: "online", access: "public",
    url: "https://example.org/x", start: "2026-11-10T14:00", end: "2026-11-10T15:00", timezone: "UTC"
  };
  const out = ics.buildCalendar([m], config, { stamp: STAMP });
  assert.equal((out.match(/^BEGIN:VEVENT/gm) || []).length, 1);
  const unfolded = out.split("\r\n ").join("");
  assert.ok(unfolded.includes("SUMMARY:x\\nBEGIN:VEVENT\\nSUMMARY:pwned"), "newlines must be escaped, not emitted");
  assert.ok(!/\r\nSUMMARY:pwned/.test(out));
});

test("per-event download is a standalone UTC file", () => {
  const m = records.find((r) => r.id === "sample-wg2-biweekly-calls");
  const [occ] = core.expandOccurrences(m);
  const one = ics.buildOccurrenceIcs(m, occ, { nowMs: STAMP, origin: config.ui.site_url, config });
  assert.match(one, /DTSTART:20261014T080000Z\r\n/);
  assert.ok(!one.includes("RRULE"));
  assert.ok(!/(^|[^\r])\n/.test(one));
});
