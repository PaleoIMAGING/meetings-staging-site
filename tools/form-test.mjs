// Behavioural tests for the submission form, run against the BUILT site.
//   node form-test.mjs <_site dir>
//   node form-test.mjs <_site dir> --live-fixture <_site dir>   (community preview only, see below)
// Loads meetings/submit/index.html in jsdom with the real scripts (the same
// files the browser loads) and drives it with DOM events.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import YAML from "yaml";
import { siteRoot, loadConfig } from "./lib.mjs";

const dir = resolve(process.argv[2] || "");
const config = loadConfig();

// COMMUNITY PREVIEW (staging repo only). The preview is detected explicitly: `preview: true` in _config.yml
// AND submissions disabled in _data/meetings_submission.yml. A non-empty baseurl is NOT used for this.
// In that case the page under <_site dir> is the real, review-only preview. All behavioural tests (validation,
// conditional fields, accessibility, sending and error handling against a fake Worker) still run, against a
// throw-away build made with production-style submission settings (--live-fixture; fixture values live in
// tools/test/fixtures/submission-live.yml, nothing is deployed and fetch/Turnstile are fakes). Extra tests then
// assert that the real preview itself cannot submit. Without the preview flag the suite is unchanged.
const siteConfig = YAML.parse(readFileSync(join(siteRoot, "_config.yml"), "utf8"));
const submission = YAML.parse(readFileSync(join(siteRoot, "_data", "meetings_submission.yml"), "utf8")) || {};
const PREVIEW = siteConfig.preview === true && submission.enabled !== true;
const BASEURL = String(siteConfig.baseurl || "").replace(/\/$/, "");
const fixtureArg = process.argv.indexOf("--live-fixture");
if (PREVIEW && fixtureArg < 0) { console.error("preview mode needs --live-fixture <_site dir built with the live submission fixture>"); process.exit(2); }
const previewHtml = readFileSync(join(dir, "meetings", "submit", "index.html"), "utf8");
const html = PREVIEW ? readFileSync(join(resolve(process.argv[fixtureArg + 1] || ""), "meetings", "submit", "index.html"), "utf8") : previewHtml;
const FIXED = Date.UTC(2026, 9, 8, 12);
const SCRIPTS = ["meetings-core.js", "meetings-validate.js", "meetings-ics.js", "meetings-render.js", "meetings-form-model.js", "meetings-form.js"];

const results = [];
const pending = [];
const test = (name, fn) => {
  pending.push((async () => {
    try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name, e]); }
  })());
};

