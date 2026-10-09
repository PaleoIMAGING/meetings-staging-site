/* PaleoIMAGING meetings: meeting card rendering (browser only).
 *
 * One renderer for every page that shows a meeting: the public calendar and
 * the submission form's preview, so a proposal is previewed exactly as it
 * will appear. Builds DOM nodes with textContent only; record text is never
 * parsed as HTML, and links are only created for https URLs.
 */
(function (root) {
  "use strict";

  function create(cfg, deps) {
    var core = deps.core;
    var icsLib = deps.ics;
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
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
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

    /* o: occurrence ({ m, state, startMs, ... }). opts: { domId, extra, preview, headingLevel }. */
    function card(o, opts) {
      opts = opts || {};
      var m = o.m;
      var li = el("li", "card card--" + o.state + (m.status === "cancelled" ? " card--cancelled" : ""));
      if (opts.domId) li.id = opts.domId;

      var chips = el("div", "chips");
      (m.wgs || []).forEach(function (w) { chips.appendChild(chip(wgMap[w] ? wgMap[w].short || wgMap[w].label : w)); });
      chips.appendChild(chip((formatMap[m.format] || {}).label || m.format, "chip--format"));
      if (typeMap[m.type]) chips.appendChild(chip(typeMap[m.type].label));
      if (m.status && m.status !== "scheduled") chips.appendChild(chip((statusMap[m.status] || {}).label || m.status, "chip--status"));
      if (m.sample) chips.appendChild(chip("Sample", "chip--sample"));
      li.appendChild(chips);

      li.appendChild(el("h" + (opts.headingLevel || 2), null, m.title));
      li.appendChild(el("p", "when", range(o, m.timezone)));

      var tzDiffers = viewerTz && viewerTz !== m.timezone &&
        core.zoneOffset(o.startMs, viewerTz) !== core.zoneOffset(o.startMs, m.timezone);
      if (tzDiffers) li.appendChild(el("p", "when-local", "Your time: " + range(o, viewerTz)));

      var via = m.platform ? " (" + m.platform + ")" : "";
      var place = [m.location && m.location.venue, m.location && m.location.city, m.location && m.location.country].filter(Boolean).join(", ");
      var where = m.format === "online" ? "Online" + via : place + (m.format === "hybrid" ? " (and online" + (m.platform ? ", " + m.platform : "") + ")" : "");
      li.appendChild(el("p", "meta", where));
      if (m.recurrence) li.appendChild(el("p", "meta", "Series: " + core.describeRecurrence(m.recurrence) + (opts.extra ? " · " + opts.extra : "")));

      var det = el("details");
      if (opts.preview) det.open = true;
      det.appendChild(el("summary", null, "Details"));
      if (m.description) det.appendChild(el("p", "desc", m.description));

      var dl = el("dl");
      if (m.organizers && m.organizers.length) {
        row(dl, "Organizers", document.createTextNode(m.organizers.map(function (p) {
          return p.name + (p.affiliation ? " (" + p.affiliation + ")" : "");
        }).join("; ")));
      }
      if (m.format !== "in-person" && m.access === "public" && safeHttps(m.url)) row(dl, "Join", linkNode("Open meeting link", m.url));
      if (m.access === "registration" && safeHttps(m.registration_url)) row(dl, "Register", linkNode("Registration page", m.registration_url));
      if (m.access === "private" && m.access_note) row(dl, "Access", document.createTextNode(m.access_note));
      if (m.location && m.location.address) row(dl, "Address", document.createTextNode(m.location.address));
      (m.links || []).forEach(function (l) { row(dl, "Resource", linkNode(l.label, l.url)); });
      row(dl, "Time zone", document.createTextNode(m.timezone));
      det.appendChild(dl);
      li.appendChild(det);

      if (!opts.preview) {
        var actions = el("div", "actions");
        var b = el("button", "btn btn--ghost", "Add to calendar (.ics)");
        b.type = "button";
        b.addEventListener("click", function () { download(m, o); });
        actions.appendChild(b);
        li.appendChild(actions);
      }
      return li;
    }

    return { card: card, range: range, safeHttps: safeHttps };
  }

  root.PaleoMeetingsRender = { create: create };
})(typeof self !== "undefined" ? self : this);
