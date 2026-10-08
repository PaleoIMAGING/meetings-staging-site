/* Meetings page: filters, local-time presentation, series expansion, archive.
 * Renders with DOM APIs and textContent only (record text is never parsed as HTML).
 * Pure date/recurrence logic lives in meetings-core.js. */
(function () {
  "use strict";

  var core = window.PaleoMeetings;
  var icsLib = window.PaleoMeetingsIcs;
  var dataEl = document.getElementById("meetings-data");
  var listEl = document.getElementById("meeting-list");
  if (!core || !icsLib || !dataEl || !listEl) return;

  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var cfg = data.config || {};
  var ui = cfg.ui || {};

  function labelMap(items) {
    var map = {};
    (items || []).forEach(function (i) { map[i.id] = i; });
    return map;
  }
  var wgMap = labelMap(cfg.wgs);
  var formatMap = labelMap(cfg.formats);
  var typeMap = labelMap(cfg.types);
  var statusMap = labelMap(cfg.statuses);

  var viewerTz;
  try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { viewerTz = null; }

  var now = Date.now();
  var VIEWS = ["upcoming", "past", "all"];
  var state = { view: ui.default_view || "upcoming", q: "", wg: "", format: "", type: "" };

  /* ---- occurrences ---- */
  var occurrences = [];
  var meetingsById = {};
  data.meetings.forEach(function (m) {
    meetingsById[m.id] = m;
    core.expandOccurrences(m).forEach(function (o) {
      o.m = m;
      o.state = core.classify(o, now);
      occurrences.push(o);
    });
  });
  occurrences.sort(function (a, b) { return a.startMs - b.startMs || a.id.localeCompare(b.id); });

  /* ---- helpers ---- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function safeHttps(url) {
    return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
  }

  function fmtDate(ms, tz) {
    var o = { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" };
    return new Intl.DateTimeFormat("en-GB", o).format(new Date(ms));
  }
  function fmtTime(ms, tz, withZone) {
    var o = { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    if (withZone) o.timeZoneName = "short";
    return new Intl.DateTimeFormat("en-GB", o).format(new Date(ms));
  }

  function range(o, tz) {
    var sameDay = fmtDate(o.startMs, tz) === fmtDate(o.endMs, tz);
    if (sameDay) return fmtDate(o.startMs, tz) + ", " + fmtTime(o.startMs, tz) + "–" + fmtTime(o.endMs, tz, true);
    return fmtDate(o.startMs, tz) + ", " + fmtTime(o.startMs, tz) + " – " + fmtDate(o.endMs, tz) + ", " + fmtTime(o.endMs, tz, true);
  }

  function chip(text, cls) { return el("span", "chip" + (cls ? " " + cls : ""), text); }

  function row(dl, term, valueNode) {
    dl.appendChild(el("dt", null, term));
    var dd = el("dd");
    dd.appendChild(valueNode);
    dl.appendChild(dd);
  }

  function linkNode(label, url) {
    var u = safeHttps(url);
    if (!u) return document.createTextNode(label);
    var a = el("a", null, label);
    a.href = u;
    a.rel = "noopener noreferrer";
    a.target = "_blank";
    return a;
  }

  function download(m, o) {
    var text = icsLib.buildOccurrenceIcs(m, o, { origin: ui.site_url || location.origin, config: cfg });
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m.id + "-" + o.startLocal.slice(0, 10).replace(/-/g, "") + ".ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---- card ---- */
  function card(o, domId, extra) {
    var m = o.m;
    var li = el("li", "card card--" + o.state + (m.status === "cancelled" ? " card--cancelled" : ""));
    if (domId) li.id = domId;

    var chips = el("div", "chips");
    (m.wgs || []).forEach(function (w) { chips.appendChild(chip(wgMap[w] ? wgMap[w].short || wgMap[w].label : w)); });
    chips.appendChild(chip((formatMap[m.format] || {}).label || m.format, "chip--format"));
    if (typeMap[m.type]) chips.appendChild(chip(typeMap[m.type].label));
    if (m.status && m.status !== "scheduled") chips.appendChild(chip((statusMap[m.status] || {}).label || m.status, "chip--status"));
    if (m.sample) chips.appendChild(chip("Sample", "chip--sample"));
    li.appendChild(chips);

    li.appendChild(el("h2", null, m.title));
    li.appendChild(el("p", "when", range(o, m.timezone)));

    var tzDiffers = viewerTz && viewerTz !== m.timezone &&
      core.zoneOffset(o.startMs, viewerTz) !== core.zoneOffset(o.startMs, m.timezone);
    if (tzDiffers) li.appendChild(el("p", "when-local", "Your time: " + range(o, viewerTz)));

    var where = m.format === "online" ? "Online" :
      [m.location && m.location.venue, m.location && m.location.city, m.location && m.location.country].filter(Boolean).join(", ") +
      (m.format === "hybrid" ? " (and online)" : "");
    li.appendChild(el("p", "meta", where));
    if (m.recurrence) li.appendChild(el("p", "meta", "Series: " + core.describeRecurrence(m.recurrence) + (extra ? " · " + extra : "")));

    var det = el("details");
    det.appendChild(el("summary", null, "Details"));
    if (m.description) det.appendChild(el("p", "desc", m.description));

    var dl = el("dl");
    if (m.organizers && m.organizers.length) {
      row(dl, "Organizers", document.createTextNode(m.organizers.map(function (p) {
        return p.name + (p.affiliation ? " (" + p.affiliation + ")" : "");
      }).join("; ")));
    }
    if (m.format !== "in-person") {
      if (m.access === "public" && safeHttps(m.url)) row(dl, "Join", linkNode("Open meeting link", m.url));
      else if (m.access === "registration" && safeHttps(m.registration_url)) row(dl, "Register", linkNode("Registration page", m.registration_url));
    } else if (m.access === "registration" && safeHttps(m.registration_url)) {
      row(dl, "Register", linkNode("Registration page", m.registration_url));
    }
    if (m.access === "private" && m.access_note) row(dl, "Access", document.createTextNode(m.access_note));
    if (m.location && m.location.address) row(dl, "Address", document.createTextNode(m.location.address));
    (m.links || []).forEach(function (l) { row(dl, "Resource", linkNode(l.label, l.url)); });
    row(dl, "Time zone", document.createTextNode(m.timezone));
    det.appendChild(dl);
    li.appendChild(det);

    var actions = el("div", "actions");
    var b = el("button", "btn btn--ghost", "Add to calendar (.ics)");
    b.type = "button";
    b.addEventListener("click", function () { download(m, o); });
    actions.appendChild(b);
    li.appendChild(actions);
    return li;
  }

  /* ---- filtering and rendering ---- */
  function matches(o) {
    var m = o.m;
    if (state.wg && (m.wgs || []).indexOf(state.wg) === -1) return false;
    if (state.format && m.format !== state.format) return false;
    if (state.type && m.type !== state.type) return false;
    if (state.q) {
      var hay = [m.title, m.description].concat((m.organizers || []).map(function (p) { return p.name + " " + (p.affiliation || ""); })).join(" ").toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function visible() {
    var list = occurrences.filter(matches);
    var hiddenBySeries = {};
    if (state.view === "upcoming") {
      list = list.filter(function (o) { return o.state !== "past"; });
      var limit = ui.recurring_upcoming_limit > 0 ? ui.recurring_upcoming_limit : Infinity;
      var shown = {};
      list = list.filter(function (o) {
        if (!o.recurring) return true;
        shown[o.id] = (shown[o.id] || 0) + 1;
        if (shown[o.id] > limit) { hiddenBySeries[o.id] = (hiddenBySeries[o.id] || 0) + 1; return false; }
        return true;
      });
    } else if (state.view === "past") {
      list = list.filter(function (o) { return o.state === "past"; }).reverse();
    }
    return { list: list, hidden: hiddenBySeries };
  }

  function render() {
    var res = visible();
    listEl.textContent = "";
    var firstSeen = {};
    res.list.forEach(function (o) {
      var domId = firstSeen[o.id] ? null : o.id;
      firstSeen[o.id] = true;
      var extra = null;
      if (res.hidden[o.id] && domId) extra = res.hidden[o.id] + " more upcoming not shown";
      listEl.appendChild(card(o, domId, extra));
    });
    if (!res.list.length) {
      listEl.appendChild(el("li", "empty", state.view === "upcoming" ? "No upcoming meetings match these filters." : "No meetings match these filters."));
    }
    document.getElementById("count").textContent = res.list.length + (res.list.length === 1 ? " meeting" : " meetings");
    Array.prototype.forEach.call(document.querySelectorAll("#views [data-view]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === state.view));
    });
    syncUrl();
  }

  /* ---- state <-> URL ---- */
  function syncUrl() {
    try {
      var p = new URLSearchParams();
      if (state.view !== (ui.default_view || "upcoming")) p.set("view", state.view);
      ["q", "wg", "format", "type"].forEach(function (k) { if (state[k]) p.set(k, state[k]); });
      var qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    } catch (e) { /* history API unavailable: ignore */ }
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    var v = p.get("view");
    if (VIEWS.indexOf(v) > -1) state.view = v;
    ["q", "wg", "format", "type"].forEach(function (k) {
      var val = p.get(k);
      if (val) state[k] = val.slice(0, 80);
    });
    var id = decodeURIComponent((location.hash || "").slice(1));
    if (id && meetingsById[id] && !p.get("view")) state.view = "all";
  }

  function bind() {
    var form = document.getElementById("filters");
    var fields = { q: "f-q", wg: "f-wg", format: "f-format", type: "f-type" };
    Object.keys(fields).forEach(function (k) {
      var input = document.getElementById(fields[k]);
      if (state[k] && (input.tagName !== "SELECT" || Array.prototype.some.call(input.options, function (o) { return o.value === state[k]; }))) input.value = state[k];
      else state[k] = k === "q" ? state[k] : "";
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function () { state[k] = input.value.trim(); render(); });
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    form.addEventListener("reset", function () {
      state.q = state.wg = state.format = state.type = "";
      setTimeout(render, 0);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#views [data-view]"), function (b) {
      b.addEventListener("click", function () { state.view = b.getAttribute("data-view"); render(); });
    });
    form.hidden = false;
    document.getElementById("views").hidden = false;
  }

  if (!data.meetings.length) {
    var empty = document.getElementById("empty-state");
    if (empty) empty.hidden = false;
    return;
  }

  readUrl();
  bind();
  render();

  var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView();
})();