// reviewOnly: remove the generated #submission-config (what a build with submissions off looks like to the script).
// fetchImpl / turnstile: fakes for the one allowed network call and the Cloudflare widget.
function load({ detectedTz, draft, reviewOnly, fetchImpl, turnstile = true } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  let bare = html.replace(/<script src="[^"]*"><\/script>/g, "");
  if (reviewOnly) bare = bare.replace(/<div id="submission-config"[^>]*><\/div>/, "");
  const dom = new JSDOM(bare, { url: "https://paleoimaging.github.io/meetings/submit/", runScripts: "outside-only", virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  if (draft) w.sessionStorage.setItem("paleoimaging.meetings.submit.draft.v1", draft);
  w.eval(`Date.now = () => ${FIXED};`);
  w.Element.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  const calls = [];
  w.fetch = (...a) => { calls.push(["fetch", a]); if (!fetchImpl) throw new Error("network must not be used"); return fetchImpl(...a); };
  const widget = { renders: [], resets: 0 };
  if (turnstile) w.turnstile = { render: (sel, opts) => { widget.renders.push({ sel, opts }); return "wid" + widget.renders.length; }, reset: () => { widget.resets++; } };
  w.XMLHttpRequest = function () { calls.push(["xhr"]); throw new Error("network must not be used"); };
  w.navigator.sendBeacon = (...a) => { calls.push(["beacon", a]); return false; };
  if (detectedTz) w.eval(`Intl.DateTimeFormat = (function (O) { return function (l, o) { var f = new O(l, o); if (!o) { f.resolvedOptions = function () { return { timeZone: "${detectedTz}" }; }; } return f; }; })(Intl.DateTimeFormat);`);
  for (const f of SCRIPTS) w.eval(readFileSync(join(siteRoot, "assets/js", f), "utf8"));
  return { w, d: w.document, errors, calls, widget };
}

const q = (d, sel) => d.querySelector(sel);
const qa = (d, sel) => [...d.querySelectorAll(sel)];
const ev = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const ctl = (d, name) => d.querySelector(`#submit-form [name="${name}"]`);
const type = (w, d, name, value) => {
  const el = ctl(d, name);
  el.value = value;
  ev(w, el, "input");
  ev(w, el, "change");
  el.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true }));
};
const choose = (w, d, name, value) => {
  const el = q(d, `#submit-form input[name="${name}"][value="${value}"]`);
  el.checked = true;
  ev(w, el, "change");
};
const check = (w, d, name, value, on = true) => {
  const el = q(d, `#submit-form input[name="${name}"][value="${value}"]`);
  el.checked = on;
  ev(w, el, "change");
};
const visible = (d, key) => !q(d, `[data-show="${key}"]`).hidden;
const submit = (w, d) => q(d, "#submit-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));

function fillValid(w, d, over = {}) {
  type(w, d, "title", over.title ?? "WG2 interlab call");
  type(w, d, "description", "Monthly call for the interlab comparison.");
  type(w, d, "type", "wg-meeting");
  check(w, d, "wgs", "wg2");
  type(w, d, "date", "2027-01-12");
  type(w, d, "startTime", "10:00");
  type(w, d, "endTime", "11:00");
  type(w, d, "timezone", "Europe/Warsaw");
  choose(w, d, "format", "online");
  type(w, d, "platform", "Zoom");
  choose(w, d, "access", over.access ?? "public");
  if ((over.access ?? "public") === "public") type(w, d, "url", "https://example.org/join");
  type(w, d, "org-0-name", "A. Person");
  type(w, d, "org-0-affiliation", "Example University");
}

// ---------------------------------------------------------------- structure
test("loads without script errors and shows the public-visibility notice", () => {
  const { d, errors } = load();
  assert.deepEqual(errors, []);
  assert.match(q(d, "#privacy-notice").textContent, /public GitHub pull request/i);
  assert.match(q(d, "#privacy-notice").textContent, /before an administrator approves/i);
  assert.match(q(d, "#privacy-notice").textContent, /Never enter private join links/i);
  assert.match(q(d, "h1").textContent, /Propose a meeting/);
  assert.match(q(d, ".lead").textContent, /approved by administrators/i);
});

test("four sections in the requested order", () => {
  const { d } = load();
  const heads = qa(d, "form > section > h2").map((h) => h.textContent.replace(/\s+/g, " ").trim());
  assert.deepEqual(heads, ["1 Meeting information", "2 Date & Time", "3 Location & Access", "4 Organizer"]);
});

test(PREVIEW ? "page is noindex (preview) and not linked from the site navigation" : "page is indexable and not linked from the site navigation", () => {
  const { d } = load();
  if (PREVIEW) assert.equal(q(d, 'meta[name="robots"]').content, "noindex, nofollow");
  else assert.ok(!q(d, 'meta[name="robots"]'), "noindex removed");
  const nav = qa(d, "header nav a").map((a) => a.getAttribute("href"));
  assert.ok(!nav.some((h) => /submit/.test(h)), "no submit link in navigation");
});

// ------------------------------------------------------------ accessibility
test("A11Y: every control has an accessible name", () => {
  const { d } = load();
  for (const c of qa(d, "input, select, textarea")) {
    if (c.type === "hidden") continue;
    assert.ok(c.labels && c.labels.length > 0, `control ${c.name || c.id} has no <label>`);
    assert.ok(c.labels[0].textContent.trim().length > 0, `empty label for ${c.name}`);
  }
});

test("A11Y: radio and checkbox groups sit in a fieldset with a legend", () => {
  const { d } = load();
  for (const name of ["wgs", "format", "access", "recEnd", "recByday"]) {
    const fs = q(d, `input[name="${name}"]`).closest("fieldset");
    assert.ok(fs && fs.querySelector("legend"), name + " needs a fieldset/legend");
  }
});

test("A11Y: native interactive elements only; no positive tabindex; no clickable divs", () => {
  const { d } = load();
  for (const el of qa(d, "[tabindex]")) assert.ok(Number(el.getAttribute("tabindex")) <= 0, "positive tabindex on " + el.outerHTML.slice(0, 60));
  assert.equal(qa(d, "[onclick], [role=button]").length, 0);
  for (const b of qa(d, "button")) assert.ok(b.getAttribute("type"), "button without explicit type: " + b.textContent);
});

test("A11Y: every input has a hint/error association and every error slot is a live, initially hidden element", () => {
  const { d } = load();
  for (const e of qa(d, ".error[data-error-for]")) {
    if (e.closest("template")) continue;
    assert.ok(e.hidden, "error visible on load: " + e.id);
    if (e.id === "e-organizers") continue; // container-level message, focus goes to the first row
    const ctl = d.getElementById("f-" + e.getAttribute("data-error-for"));
    assert.ok(ctl, "no control for " + e.id);
    if (ctl.tagName !== "FIELDSET") assert.ok((ctl.getAttribute("aria-describedby") || "").split(/\s+/).includes(e.id), `${ctl.id} not described by ${e.id}`);
  }
});

test("A11Y: required fields are marked visually, in text and with aria-required", () => {
  const { d } = load();
  for (const key of ["title", "type", "date", "startTime", "endTime", "timezone", "org-0-name"]) {
    const field = q(d, `.field[data-field="${key}"]`);
    assert.ok(field.classList.contains("is-required"), key + " should be required");
    assert.equal(d.getElementById("f-" + key).getAttribute("aria-required"), "true", key);
    assert.match(field.querySelector(".req-sr").textContent, /required/);
  }
  for (const key of ["wgs", "format", "access"]) {
    assert.match(q(d, `[data-field="${key}"] .req-sr`).textContent, /required/, key);
  }
  for (const key of ["description", "address", "platform", "org-0-affiliation"]) {
    assert.ok(!q(d, `.field[data-field="${key}"]`)?.classList.contains("is-required"), key + " is optional");
  }
});

test("A11Y: submit for review is a real submit button, so Enter and Space work natively", () => {
  const { d } = load();
  assert.equal(q(d, "#review-btn").type, "submit");
  assert.equal(q(d, "#review-btn").closest("form").id, "submit-form");
});

// ------------------------------------------------------------ conditional UI
test("CONDITIONAL: format shows location and platform appropriately", () => {
  const { w, d } = load();
  assert.deepEqual([visible(d, "location"), visible(d, "platform")], [false, false]);
  choose(w, d, "format", "online");
  assert.deepEqual([visible(d, "location"), visible(d, "platform")], [false, true]);
  choose(w, d, "format", "in-person");
  assert.deepEqual([visible(d, "location"), visible(d, "platform")], [true, false]);
  choose(w, d, "format", "hybrid");
  assert.deepEqual([visible(d, "location"), visible(d, "platform")], [true, true]);
});

test("CONDITIONAL: access shows exactly one link field, and none for in-person public", () => {
  const { w, d } = load();
  choose(w, d, "format", "online");
  for (const [access, shown] of [["public", "url"], ["registration", "registrationUrl"], ["private", "accessNote"]]) {
    choose(w, d, "access", access);
    for (const k of ["url", "registrationUrl", "accessNote"]) assert.equal(visible(d, k), k === shown, `${access}/${k}`);
  }
  choose(w, d, "format", "in-person");
  choose(w, d, "access", "public");
  assert.ok(!visible(d, "url"), "in-person meetings have no join link");
});

test("CONDITIONAL: required markers follow the chosen format and access", () => {
  const { w, d } = load();
  assert.ok(!q(d, '.field[data-field="venue"]').classList.contains("is-required"));
  choose(w, d, "format", "hybrid");
  for (const k of ["venue", "city", "country"]) assert.ok(q(d, `.field[data-field="${k}"]`).classList.contains("is-required"), k);
  assert.ok(!q(d, '.field[data-field="address"]').classList.contains("is-required"));
  choose(w, d, "format", "online");
  choose(w, d, "access", "registration");
  assert.ok(q(d, '.field[data-field="registrationUrl"]').classList.contains("is-required"));
});

test("CONDITIONAL: recurrence reveals interval, end condition, weekdays and skipped dates", () => {
  const { w, d } = load();
  for (const k of ["recInterval", "recEnd", "recCount", "recUntil", "recByday", "recExceptions"]) assert.ok(!visible(d, k), k + " hidden by default");
  type(w, d, "recFreq", "weekly");
  for (const k of ["recInterval", "recEnd", "recCount", "recByday", "recExceptions"]) assert.ok(visible(d, k), k);
  assert.ok(!visible(d, "recUntil"));
  choose(w, d, "recEnd", "until");
  assert.ok(visible(d, "recUntil") && !visible(d, "recCount"));
  type(w, d, "recFreq", "monthly");
  assert.ok(!visible(d, "recByday"), "weekdays only for weekly");
  assert.ok(visible(d, "recMonthly"), "monthly offers date-or-weekday");
  type(w, d, "recFreq", "weekly");
  assert.ok(!visible(d, "recMonthly"));
  type(w, d, "recFreq", "monthly");
  assert.match(q(d, "#rec-unit").textContent, /month/);
  type(w, d, "recFreq", "none");
  assert.ok(!visible(d, "recEnd"));
});

test("CONDITIONAL: multi-day and custom time zone fields", () => {
  const { w, d } = load();
  assert.ok(!visible(d, "endDate") && !visible(d, "tzOther"));
  q(d, "#f-multiDay").checked = true; ev(w, q(d, "#f-multiDay"), "change");
  assert.ok(visible(d, "endDate"));
  type(w, d, "timezone", "__other__");
  assert.ok(visible(d, "tzOther"));
});

test("WGs: General excludes specific groups, and vice versa", () => {
  const { w, d } = load();
  check(w, d, "wgs", "wg1"); check(w, d, "wgs", "wg3");
  check(w, d, "wgs", "general");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value), ["general"]);
  check(w, d, "wgs", "wg2");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value), ["wg2"]);
  check(w, d, "wgs", "wg4");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value).sort(), ["wg2", "wg4"]);
});

