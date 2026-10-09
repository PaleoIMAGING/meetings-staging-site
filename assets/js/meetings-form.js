/* Meeting submission form: DOM wiring only.
 *
 * All rules come from the shared modules:
 *   meetings-validate.js + _data/meetings_config.yml  what is valid / required
 *   meetings-form-model.js                            answers -> record, error mapping
 *   meetings-render.js                                the preview card
 * There is no validation logic here and, by design, no network code: this
 * version only lets people fill in, check and preview a proposal. Nothing is
 * sent anywhere. Page text is written with textContent / DOM APIs only.
 */
(function () {
  "use strict";

  var core = window.PaleoMeetings;
  var validator = window.PaleoMeetingsValidate;
  var model = window.PaleoMeetingsFormModel;
  var renderLib = window.PaleoMeetingsRender;
  var icsLib = window.PaleoMeetingsIcs;
  var form = document.getElementById("submit-form");
  var dataEl = document.getElementById("meetings-data");
  if (!core || !validator || !model || !renderLib || !icsLib || !form || !dataEl) return;

  var cfg;
  try { cfg = JSON.parse(dataEl.textContent).config; } catch (e) { return; }
  var renderer = renderLib.create(cfg, { core: core, ics: icsLib });

  var DRAFT_KEY = "paleoimaging.meetings.submit.draft.v1";
  var TEXT_KEYS = ["title", "description", "type", "date", "startTime", "endTime", "endDate", "timezone", "tzOther",
    "recFreq", "recInterval", "recCount", "recUntil", "recExceptions", "venue", "city", "country", "address",
    "platform", "url", "registrationUrl", "accessNote"];
  var UNIT = { daily: "day(s)", weekly: "week(s)", monthly: "month(s)" };

  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var field = function (name) { return form.querySelector('[name="' + name + '"]'); };
  var checkedValue = function (name) {
    var n = form.querySelector('input[name="' + name + '"]:checked');
    return n ? n.value : "";
  };
  var checkedValues = function (name) {
    return qsa('input[name="' + name + '"]:checked').map(function (n) { return n.value; });
  };

  var orgBox = $("organizers");
  var orgTemplate = $("organizer-template");
  var nextRow = 0;
  var values = model.defaultValues();
  var touched = {};
  var attempted = false;
  var reviewShown = false;
  var detectedTz = null;
  try { detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { detectedTz = null; }

  /* ---- organizers (rows cloned from a static <template>) ---- */
  function addOrganizer(name, affiliation) {
    if (qsa("[data-organizer]", orgBox).length >= cfg.limits.organizers) return null;
    var id = nextRow++;
    var row = orgTemplate.content.firstElementChild.cloneNode(true);
    [row].concat(qsa("*", row)).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (a.value.indexOf("__N__") > -1) n.setAttribute(a.name, a.value.split("__N__").join(String(id)));
      });
    });
    orgBox.appendChild(row);
    if (name) row.querySelector("input[name$='-name']").value = name;
    if (affiliation) row.querySelector("input[name$='-affiliation']").value = affiliation;
    row.querySelector(".organizer__remove").addEventListener("click", function () {
      var rows = qsa("[data-organizer]", orgBox);
      if (rows.length < 2) return;
      var at = rows.indexOf(row);
      orgBox.removeChild(row);
      var left = qsa("[data-organizer]", orgBox);
      var focusTo = left[Math.min(at, left.length - 1)].querySelector("input");
      update();
      focusTo.focus();
    });
    return row;
  }

  function refreshOrganizerChrome() {
    var rows = qsa("[data-organizer]", orgBox);
    rows.forEach(function (r, i) {
      r.querySelector(".organizer__num").textContent = String(i + 1);
      r.querySelector(".organizer__remove").hidden = rows.length < 2;
    });
    $("add-organizer").disabled = rows.length >= cfg.limits.organizers;
  }

  /* ---- DOM -> values ---- */
  function readValues() {
    var v = model.defaultValues();
    TEXT_KEYS.forEach(function (k) { var f = field(k); v[k] = f ? f.value : ""; });
    v.multiDay = field("multiDay").checked;
    v.wgs = checkedValues("wgs");
    v.recByday = checkedValues("recByday");
    v.format = checkedValue("format");
    v.access = checkedValue("access");
    v.recEnd = checkedValue("recEnd") || "count";
    v.organizers = qsa("[data-organizer]", orgBox).map(function (r) {
      var id = r.getAttribute("data-organizer");
      return { rowId: id, name: field("org-" + id + "-name").value, affiliation: field("org-" + id + "-affiliation").value };
    });
    return v;
  }

  /* values -> DOM (draft restore). Untrusted input: strict type checks. */
  function writeValues(v) {
    TEXT_KEYS.forEach(function (k) {
      var f = field(k);
      if (!f || typeof v[k] !== "string") return;
      if (f.tagName === "SELECT") {
        var known = qsa("option", f).some(function (o) { return o.value === v[k]; });
        if (!known && k === "timezone" && v[k] && core.isValidTimeZone(v[k])) {
          var extra = document.createElement("option"); // a detected zone saved in the draft
          extra.value = v[k];
          extra.textContent = v[k] + " (your browser)";
          f.insertBefore(extra, f.options[1]);
          known = true;
        }
        if (known) f.value = v[k];
      }
      else f.value = v[k].slice(0, 2000);
    });
    field("multiDay").checked = v.multiDay === true;
    var setChecks = function (name, list) {
      var arr = Array.isArray(list) ? list : [];
      qsa('input[name="' + name + '"]').forEach(function (n) { n.checked = arr.indexOf(n.value) > -1; });
    };
    setChecks("wgs", v.wgs);
    setChecks("recByday", v.recByday);
    ["format", "access", "recEnd"].forEach(function (name) {
      qsa('input[name="' + name + '"]').forEach(function (n) { n.checked = typeof v[name] === "string" && n.value === v[name]; });
    });
    if (!checkedValue("recEnd")) qsa('input[name="recEnd"]')[0].checked = true;
    qsa("[data-organizer]", orgBox).forEach(function (r) { orgBox.removeChild(r); });
    var orgs = Array.isArray(v.organizers) ? v.organizers.slice(0, cfg.limits.organizers) : [];
    if (!orgs.length) orgs = [model.emptyOrganizer()];
    orgs.forEach(function (o) {
      addOrganizer(typeof o.name === "string" ? o.name.slice(0, 300) : "", typeof o.affiliation === "string" ? o.affiliation.slice(0, 300) : "");
    });
  }

  function saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values)); } catch (e) { /* storage unavailable: ignore */ }
  }
  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) writeValues(JSON.parse(raw));
    } catch (e) { /* corrupt draft: start empty */ }
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  /* ---- visibility, required markers, hints ---- */
  function applyVisibility(vis) {
    qsa("[data-show]").forEach(function (n) {
      var key = n.getAttribute("data-show");
      if (Object.prototype.hasOwnProperty.call(vis, key)) n.hidden = !vis[key];
    });
  }

  function controlsFor(path) {
    if (path === "start") return ["date", "startTime"];
    if (path === "end") return values.multiDay ? ["endTime", "endDate"] : ["endTime"];
    if (path === "timezone") return ["timezone", "tzOther"];
    if (path === "organizers") return ["org-first"];
    return [model.controlFor(path, values)];
  }

  /* Required controls, derived from the same config the validator uses. */
  function requiredControls() {
    var req = {};
    var add = function (path) { controlsFor(path).forEach(function (c) { req[c] = true; }); };
    cfg.fields.required.forEach(add);
    var fmt = cfg.formats.filter(function (f) { return f.id === values.format; })[0];
    if (fmt) fmt.requires.forEach(add);
    var acc = cfg.access.filter(function (a) { return a.id === values.access; })[0];
    if (acc && (acc.requires_skip_formats || []).indexOf(values.format) === -1) acc.requires.forEach(add);
    if (values.recFreq !== "none" && cfg.recurrence.require_end) { req.recEnd = true; req[values.recEnd === "until" ? "recUntil" : "recCount"] = true; }
    if (values.multiDay) req.endDate = true;
    return req;
  }

  function applyRequired() {
    var req = requiredControls();
    var firstRow = qsa("[data-organizer]", orgBox)[0];
    if (firstRow) req["org-" + firstRow.getAttribute("data-organizer") + "-name"] = true;
    qsa("[data-field]").forEach(function (f) {
      var key = f.getAttribute("data-field");
      var on = !!req[key];
      f.classList.toggle("is-required", on);
      var sr = f.querySelector(".req-sr");
      if (sr) sr.textContent = on ? " (required)" : "";
      var input = $("f-" + key);
      if (input && input.tagName !== "FIELDSET") {
        if (on) input.setAttribute("aria-required", "true"); else input.removeAttribute("aria-required");
      }
    });
  }

  function formatOffset(ms) {
    var sign = ms < 0 ? "-" : "+";
    var abs = Math.abs(ms) / 60000;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return "UTC" + sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
  }

  function updateHints() {
    var tz = values.timezone === "__other__" ? values.tzOther.trim() : values.timezone;
    var hint = $("tz-hint");
    if (tz && core.isValidTimeZone(tz)) {
      var day = values.date || "";
      var at = core.wallToInstant((day || "2026-01-01") + "T" + (values.startTime || "12:00"), tz);
      if (!day) at = Date.now();
      var when = day ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(core.wallToInstant(day + "T00:00", "UTC"))) : "today";
      hint.textContent = formatOffset(core.zoneOffset(at, tz)) + " on " + when + (day ? "" : " (the offset on your meeting date may differ)") + ".";
    } else hint.textContent = "";
    $("rec-unit").textContent = values.recFreq !== "none" && UNIT[values.recFreq] ? "Repeats every " + (values.recInterval || "1") + " " + UNIT[values.recFreq] + "." : "";
    var d = field("description");
    $("c-description").textContent = d.value.length + " / " + cfg.limits.description;
  }

  /* ---- errors ---- */
  var lastGroups = { byControl: {}, general: [], order: [] };

  function firstFocusable(key) {
    if (key === "organizers") key = "org-first";
    if (key === "org-first") { var r = qsa("[data-organizer]", orgBox)[0]; return r ? r.querySelector("input") : null; }
    var el = $("f-" + key);
    if (!el) return null;
    if (el.tagName === "FIELDSET") return el.querySelector("input:checked") || el.querySelector("input");
    return el;
  }

  function labelFor(key) {
    var m = /^org-(\d+)-(name|affiliation)$/.exec(key);
    if (m) {
      var rows = qsa("[data-organizer]", orgBox);
      var pos = rows.map(function (r) { return r.getAttribute("data-organizer"); }).indexOf(m[1]);
      return "Organizer " + (pos + 1) + " " + (m[2] === "name" ? "name" : "affiliation");
    }
    var holder = qsa("[data-field]").filter(function (f) { return f.getAttribute("data-field") === key; })[0];
    var node = holder && (holder.querySelector("legend") || holder.querySelector("label"));
    var text = node && node.childNodes[0] ? node.childNodes[0].textContent.trim() : key;
    return text.replace(/\s*\*$/, "");
  }

  function renderErrors() {
    var errors = validator.validate(model.buildRecord(values, cfg), cfg);
    lastGroups = model.groupErrors(errors, values);
    qsa(".error[data-error-for]").forEach(function (e) {
      var key = e.getAttribute("data-error-for");
      var msgs = lastGroups.byControl[key];
      var show = !!msgs && (attempted || touched[key]);
      e.textContent = show ? msgs.join(" ") : "";
      e.hidden = !show;
      var input = $("f-" + key);
      if (input && input.tagName !== "FIELDSET") {
        if (show) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      }
    });
    return errors;
  }

  function renderSummary(focus) {
    var box = $("error-summary");
    var list = $("error-summary-list");
    list.textContent = "";
    // List problems in the order they appear on the page, not in validator order.
    var ordered = lastGroups.order.slice().sort(function (x, y) {
      var ex = firstFocusable(x);
      var ey = firstFocusable(y);
      if (!ex || !ey) return 0;
      return ex.compareDocumentPosition(ey) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    var shown = ordered.concat(lastGroups.general.length ? ["general"] : []);
    shown.forEach(function (key) {
      var li = document.createElement("li");
      if (key === "general") {
        li.textContent = lastGroups.general.join(" ");
      } else {
        var target = firstFocusable(key);
        var a = document.createElement("a");
        a.href = "#" + (target && target.id ? target.id : "f-" + key);
        a.textContent = labelFor(key);
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          var t = firstFocusable(key);
          if (t) { t.focus(); t.scrollIntoView({ block: "center" }); }
        });
        li.appendChild(a);
        li.appendChild(document.createTextNode(": " + lastGroups.byControl[key].join(" ")));
      }
      list.appendChild(li);
    });
    box.hidden = shown.length === 0;
    if (focus && shown.length) { box.focus(); box.scrollIntoView({ block: "start" }); }
  }

  /* ---- review / preview ---- */
  function hideReview() {
    if (!reviewShown) return;
    reviewShown = false;
    $("review-panel").hidden = true;
    $("form-status").textContent = "Answers changed. Review the proposal again to see the preview.";
  }

  function showReview() {
    var rec = model.buildRecord(values, cfg);
    var occ = core.expandOccurrences(rec)[0];
    if (!occ) return;
    occ.m = rec;
    occ.state = core.classify(occ, Date.now());
    var list = $("preview-list");
    list.textContent = "";
    list.appendChild(renderer.card(occ, { preview: true, headingLevel: 3 }));
    $("record-json").textContent = JSON.stringify(rec, null, 2);
    $("past-warning").hidden = occ.state !== "past";
    $("review-panel").hidden = false;
    reviewShown = true;
    $("form-status").textContent = "Review ready below.";
    var h = $("review-title");
    h.focus();
    h.scrollIntoView({ block: "start" });
  }

  /* ---- main update cycle ---- */
  function update() {
    values = readValues();
    applyVisibility(model.visibility(values, cfg));
    applyRequired();
    updateHints();
    refreshOrganizerChrome();
    renderErrors();
    if (attempted) renderSummary(false);
    saveDraft();
  }

  function keyOfControl(el) {
    return el && el.name ? el.name : "";
  }

  form.addEventListener("input", function (e) {
    hideReview();
    update();
  });

  form.addEventListener("change", function (e) {
    var t = e.target;
    // "General community" excludes specific groups, and vice versa.
    if (t.name === "wgs" && t.checked) {
      qsa('input[name="wgs"]').forEach(function (other) {
        if (other !== t && (t.getAttribute("data-exclusive") === "true" || other.getAttribute("data-exclusive") === "true")) other.checked = false;
      });
    }
    touched[keyOfControl(t)] = true;
    hideReview();
    update();
  });

  form.addEventListener("focusout", function (e) {
    var key = keyOfControl(e.target);
    if (!key) return;
    touched[key] = true;
    values = readValues();
    renderErrors();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    attempted = true;
    update();
    var errors = renderErrors();
    if (errors.length) {
      renderSummary(true);
      $("form-status").textContent = errors.length + (errors.length === 1 ? " problem to fix." : " problems to fix.");
      return;
    }
    $("error-summary").hidden = true;
    showReview();
  });

  $("add-organizer").addEventListener("click", function () {
    var row = addOrganizer("", "");
    update();
    if (row) row.querySelector("input").focus();
  });

  $("edit-btn").addEventListener("click", function () {
    $("review-panel").hidden = true;
    reviewShown = false;
    var first = firstFocusable("title");
    if (first) { first.focus(); first.scrollIntoView({ block: "center" }); }
  });

  $("clear-btn").addEventListener("click", function () {
    if (!window.confirm("Clear every field in this form?")) return;
    form.reset();
    writeValues(model.defaultValues());
    touched = {};
    attempted = false;
    reviewShown = false;
    $("review-panel").hidden = true;
    $("error-summary").hidden = true;
    clearDraft();
    update();
    $("form-status").textContent = "Form cleared.";
    firstFocusable("title").focus();
  });

  // Submissions are intentionally not implemented in this version: the button
  // stays disabled and no request is ever made.
  $("submit-btn").addEventListener("click", function (e) {
    e.preventDefault();
    $("form-status").textContent = "Submissions are not enabled yet.";
  });

  /* Time-zone helper: offer the browser's zone explicitly, never preselect it. */
  var detectBtn = $("tz-detect");
  if (detectedTz && core.isValidTimeZone(detectedTz)) {
    detectBtn.textContent = "Use my browser's time zone (" + detectedTz + ")";
    detectBtn.hidden = false;
    detectBtn.addEventListener("click", function () {
      var sel = field("timezone");
      if (!qsa("option", sel).some(function (o) { return o.value === detectedTz; })) {
        var opt = document.createElement("option");
        opt.value = detectedTz;
        opt.textContent = detectedTz + " (your browser)";
        sel.insertBefore(opt, sel.options[1]);
      }
      sel.value = detectedTz;
      touched.timezone = true;
      update();
    });
  }

  /* ---- start ---- */
  addOrganizer("", "");
  loadDraft();
  refreshOrganizerChrome();
  update();
})();
