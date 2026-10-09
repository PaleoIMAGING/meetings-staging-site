// Behavioural tests for the submission form, run against the BUILT site.
//   node form-test.mjs <_site dir>
// Loads meetings/submit/index.html in jsdom with the real scripts (the same
// files the browser loads) and drives it with DOM events.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { siteRoot, loadConfig } from "./lib.mjs";

const dir = resolve(process.argv[2] || "");
const html = readFileSync(join(dir, "meetings", "submit", "index.html"), "utf8");
const config = loadConfig();
const FIXED = Date.UTC(2026, 9, 8, 12);
const SCRIPTS = ["meetings-core.js", "meetings-validate.js", "meetings-ics.js", "meetings-render.js", "meetings-form-model.js", "meetings-form.js"];

const results = [];
const test = (name, fn) => {
  try { fn(); results.push([true, name]); } catch (e) { results.push([false, name, e]); }
};

function load({ detectedTz, draft } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const bare = html.replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(bare, { url: "https://paleoimaging.github.io/meetings/submit/", runScripts: "outside-only", virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  if (draft) w.sessionStorage.setItem("paleoimaging.meetings.submit.draft.v1", draft);
  w.eval(`Date.now = () => ${FIXED};`);
  w.Element.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  const calls = [];
  w.fetch = (...a) => { calls.push(["fetch", a]); throw new Error("network must not be used"); };
  w.XMLHttpRequest = function () { calls.push(["xhr"]); throw new Error("network must not be used"); };
  w.navigator.sendBeacon = (...a) => { calls.push(["beacon", a]); return false; };
  if (detectedTz) w.eval(`Intl.DateTimeFormat = (function (O) { return function (l, o) { var f = new O(l, o); if (!o) { f.resolvedOptions = function () { return { timeZone: "${detectedTz}" }; }; } return f; }; })(Intl.DateTimeFormat);`);
  for (const f of SCRIPTS) w.eval(readFileSync(join(siteRoot, "assets/js", f), "utf8"));
  return { w, d: w.document, errors, calls };
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
test("loads without script errors and shows the not-enabled notice", () => {
  const { d, errors } = load();
  assert.deepEqual(errors, []);
  assert.match(q(d, "#submission-status").textContent, /not enabled yet/i);
  assert.match(q(d, "h1").textContent, /Propose a meeting/);
  assert.match(q(d, ".lead").textContent, /approved by administrators/i);
});

test("four sections in the requested order", () => {
  const { d } = load();
  const heads = qa(d, "form > section > h2").map((h) => h.textContent.replace(/\s+/g, " ").trim());
  assert.deepEqual(heads, ["1 Meeting information", "2 Date & Time", "3 Location & Access", "4 Organizer"]);
});

test("page is noindex and not linked from the site navigation", () => {
  const { d } = load();
  assert.ok(q(d, 'meta[name="robots"][content*="noindex"]'));
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

test("REVIEW: a series without an end is rejected with a clear message", () => {
  const { w, d } = load();
  fillValid(w, d);
  type(w, d, "recFreq", "weekly");
  submit(w, d);
  assert.ok(q(d, "#review-panel").hidden);
  assert.match(q(d, "#error-summary").textContent, /how the series ends/i);
});

// -------------------------------------------------- submissions stay disabled
test("DISABLED: the submit button is disabled and nothing is ever sent", () => {
  const { w, d, calls } = load();
  fillValid(w, d);
  submit(w, d);
  const btn = q(d, "#submit-btn");
  assert.ok(btn.disabled);
  assert.equal(btn.getAttribute("aria-disabled"), "true");
  assert.match(btn.textContent, /not enabled yet/i);
  btn.disabled = false; // even if a user force-enabled it in dev tools
  btn.click();
  assert.match(q(d, "#form-status").textContent, /not enabled/i);
  assert.deepEqual(calls, [], "no network request of any kind");
  assert.match(q(d, "#submit-disabled-note").textContent, /not enabled yet/i);
  const src = readFileSync(join(siteRoot, "assets/js/meetings-form.js"), "utf8");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\.submit\(\)/.test(src), "form script contains no network code");
  assert.equal(q(d, "#submit-form").getAttribute("action"), null);
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
  assert.equal(q(d, ".crumb a").getAttribute("href"), "/meetings/");
  assert.ok(q(d, "header.site-header"));
  assert.ok(q(d, 'link[href$="site.css"]'), "same stylesheet as the calendar");
});

// --------------------------------------------------------------------- report
let failed = 0;
for (const [ok, name, err] of results) {
  if (ok) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + "\n       " + String(err.message).split("\n").slice(0, 3).join("\n       ")); }
}
console.log(`\nform tests: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