test("SC is offered, combines with WGs, and General excludes it", () => {
  const { w, d } = load();
  assert.ok(q(d, 'input[name="wgs"][value="sc"]'), "SC checkbox missing");
  check(w, d, "wgs", "sc"); check(w, d, "wgs", "wg2");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value).sort(), ["sc", "wg2"]);
  check(w, d, "wgs", "general");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value), ["general"]);
  check(w, d, "wgs", "sc");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value), ["sc"]);
});

test("options come from the config (types, WGs, formats, access, zones)", () => {
  const { d } = load();
  const vals = (sel) => qa(d, sel).map((o) => o.value).filter(Boolean);
  assert.deepEqual(vals("#f-type option"), config.types.filter((t) => t.active !== false).map((t) => t.id));
  assert.deepEqual(qa(d, 'input[name="wgs"]').map((i) => i.value), config.wgs.filter((w) => w.active !== false).map((w) => w.id));
  assert.deepEqual(qa(d, 'input[name="format"]').map((i) => i.value), config.formats.map((f) => f.id));
  assert.deepEqual(qa(d, 'input[name="access"]').map((i) => i.value), config.access.map((a) => a.id));
  assert.equal(vals("#f-timezone option").filter((v) => v !== "__other__").length, config.timezones.length);
  assert.equal(q(d, "#f-title").maxLength, config.limits.title);
  assert.equal(q(d, "#f-description").maxLength, config.limits.description);
});

// ------------------------------------------------------ validation behaviour
test("VALIDATION: nothing is flagged before the user touches a field", () => {
  const { d } = load();
  assert.equal(qa(d, ".error:not([hidden])").length, 0);
  assert.ok(q(d, "#error-summary").hidden);
});

test("VALIDATION: inline error on blur, with aria-invalid, and it clears when fixed", () => {
  const { w, d } = load();
  const title = q(d, "#f-title");
  title.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true }));
  assert.ok(!q(d, "#e-title").hidden);
  assert.match(q(d, "#e-title").textContent, /required/i);
  assert.equal(title.getAttribute("aria-invalid"), "true");
  type(w, d, "title", "A real title");
  assert.ok(q(d, "#e-title").hidden);
  assert.equal(title.getAttribute("aria-invalid"), null);
});

test("VALIDATION: messages are in plain language and never show raw field paths", () => {
  const { w, d } = load();
  type(w, d, "title", "x".repeat(config.limits.title)); // exactly at the limit: fine
  assert.ok(q(d, "#e-title").hidden);
  type(w, d, "timezone", "Europe/Warsaw");
  type(w, d, "date", "2027-01-12"); type(w, d, "startTime", "12:00"); type(w, d, "endTime", "11:00");
  assert.match(q(d, "#e-endTime").textContent, /end must be after the start/i);
  type(w, d, "timezone", "__other__"); type(w, d, "tzOther", "Mars/Base");
  assert.match(q(d, "#e-tzOther").textContent, /time zone/i);
  for (const e of qa(d, ".error:not([hidden])")) assert.ok(!/[a-z_]+\.[a-z_]+:|\[\d\]/.test(e.textContent), e.textContent);
});

