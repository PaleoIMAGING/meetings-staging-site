// Checks a BUILT site (the _site directory produced by Jekyll).
//   node site-test.mjs <_site dir> --empty     the published configuration: no records
//   node site-test.mjs <_site dir> --samples   built with the test fixtures copied in
// Runs the real page scripts in jsdom at a fixed clock (2026-10-08 12:00 UTC).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ICAL from "ical.js";
import { JSDOM, VirtualConsole } from "jsdom";
import { siteRoot } from "./lib.mjs";

const dir = resolve(process.argv[2] || "");
const mode = process.argv.includes("--samples") ? "samples" : "empty";
const read = (p) => readFileSync(join(dir, p), "utf8");
const FIXED = Date.UTC(2026, 9, 8, 12);
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// Homepage is untouched and does not link to the calendar yet.
const home = readFileSync(join(dir, "index.html"));
ok(home.equals(readFileSync(join(siteRoot, "index.html"))), "homepage differs from source");
ok(!/meetings/i.test(home.toString("utf8")), "homepage must not link to meetings yet");

// Feed: valid iCalendar with CRLF endings.
const feed = readFileSync(join(dir, "meetings", "feed.ics"), "utf8");
ok(feed.startsWith("BEGIN:VCALENDAR\r\n") && !/(^|[^\r])\n/.test(feed), "feed is not CRLF");
const comp = new ICAL.Component(ICAL.parse(feed));
const nEvents = comp.getAllSubcomponents("vevent").length;

const html = read("meetings/index.html");
ok(/<meta name="robots" content="noindex/.test(html), "calendar page should be noindex until launch");
ok(/Skip to content/.test(html), "layout missing");

// jsdom ignores CSS, so guard the rule that makes the `hidden` attribute win over display:grid/flex.
ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("assets/css/site.css")), "CSS must keep [hidden] effective");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.message));

function load(url, dom_html) {
  const noExternal = dom_html.replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(noExternal, { url, runScripts: "outside-only", virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.eval(`Date.now = () => ${FIXED};`);
  w.Element.prototype.scrollIntoView = function () {};
  for (const f of ["meetings-core.js", "meetings-ics.js", "meetings-page.js"]) w.eval(readFileSync(join(siteRoot, "assets/js", f), "utf8"));
  return w;
}
const titles = (w) => [...w.document.querySelectorAll("#meeting-list .card h2")].map((h) => h.textContent);

if (mode === "empty") {
  ok(nEvents === 0, "published feed must contain no events");
  ok(!/\[SAMPLE\]|Sample data/.test(html + feed), "sample data leaked into the published site");
  const w = load("https://paleoimaging.github.io/meetings/", html);
  ok(!w.document.getElementById("empty-state").hidden, "empty-state message not shown");
  ok(/No meetings are scheduled yet/.test(w.document.getElementById("empty-state").textContent), "empty-state text");
  ok(w.document.getElementById("filters").hidden, "filters should stay hidden when empty");
  ok(titles(w).length === 0, "no cards expected");
} else {
  ok(nEvents === 8, "expected 8 events in the sample feed, got " + nEvents);
  const w = load("https://paleoimaging.github.io/meetings/", html);
  const up = titles(w);
  ok(up.length === 11 && /WG2 interlab comparison call/.test(up[0]), "upcoming list unexpected: " + up.length);
  ok(/Sample data/.test(html), "sample banner missing");
  w.document.querySelector('[data-view="past"]').click();
  ok(titles(w).length === 4, "past list unexpected");
  w.document.querySelector('[data-view="upcoming"]').click();
  const sel = w.document.getElementById("f-wg");
  sel.value = "wg2";
  sel.dispatchEvent(new w.Event("change"));
  ok(titles(w).length === 4, "WG2 filter unexpected");
  // Hostile query string must not create elements.
  const evil = load("https://paleoimaging.github.io/meetings/?q=%3Cimg%20src%3Dx%3E&wg=%3Cb%3E", html);
  ok(evil.document.querySelectorAll("#meeting-list img, #meeting-list b").length === 0, "query-string injection");
  // Deep link to a past event reveals it.
  const deep = load("https://paleoimaging.github.io/meetings/#sample-past-community-workshop", html);
  ok(!!deep.document.getElementById("sample-past-community-workshop"), "deep link target missing");
  // Embedded JSON cannot break out of its script element.
  const m = html.match(/<script type="application\/json" id="meetings-data">([\s\S]*?)<\/script>/);
  ok(m && !m[1].includes("<"), "unescaped < in embedded JSON");
  JSON.parse(m[1]);
}
ok(errors.length === 0, "page script errors: " + errors.slice(0, 2).join(" | "));
console.log(`site checks (${mode}): ${checks} passed`);
