/* Meetings page: filters, local-time presentation, series expansion, archive.
 * Renders with DOM APIs and textContent only (record text is never parsed as HTML).
 * Pure date/recurrence logic lives in meetings-core.js. */
(function () {
  "use strict";

  var core = window.PaleoMeetings;
  var icsLib = window.PaleoMeetingsIcs;
  var dataEl = document.getElementById("meetings-data");
  var listEl = document.getElementById("meeting-list");
  if (!core || !icsLib || !window.PaleoMeetingsRender || !dataEl || !listEl) return;

  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var cfg = data.config || {};
  var ui = cfg.ui || {};

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

  var renderer = window.PaleoMeetingsRender.create(cfg, { core: core, ics: icsLib });
  function card(o, domId, extra) { return renderer.card(o, { domId: domId, extra: extra }); }


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