test("VALIDATION: reviewing an empty form shows a summary, moves focus to it, and links jump to fields", () => {
  const { w, d } = load();
  submit(w, d);
  const box = q(d, "#error-summary");
  assert.ok(!box.hidden);
  assert.equal(d.activeElement, box, "focus moves to the error summary");
  assert.equal(box.getAttribute("role"), "alert");
  const links = qa(d, "#error-summary-list a");
  assert.ok(links.length >= 7, "expected several problems, got " + links.length);
  assert.ok(q(d, "#review-panel").hidden, "no preview while there are errors");
  links[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(d.activeElement.id, "f-title", "first link focuses the first problem");
  assert.ok(qa(d, ".error:not([hidden])").length >= 7, "all errors are now shown inline");
});

test("VALIDATION: entered data is preserved when validation fails", () => {
  const { w, d } = load();
  type(w, d, "title", "My workshop");
  type(w, d, "description", "Keep this text");
  check(w, d, "wgs", "wg3");
  choose(w, d, "format", "in-person");
  type(w, d, "venue", "Hall A");
  submit(w, d); // fails: date, city, ...
  assert.equal(q(d, "#f-title").value, "My workshop");
  assert.equal(q(d, "#f-description").value, "Keep this text");
  assert.equal(q(d, 'input[name="wgs"][value="wg3"]').checked, true);
  assert.equal(q(d, 'input[name="format"][value="in-person"]').checked, true);
  assert.equal(q(d, "#f-venue").value, "Hall A");
});

test("VALIDATION: summary lists problems in page order, with friendly wording", () => {
  const { w, d } = load();
  submit(w, d);
  const texts = qa(d, "#error-summary-list li").map((li) => li.textContent);
  const labels = texts.map((s) => s.split(":")[0]);
  assert.deepEqual(labels.slice(0, 3), ["Meeting title", "Meeting type", "Working Group(s)"]);
  assert.ok(labels.indexOf("Date") < labels.indexOf("Format") && labels.indexOf("Format") < labels.indexOf("Who can take part?"), labels.join(" | "));
  assert.ok(texts.some((s) => /Choose at least one Working Group/.test(s)));
  assert.ok(!texts.some((s) => /non-empty list/.test(s)));
});

test("VALIDATION: the summary updates as problems are fixed", () => {
  const { w, d } = load();
  submit(w, d);
  const before = qa(d, "#error-summary-list li").length;
  type(w, d, "title", "Now filled");
  assert.ok(qa(d, "#error-summary-list li").length < before);
});

test("VALIDATION: organizer rows can be added, removed and are limited by the config", () => {
  const { w, d } = load();
  const rows = () => qa(d, "[data-organizer]").length;
  assert.equal(rows(), 1);
  assert.ok(q(d, ".organizer__remove").hidden, "cannot remove the only organizer");
  while (!q(d, "#add-organizer").disabled) q(d, "#add-organizer").click();
  assert.equal(rows(), config.limits.organizers);
  q(d, ".organizer__remove").click();
  assert.equal(rows(), config.limits.organizers - 1);
  assert.ok(!q(d, "#add-organizer").disabled);
  const ids = qa(d, "[data-organizer] input[name$='-name']").map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "row ids stay unique");
});

test("VALIDATION: an error on the second organizer lands on that row", () => {
  const { w, d } = load();
  q(d, "#add-organizer").click();
  type(w, d, "org-1-affiliation", "Lab only");
  submit(w, d);
  assert.ok(!q(d, "#e-org-1-name").hidden, "the filled row is flagged");
  assert.ok(q(d, "#e-org-0-name").hidden, "an untouched empty row is ignored");
});

// ------------------------------------------------------------- review / preview
test("REVIEW: a valid form shows a preview identical in structure to the calendar card", () => {
  const { w, d } = load();
  fillValid(w, d);
  submit(w, d);
  assert.ok(q(d, "#error-summary").hidden);
  const panel = q(d, "#review-panel");
  assert.ok(!panel.hidden);
  assert.equal(d.activeElement, q(d, "#review-title"), "focus moves to the review heading");
  const card = q(d, "#preview-list .card");
  assert.ok(card);
  assert.equal(card.querySelector("h3").textContent, "WG2 interlab call");
  assert.match(card.querySelector(".when").textContent, /12 Jan 2027, 10:00–11:00/);
  assert.match(card.textContent, /Zoom/);
  const rec = JSON.parse(q(d, "#record-json").textContent);
  assert.equal(rec.title, "WG2 interlab call");
  assert.equal(rec.wgs[0], "wg2");
  assert.equal(q(d, "#past-warning").hidden, true);
});

test("REVIEW: editing after review hides the stale preview", () => {
  const { w, d } = load();
  fillValid(w, d);
  submit(w, d);
  type(w, d, "title", "Changed");
  assert.ok(q(d, "#review-panel").hidden);
});

test("REVIEW: a date in the past is flagged but not blocked", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "date", "2026-01-12");
  submit(w, d);
  assert.ok(!q(d, "#review-panel").hidden);
  assert.ok(!q(d, "#past-warning").hidden);
});

test("REVIEW: recurring proposals preview as a series", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "recFreq", "weekly"); type(w, d, "recInterval", "2"); type(w, d, "recCount", "6");
  submit(w, d);
  assert.match(q(d, "#preview-list").textContent, /Every 2 weeks, 6 meetings/);
  assert.deepEqual(JSON.parse(q(d, "#record-json").textContent).recurrence, { freq: "weekly", interval: 2, count: 6 });
});

test("REVIEW: 'same weekday each month' previews and submits as the second Thursday", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "date", "2026-11-12");
  type(w, d, "recFreq", "monthly"); type(w, d, "recMonthly", "weekday"); type(w, d, "recInterval", "1"); type(w, d, "recCount", "3");
  assert.match(q(d, "#h-recMonthly").textContent, /second Thursday of every month/);
  submit(w, d);
  assert.match(q(d, "#preview-list").textContent, /Every month on the second Thursday, 3 meetings/);
  assert.deepEqual(JSON.parse(q(d, "#record-json").textContent).recurrence, { freq: "monthly", interval: 1, count: 3, byday: ["2TH"] });
});

