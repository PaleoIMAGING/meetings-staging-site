/* PaleoIMAGING meetings: pure logic (no DOM).
 *
 * Meeting records store local "wall clock" times plus an IANA time zone,
 * e.g. start "2026-11-10T14:00" in "Europe/Warsaw". This module converts
 * them to instants, expands recurring series, and builds iCalendar text.
 * It runs unchanged in browsers, Node and Cloudflare Workers (UMD, no DOM or
 * Node APIs, Intl only). iCalendar output lives in meetings-ics.js and the
 * record validator in meetings-validate.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaleoMeetings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY = 86400000;
  var WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  var LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = "0" + s;
    return s;
  }

  /* "2026-11-10T14:00" -> { y, mo, d, h, mi } or null (also rejects 02-30). */
  function parseLocal(str) {
    var m = typeof str === "string" && LOCAL_RE.exec(str);
    if (!m) return null;
    var p = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    var t = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi));
    if (t.getUTCFullYear() !== p.y || t.getUTCMonth() !== p.mo - 1 || t.getUTCDate() !== p.d) return null;
    if (p.h > 23 || p.mi > 59) return null;
    return p;
  }

  function parseDate(str) {
    var m = typeof str === "string" && DATE_RE.exec(str);
    if (!m) return null;
    var p = { y: +m[1], mo: +m[2], d: +m[3] };
    var t = new Date(Date.UTC(p.y, p.mo - 1, p.d));
    if (t.getUTCFullYear() !== p.y || t.getUTCMonth() !== p.mo - 1 || t.getUTCDate() !== p.d) return null;
    return p;
  }

  /* Wall-clock fields treated as if they were UTC (pure calendar arithmetic). */
  function wallMs(p) {
    return Date.UTC(p.y, p.mo - 1, p.d, p.h || 0, p.mi || 0);
  }

  function wallString(ms) {
    var t = new Date(ms);
    return (
      pad(t.getUTCFullYear(), 4) + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()) +
      "T" + pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes())
    );
  }

  var dtfCache = {};
  function isValidTimeZone(tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return typeof tz === "string" && tz.length > 0;
    } catch (e) {
      return false;
    }
  }

  function zoneFormatter(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    return dtfCache[tz];
  }

  /* Offset (ms) of `tz` from UTC at the given instant. */
  function zoneOffset(ms, tz) {
    var parts = zoneFormatter(tz).formatToParts(new Date(ms));
    var f = {};
    parts.forEach(function (p) { f[p.type] = p.value; });
    var asUtc = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour % 24, +f.minute, +f.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /* Local wall time in `tz` -> UTC instant (ms). Gaps resolve forward,
   * overlaps resolve to the first (earlier) occurrence. */
  function wallToInstant(localStr, tz) {
    var p = parseLocal(localStr);
    if (!p) return NaN;
    var guess = wallMs(p);
    // Offsets in force a day before and after bracket any transition.
    var before = zoneOffset(guess - DAY, tz);
    var after = zoneOffset(guess + DAY, tz);
    var valid = [];
    [before, after].forEach(function (off) {
      var t = guess - off;
      if (zoneOffset(t, tz) === off && valid.indexOf(t) === -1) valid.push(t);
    });
    if (valid.length) return Math.min.apply(null, valid); // overlap -> earlier instant
    return guess - before; // gap -> shift forward
  }

  /* ---- recurrence ---------------------------------------------------- */

  function daysInMonth(y, mo) {
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }

  /* Wall-clock start times (ms, "as UTC") of every occurrence before
   * exceptions are removed. Semantics follow RFC 5545 where it matters:
   * COUNT includes excluded dates, and months without the start day are
   * skipped. */
  function recurrenceStarts(m, hardLimit) {
    var s = parseLocal(m.start);
    var base = wallMs(s);
    var rec = m.recurrence;
    if (!rec) return [base];

    var interval = rec.interval || 1;
    var count = rec.count || Infinity;
    var until = Infinity;
    if (rec.until) {
      var u = parseDate(rec.until);
      if (u) until = Date.UTC(u.y, u.mo - 1, u.d, 23, 59, 59);
    }
    var tod = s.h * 3600000 + s.mi * 60000;
    var startDay = Date.UTC(s.y, s.mo - 1, s.d);
    var out = [];

    function push(ms) {
      if (ms < base || ms > until || out.length >= count || out.length >= hardLimit) return false;
      out.push(ms);
      return true;
    }

    if (rec.freq === "daily") {
      for (var i = 0; i < hardLimit * 2; i++) {
        if (!push(base + i * interval * DAY)) break;
      }
    } else if (rec.freq === "weekly") {
      var days = (rec.byday && rec.byday.length ? rec.byday : [WEEKDAYS[new Date(startDay).getUTCDay()]])
        .map(function (c) { return (WEEKDAYS.indexOf(c) + 6) % 7; }) // Monday = 0
        .sort(function (a, b) { return a - b; });
      var monday = startDay - ((new Date(startDay).getUTCDay() + 6) % 7) * DAY;
      outer:
      for (var w = 0; w < hardLimit * 2; w++) {
        for (var k = 0; k < days.length; k++) {
          var cand = monday + (w * interval * 7 + days[k]) * DAY + tod;
          if (cand < base) continue;
          if (!push(cand)) break outer;
        }
      }
    } else if (rec.freq === "monthly") {
      for (var n = 0; n < hardLimit * 4; n++) {
        var idx = (s.mo - 1) + n * interval;
        var y = s.y + Math.floor(idx / 12);
        var mo = (idx % 12) + 1;
        if (Date.UTC(y, mo - 1, 1) > until) break;
        if (s.d > daysInMonth(y, mo)) continue;
        if (!push(Date.UTC(y, mo - 1, s.d) + tod)) break;
      }
    } else {
      out.push(base);
    }
    return out;
  }

  /* All occurrences of a meeting as
   * { id, index, startLocal, endLocal, startMs, endMs, recurring }. */
  function expandOccurrences(m, opts) {
    opts = opts || {};
    var s = parseLocal(m.start);
    var e = parseLocal(m.end);
    if (!s || !e || !isValidTimeZone(m.timezone)) return [];
    var durMs = wallMs(e) - wallMs(s);
    var skip = {};
    ((m.recurrence && m.recurrence.exceptions) || []).forEach(function (d) { skip[d] = true; });

    var starts = recurrenceStarts(m, opts.maxOccurrences || 260);
    var out = [];
    starts.forEach(function (ms, i) {
      var startLocal = wallString(ms);
      if (skip[startLocal.slice(0, 10)]) return;
      var endLocal = wallString(ms + durMs);
      out.push({
        id: m.id,
        index: i,
        startLocal: startLocal,
        endLocal: endLocal,
        startMs: wallToInstant(startLocal, m.timezone),
        endMs: wallToInstant(endLocal, m.timezone),
        recurring: !!m.recurrence
      });
    });
    return out;
  }

  function classify(occ, nowMs) {
    if (occ.endMs < nowMs) return "past";
    if (occ.startMs <= nowMs) return "ongoing";
    return "upcoming";
  }

  function describeRecurrence(rec) {
    if (!rec) return "";
    var n = rec.interval || 1;
    var unit = { daily: "day", weekly: "week", monthly: "month" }[rec.freq] || rec.freq;
    var every = n === 1 ? "Every " + unit : "Every " + n + " " + unit + "s";
    if (rec.freq === "weekly" && rec.byday && rec.byday.length) every += " (" + rec.byday.join(", ") + ")";
    if (rec.count) every += ", " + rec.count + " meetings";
    else if (rec.until) every += ", until " + rec.until;
    return every;
  }

  return {
    parseLocal: parseLocal,
    parseDate: parseDate,
    isValidTimeZone: isValidTimeZone,
    zoneOffset: zoneOffset,
    wallToInstant: wallToInstant,
    wallString: wallString,
    expandOccurrences: expandOccurrences,
    classify: classify,
    describeRecurrence: describeRecurrence
  };
});