test("REVIEW: a series without an end is rejected with a clear message", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "recFreq", "weekly");
  submit(w, d);
  assert.ok(q(d, "#review-panel").hidden);
  assert.match(q(d, "#error-summary").textContent, /how the series ends/i);
});

// ------------------------------------------------------------------ sending
const ENDPOINT = "https://paleoimaging-meetings-portal.andrebelem.workers.dev/submit/meeting";
const reply = (status, body) => Promise.resolve({ status, text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)) });
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const solve = (widget, t = "tok-1") => widget.renders[widget.renders.length - 1].opts.callback(t);
function toReview(ctx, over) {
  fillValid(ctx.w, ctx.d, over);
  submit(ctx.w, ctx.d);
  assert.ok(!q(ctx.d, "#review-panel").hidden, "review panel shown");
}
const OK_REPLY = { ok: true, requestId: "r1", pullRequest: { number: 7, url: "https://github.com/PaleoIMAGING/paleoimaging.github.io/pull/7" } };

test("SEND: nothing is sent before the person submits; the widget uses the production site key and action; button waits for verification", () => {
  const ctx = load({ fetchImpl: () => reply(201, OK_REPLY) });
  const { d, calls, widget } = ctx;
  assert.equal(calls.length, 0);
  toReview(ctx);
  assert.equal(calls.length, 0, "reviewing sends nothing");
  assert.equal(widget.renders.length, 1);
  assert.equal(widget.renders[0].sel, "#turnstile-box");
  assert.equal(widget.renders[0].opts.sitekey, "0x4AAAAAAFR4AjdSJ4lSLm26");
  assert.equal(widget.renders[0].opts.action, "meeting_submit");
  assert.ok(q(d, "#submit-btn").disabled, "disabled until the check is solved");
  q(d, "#submit-btn").click();
  assert.equal(calls.length, 0, "a disabled-state click sends nothing");
  solve(widget);
  assert.ok(!q(d, "#submit-btn").disabled);
  assert.equal(q(d, "#submit-btn").getAttribute("aria-disabled"), "false");
});

test("SEND: success posts exactly record + token + honeypot to the Worker, then shows the awaiting-approval confirmation", async () => {
  const ctx = load({ fetchImpl: () => reply(201, OK_REPLY) });
  const { w, d, calls, widget } = ctx;
  toReview(ctx);
  solve(widget, "tok-abc");
  q(d, "#submit-btn").click();
  assert.equal(q(d, "#submit-btn").textContent, "Sending…");
  assert.ok(q(d, "#submit-btn").disabled, "locked while sending");
  q(d, "#submit-btn").click(); // double click
  await tick();
  assert.equal(calls.length, 1, "exactly one request");
  const [url, init] = calls[0][1];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.headers["content-type"], "application/json");
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["record", "turnstile_token", "website"]);
  assert.equal(body.turnstile_token, "tok-abc");
  assert.equal(body.website, "");
  assert.equal(body.record.title, "WG2 interlab call");
  assert.ok(q(d, "#submit-form").hidden && q(d, "#review-panel").hidden);
  assert.ok(!q(d, "#success-panel").hidden);
  assert.match(q(d, "#success-panel").textContent, /awaiting approval by an administrator/i);
  assert.equal(q(d, "#success-ref a").getAttribute("href"), "https://github.com/PaleoIMAGING/paleoimaging.github.io/pull/7");
  assert.equal(q(d, "#success-ref a").rel, "noopener noreferrer");
  assert.equal(w.sessionStorage.getItem("paleoimaging.meetings.submit.draft.v1"), null, "draft removed after success");
  assert.ok(widget.resets >= 1, "token is never reused");
});

test("SEND: a filled honeypot is passed on to the Worker unchanged", async () => {
  const ctx = load({ fetchImpl: () => reply(201, { ok: true, requestId: "r" }) });
  toReview(ctx);
  ctx.d.querySelector('input[name="website"]').value = "http://spam.example";
  solve(ctx.widget);
  q(ctx.d, "#submit-btn").click();
  await tick();
  assert.equal(JSON.parse(ctx.calls[0][1][1].body).website, "http://spam.example");
  assert.equal(q(ctx.d, "#success-ref").hidden, true, "no pull-request link when none was returned");
});

test("SEND: a pull-request link outside the PaleoIMAGING organisation is never rendered", async () => {
  const ctx = load({ fetchImpl: () => reply(201, { ok: true, pullRequest: { number: 1, url: "https://evil.example/x" } }) });
  toReview(ctx);
  solve(ctx.widget);
  q(ctx.d, "#submit-btn").click();
  await tick();
  assert.equal(q(ctx.d, "#success-ref a"), null);
  assert.ok(!q(ctx.d, "#success-panel").hidden);
});

const FAILURES = [
  ["duplicate (409)", 409, { ok: false, error: "duplicate" }, /already been received/i],
  ["rate limited (429)", 429, { ok: false, error: "rate_limited" }, /too many submissions/i],
  ["queue full (429)", 429, { ok: false, error: "queue_full" }, /waiting for review/i],
  ["server validation (422)", 422, { ok: false, error: "validation_failed", fields: ["title", "start"] }, /problem with the proposal \(title, start\)/i],
  ["verification failed (403)", 403, { ok: false, error: "turnstile_failed" }, /verification check failed or expired/i],
  ["not open yet (503 disabled)", 503, { ok: false, error: "disabled" }, /not open yet/i],
  ["service down (502)", 502, { ok: false, error: "upstream_error" }, /temporarily unavailable/i],
  ["service down (500, non-JSON body)", 500, "<html>oops</html>", /temporarily unavailable/i]
];
for (const [label, status, body, rx] of FAILURES) {
  test(`SEND: ${label}: clear message, answers kept, new verification required, nothing duplicated`, async () => {
    const ctx = load({ fetchImpl: () => reply(status, body) });
    const { d, w, calls, widget } = ctx;
    toReview(ctx);
    solve(widget, "tok-1");
    q(d, "#submit-btn").click();
    await tick();
    const msg = q(d, "#submit-message");
    assert.ok(!msg.hidden, "message shown");
    assert.match(msg.textContent, rx);
    assert.equal(msg.getAttribute("role"), "alert");
    assert.equal(q(d, "#f-title").value, "WG2 interlab call", "form contents kept");
    assert.ok(q(d, "#submit-form").hidden === false && !q(d, "#review-panel").hidden, "still on the review step");
    assert.ok(q(d, "#success-panel").hidden);
    assert.ok(q(d, "#submit-btn").disabled, "single-use token spent: must verify again");
    assert.ok(widget.resets >= 1, "widget reset");
    assert.ok(w.sessionStorage.getItem("paleoimaging.meetings.submit.draft.v1"), "draft still stored");
    // Retry with a fresh token produces exactly one more request, with the new token.
    solve(widget, "tok-2");
    q(d, "#submit-btn").click();
    await tick();
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1][1][1].body).turnstile_token, "tok-2");
  });
}

test("SEND: a network failure keeps the answers and the retry says 'already received' if the first attempt got through", async () => {
  let n = 0;
  const ctx = load({ fetchImpl: () => (++n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : reply(409, { ok: false, error: "duplicate" })) });
  const { d, widget } = ctx;
  toReview(ctx);
  solve(widget, "a");
  q(d, "#submit-btn").click();
  await tick();
  assert.match(q(d, "#submit-message").textContent, /could not reach the submission service/i);
  assert.match(q(d, "#submit-message").textContent, /nothing is duplicated/i);
  assert.equal(q(d, "#f-title").value, "WG2 interlab call");
  solve(widget, "b");
  q(d, "#submit-btn").click();
  await tick();
  assert.match(q(d, "#submit-message").textContent, /already been received/i);
});

test("SEND: Worker-supplied text is never inserted as markup", async () => {
  const ctx = load({ fetchImpl: () => reply(422, { ok: false, error: "validation_failed", message: "<img src=x onerror=1>", fields: ["<b>x</b>"] }) });
  toReview(ctx);
  solve(ctx.widget);
  q(ctx.d, "#submit-btn").click();
  await tick();
  assert.equal(qa(ctx.d, "#submit-message img, #submit-message b").length, 0);
});

test("SEND: editing after review hides the review step and disables sending", () => {
  const ctx = load({ fetchImpl: () => reply(201, OK_REPLY) });
  toReview(ctx);
  solve(ctx.widget);
  assert.ok(!q(ctx.d, "#submit-btn").disabled);
  type(ctx.w, ctx.d, "title", "Changed");
  assert.ok(q(ctx.d, "#review-panel").hidden);
  assert.ok(q(ctx.d, "#submit-btn").disabled);
  assert.equal(ctx.calls.length, 0);
});

test("SEND: the Cloudflare script is loaded only when needed, from challenges.cloudflare.com, and its failure is explained", () => {
  const ctx = load({ turnstile: false, fetchImpl: () => reply(201, OK_REPLY) });
  const { w, d } = ctx;
  assert.equal(qa(d, 'script[src*="cloudflare"]').length, 0, "not loaded with the page");
  toReview(ctx);
  const s = q(d, 'head script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
  assert.ok(s, "script added on review");
  assert.ok(/render=explicit/.test(s.src));
  s.onerror();
  assert.match(q(d, "#submit-message").textContent, /did not load/i);
  assert.ok(q(d, "#submit-btn").disabled);
  assert.equal(ctx.calls.length, 0);
});

test("SEND: without #submission-config the form stays review-only and never sends anything", () => {
  const ctx = load({ reviewOnly: true });
  const { w, d, calls } = ctx;
  fillValid(w, d);
  submit(w, d);
  const btn = q(d, "#submit-btn");
  assert.ok(!q(d, "#review-panel").hidden);
  btn.disabled = false; // even if force-enabled in dev tools
  btn.click();
  assert.match(q(d, "#form-status").textContent, /not enabled/i);
  assert.deepEqual(calls, []);
  assert.equal(ctx.widget.renders.length, 0, "no Turnstile widget");
});

test("SEND: the only network code is the single POST in the form script, and the page offers no HTML form action", () => {
  const src = readFileSync(join(siteRoot, "assets/js/meetings-form.js"), "utf8");
  assert.equal((src.match(/\bfetch\s*\(/g) || []).length, 1, "one fetch call");
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket|\.submit\(\)|localStorage/.test(src));
  const { d } = load();
  assert.equal(q(d, "#submit-form").getAttribute("action"), null);
  const cfgEl = q(d, "#submission-config");
  assert.equal(cfgEl.getAttribute("data-endpoint"), ENDPOINT);
  assert.ok(!/staging|localhost/i.test(PREVIEW ? html.split(BASEURL).join("") : html), "no staging or local address in the page");
  assert.ok(!/secret|private[_ -]?key/i.test(cfgEl.outerHTML), "only public values in the config element");
});

test("SEND: Propose another meeting returns to an empty form", async () => {
  const ctx = load({ fetchImpl: () => reply(201, OK_REPLY) });
  toReview(ctx);
  solve(ctx.widget);
  q(ctx.d, "#submit-btn").click();
  await tick();
  q(ctx.d, "#another-btn").click();
  assert.ok(!q(ctx.d, "#submit-form").hidden);
  assert.ok(q(ctx.d, "#success-panel").hidden);
  assert.equal(q(ctx.d, "#f-title").value, "");
  assert.ok(q(ctx.d, "#review-panel").hidden);
});

// --------------------------------------------------------------------- privacy
test("PRIVACY: no email, phone or contact fields exist; honeypot is hidden from users and assistive tech", () => {
  const { d } = load();
  assert.equal(qa(d, 'input[type="email"], input[type="tel"], input[name*="mail" i], input[name*="phone" i]').length, 0);
  const hp = q(d, 'input[name="website"]');
  assert.equal(hp.getAttribute("tabindex"), "-1");
  assert.equal(hp.closest(".hp").getAttribute("aria-hidden"), "true");
  assert.match(q(d, "#s4-title").closest("section").textContent, /do not collect email addresses/i);
});

test("PRIVACY: switching to invitation-only drops a previously typed public link from the data", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "url", "https://example.org/secret-join-link");
  choose(w, d, "access", "private");
  type(w, d, "accessNote", "Link sent to WG2 members");
  submit(w, d);
  const json = q(d, "#record-json").textContent;
  assert.ok(!json.includes("secret-join-link"));
  assert.ok(!q(d, "#review-panel").hidden);
  assert.match(q(d, "#preview-list").textContent, /Link sent to WG2 members/);
  assert.ok(!/secret-join-link/.test(q(d, "#preview-list").innerHTML));
});

test("PRIVACY: a join link or email in the note, description or title blocks the review", () => {
  for (const [field, value, pattern] of [
    ["accessNote", "Join at https://zoom.example/j/123", /web address/i],
    ["description", "Questions to me@example.org", /email/i],
    ["title", "Call www.example.org/room", /web address/i]
  ]) {
    const { w, d } = load();
    fillValid(w, d, { access: "private" });
    type(w, d, "accessNote", field === "accessNote" ? value : "Link sent to members");
    if (field !== "accessNote") type(w, d, field, value);
    submit(w, d);
    assert.ok(q(d, "#review-panel").hidden, field);
    assert.match(q(d, "#error-summary").textContent, pattern, field);
  }
});

test("PRIVACY: public join links are shown with a clear warning that they are public", () => {
  const { w, d } = load();
  choose(w, d, "format", "online");
  choose(w, d, "access", "public");
  assert.match(q(d, '[data-field="url"] label').textContent, /Public meeting link/);
  assert.match(q(d, "#h-url").textContent, /PUBLIC/);
  choose(w, d, "access", "private");
  assert.match(q(d, "#h-accessNote").textContent, /Do not include the join link/);
});

// -------------------------------------------------------------------- security
test("SECURITY: markup in any field is refused; text is rendered as text", () => {
  const { w, d } = load();
  fillValid(w, d, { title: "<img src=x onerror=alert(1)>" });
  submit(w, d);
  assert.ok(q(d, "#review-panel").hidden);
  assert.match(q(d, "#error-summary").textContent, /“<”/);
  type(w, d, "title", 'Fish & "chips" \'n\' more');
  submit(w, d);
  const h = q(d, "#preview-list h3");
  assert.equal(h.textContent, 'Fish & "chips" \'n\' more');
  assert.equal(h.children.length, 0);
  assert.equal(qa(d, "#preview-list img, #preview-list script").length, 0);
});

test("SECURITY: the form script never assigns innerHTML/outerHTML/document.write", () => {
  for (const f of ["meetings-form.js", "meetings-form-model.js", "meetings-render.js"]) {
    const src = readFileSync(join(siteRoot, "assets/js", f), "utf8");
    assert.ok(!/\.(inner|outer)HTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), f);
  }
});

test("SECURITY: external links open safely", () => {
  const { d } = load();
  for (const a of qa(d, 'a[target="_blank"]')) assert.match(a.rel, /noopener/);
});

test("SECURITY: a tampered draft in sessionStorage cannot inject markup or break the form", () => {
  const hostile = JSON.stringify({ title: "<script>1</script>", wgs: "not-an-array", organizers: [{ name: { a: 1 }, affiliation: 5 }], timezone: 'x"><img src=x>', format: ["in-person"], recFreq: "bogus", multiDay: "yes" });
  const { d, errors } = load({ draft: hostile });
  assert.deepEqual(errors, []);
  assert.equal(qa(d, "#content img, #content script:not([src])").filter((n) => !n.closest("template") && n.id !== "meetings-data").length, 0);
  assert.equal(q(d, "#f-title").value, "<script>1</script>", "restored as inert text");
  assert.equal(q(d, "#f-timezone").value, "", "unknown time zone is ignored");
  assert.equal(qa(d, "[data-organizer]").length, 1);
});

test("DRAFT: a valid draft is restored, including conditional state", () => {
  const draft = JSON.stringify({ title: "Saved", wgs: ["wg1", "wg2"], format: "in-person", venue: "Hall", access: "private", accessNote: "Members only", recFreq: "weekly", recEnd: "until", recUntil: "2027-06-01", organizers: [{ name: "A", affiliation: "B" }, { name: "C", affiliation: "" }] });
  const { d } = load({ draft });
  assert.equal(q(d, "#f-title").value, "Saved");
  assert.deepEqual(qa(d, 'input[name="wgs"]:checked').map((i) => i.value), ["wg1", "wg2"]);
  assert.ok(visible(d, "location") && visible(d, "accessNote") && visible(d, "recUntil") && visible(d, "recByday"));
  assert.equal(qa(d, "[data-organizer]").length, 2);
  assert.equal(qa(d, "[data-organizer] input[name$='-name']")[1].value, "C");
});

// ------------------------------------------------------------------ usability
test("TIME ZONE: offset hint explains the chosen zone on the chosen date", () => {
  const { w, d } = load();
  type(w, d, "date", "2027-01-12");
  type(w, d, "timezone", "Europe/Warsaw");
  assert.match(q(d, "#tz-hint").textContent, /UTC\+01:00 on 12 Jan 2027/);
  type(w, d, "date", "2027-07-12");
  assert.match(q(d, "#tz-hint").textContent, /UTC\+02:00 on 12 Jul 2027/);
  type(w, d, "timezone", "America/Sao_Paulo");
  assert.match(q(d, "#tz-hint").textContent, /UTC-03:00/);
});

test("TIME ZONE: the browser zone is offered explicitly, never preselected", () => {
  const { w, d } = load({ detectedTz: "Asia/Kolkata" });
  assert.equal(q(d, "#f-timezone").value, "", "nothing preselected");
  const btn = q(d, "#tz-detect");
  assert.ok(!btn.hidden);
  assert.match(btn.textContent, /Asia\/Kolkata/);
  btn.click();
  assert.equal(q(d, "#f-timezone").value, "Asia/Kolkata");
});

test("TIME ZONE: zones are grouped by region and include a free-text escape hatch", () => {
  const { d } = load();
  const groups = qa(d, "#f-timezone optgroup").map((g) => g.label);
  for (const g of ["Europe", "Americas", "Asia", "Africa", "Oceania", "Universal"]) assert.ok(groups.includes(g), g);
  assert.ok(q(d, '#f-timezone option[value="__other__"]'));
});

test("USABILITY: description shows a live character counter", () => {
  const { w, d } = load();
  type(w, d, "description", "hello");
  assert.equal(q(d, "#c-description").textContent, `5 / ${config.limits.description}`);
});

test("USABILITY: Clear form resets everything and the draft", () => {
  const { w, d } = load();
  fillValid(w, d);
  submit(w, d);
  q(d, "#clear-btn").click();
  assert.equal(q(d, "#f-title").value, "");
  assert.ok(q(d, "#review-panel").hidden);
  assert.equal(qa(d, 'input[name="wgs"]:checked').length, 0);
  assert.equal(qa(d, "[data-organizer]").length, 1);
  assert.equal(w.sessionStorage.getItem("paleoimaging.meetings.submit.draft.v1") === null || JSON.parse(w.sessionStorage.getItem("paleoimaging.meetings.submit.draft.v1")).title === "", true);
});

test("USABILITY: the page links back to the calendar and uses the shared layout", () => {
  const { d } = load();
  assert.equal(q(d, ".crumb a").getAttribute("href"), BASEURL + "/meetings/");
  assert.ok(q(d, "header.site-header"));
  assert.ok(q(d, 'link[href$="site.css"]'), "same stylesheet as the calendar");
});

// ------------------------------------------------- community preview: the real preview cannot submit
if (PREVIEW) {
  const real = new JSDOM(previewHtml).window.document;
  const sources = ["meetings-core.js", "meetings-validate.js", "meetings-ics.js", "meetings-render.js", "meetings-form-model.js", "meetings-form.js"];
  const realCtx = () => {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => errors.push(e.message));
    const dom = new JSDOM(previewHtml.replace(/<script src="[^"]*"><\/script>/g, ""), { url: "https://paleoimaging.github.io" + BASEURL + "/meetings/submit/", runScripts: "outside-only", virtualConsole: vc, pretendToBeVisual: true });
    const w = dom.window;
    const calls = [];
    w.Element.prototype.scrollIntoView = function () {};
    w.fetch = (...a) => { calls.push(["fetch", a]); throw new Error("network must not be used"); };
    w.XMLHttpRequest = function () { calls.push(["xhr"]); throw new Error("network must not be used"); };
    w.navigator.sendBeacon = (...a) => { calls.push(["beacon", a]); return false; };
    const widget = { renders: 0 };
    w.turnstile = { render: () => { widget.renders++; }, reset() {} };
    for (const f of sources) w.eval(readFileSync(join(siteRoot, "assets/js", f), "utf8"));
    return { w, d: w.document, errors, calls, widget };
  };

  test("PREVIEW: configuration is disabled with an empty endpoint and an empty Turnstile sitekey", () => {
    assert.equal(submission.enabled, false);
    assert.equal(submission.endpoint, "");
    assert.equal(submission.sitekey, "");
  });

  test("PREVIEW: the built page exposes no active submission configuration", () => {
    assert.equal(real.querySelector("#submission-config"), null);
    assert.equal(real.querySelector("#privacy-notice"), null);
    assert.equal(real.querySelector("#turnstile-box"), null);
    assert.ok(!/workers\.dev|0x4AAAAA|challenges\.cloudflare\.com|data-endpoint|data-sitekey/i.test(previewHtml), "no Worker URL, sitekey or Turnstile reference");
    assert.equal(real.querySelector("#submit-form").getAttribute("action"), null);
    assert.match(real.querySelector("#submission-status").textContent, /not (yet )?(open|enabled|available)|disabled|review/i);
  });

  test("PREVIEW: the public preview cannot initiate a submission, even with the button force-enabled", () => {
    const { w, d, errors, calls, widget } = realCtx();
    assert.deepEqual(errors, []);
    fillValid(w, d);
    submit(w, d);
    const btn = q(d, "#submit-btn");
    assert.ok(!q(d, "#review-panel").hidden, "review step still works");
    assert.ok(btn.disabled, "button disabled");
    btn.disabled = false;
    btn.click();
    assert.match(q(d, "#form-status").textContent, /not enabled/i);
    assert.deepEqual(calls, [], "no network call of any kind");
    assert.equal(widget.renders, 0, "no Turnstile widget");
    assert.ok(!q(w.document, 'head script[src*="challenges.cloudflare.com"]'), "Cloudflare script never loaded");
  });

  test("PREVIEW: robots policy is noindex, nofollow and the preview banner is shown", () => {
    assert.equal(real.querySelector('meta[name="robots"]').content, "noindex, nofollow");
    assert.match(real.querySelector(".preview-bar").textContent, /submissions are disabled/i);
  });

  test("PREVIEW: breadcrumb, navigation and stylesheet respect the baseurl", () => {
    assert.equal(real.querySelector(".crumb a").getAttribute("href"), BASEURL + "/meetings/");
    const internal = [...real.querySelectorAll("header a[href], link[rel=stylesheet][href], .crumb a")].map((e) => e.getAttribute("href")).filter((h) => h.startsWith("/"));
    assert.ok(internal.length > 0);
    for (const h of internal) assert.ok(h === BASEURL || h.startsWith(BASEURL + "/"), "outside baseurl: " + h);
  });
}

// --------------------------------------------------------------------- report
await Promise.all(pending);
let failed = 0;
for (const [ok, name, err] of results) {
  if (ok) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + "\n       " + String(err.message).split("\n").slice(0, 3).join("\n       ")); }
}
console.log(`\nform tests: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
