/* PaleoIMAGING meetings: iCalendar (RFC 5545) generation.
 *
 * One implementation for every consumer: the build-time feed generator
 * (tools/build-ics.mjs), the browser's per-event download, and, later, the
 * submission Worker. Depends only on meetings-core.js. Output uses CRLF line
 * endings, folds lines at 75 octets, escapes text, and embeds a VTIMEZONE for
 * every non-UTC zone so clients need no time-zone database of their own.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./meetings-core.js"));
  else root.PaleoMeetingsIcs = factory(root.PaleoMeetings);
})(typeof self !== "undefined" ? self : this, function (core) {
  "use strict";

  var DAY = 86400000;
  var STEP = 12 * 3600000;
  var DEFAULT_ORIGIN = "https://paleoimaging.github.io";
  var UTC_ZONES = { "UTC": 1, "Etc/UTC": 1, "Etc/GMT": 1, "GMT": 1 };

  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = "0" + s;
    return s;
  }

  function escapeText(text) {
    return String(text == null ? "" : text)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");
  }

  /* Fold to <= 75 octets per physical line, never splitting a code point. */
  function foldLine(line) {
    var enc = new TextEncoder();
    var out = [];
    var cur = "";
    var bytes = 0;
    Array.from(line).forEach(function (ch) {
      var b = enc.encode(ch).length;
      if (bytes + b > 75) {
        out.push(cur);
        cur = " ";
        bytes = 1;
      }
      cur += ch;
      bytes += b;
    });
    out.push(cur);
    return out.join("\r\n");
  }

  function utc(ms) {
    var t = new Date(ms);
    return pad(t.getUTCFullYear(), 4) + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) +
      "T" + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + "Z";
  }

  /* "2026-11-10T14:00" -> "20261110T140000" */
  function floating(local) {
    return local.replace(/[-:]/g, "") + "00";
  }

  function offsetString(ms) {
    var sign = ms < 0 ? "-" : "+";
    var abs = Math.abs(ms) / 60000;
    return sign + pad(Math.floor(abs / 60)) + pad(abs % 60);
  }

  function hostOf(origin) {
    try { return new URL(origin).host; } catch (e) { return "paleoimaging.github.io"; }
  }

  function isUtcZone(tz) {
    return !!UTC_ZONES[tz];
  }

  function shortName(tz, ms) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms));
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") return parts[i].value;
    } catch (e) { /* fall through */ }
    return tz;
  }

  /* UTC offset changes of `tz` in [fromMs, toMs]: [{ at, from, to }], found
   * by scanning and then bisecting to the minute. */
  function transitions(tz, fromMs, toMs) {
    var out = [];
    var prev = core.zoneOffset(fromMs, tz);
    for (var t = fromMs + STEP; t <= toMs + STEP; t += STEP) {
      var o = core.zoneOffset(t, tz);
      if (o === prev) continue;
      var lo = t - STEP;
      var hi = t;
      while (hi - lo > 60000) {
        var mid = lo + Math.max(60000, Math.floor((hi - lo) / 2 / 60000) * 60000);
        if (core.zoneOffset(mid, tz) === prev) lo = mid; else hi = mid;
      }
      out.push({ at: hi, from: prev, to: o });
      prev = o;
    }
    return out;
  }

  /* VTIMEZONE describing `tz` over [fromMs, toMs] as explicit observances. */
  function vtimezone(tz, fromMs, toMs) {
    var off0 = core.zoneOffset(fromMs, tz);
    var lines = [
      "BEGIN:VTIMEZONE",
      "TZID:" + tz,
      "BEGIN:STANDARD",
      "DTSTART:" + floating(core.wallString(fromMs + off0)),
      "TZOFFSETFROM:" + offsetString(off0),
      "TZOFFSETTO:" + offsetString(off0),
      "TZNAME:" + escapeText(shortName(tz, fromMs)),
      "END:STANDARD"
    ];
    transitions(tz, fromMs, toMs).forEach(function (tr) {
      var kind = tr.to > tr.from ? "DAYLIGHT" : "STANDARD";
      lines.push(
        "BEGIN:" + kind,
        "DTSTART:" + floating(core.wallString(tr.at + tr.from)),
        "TZOFFSETFROM:" + offsetString(tr.from),
        "TZOFFSETTO:" + offsetString(tr.to),
        "TZNAME:" + escapeText(shortName(tz, tr.at)),
        "END:" + kind
      );
    });
    lines.push("END:VTIMEZONE");
    return lines;
  }

  function dateProp(name, local, tz) {
    if (isUtcZone(tz)) return name + ":" + floating(local).replace(/$/, "Z");
    return name + ";TZID=" + tz + ":" + floating(local);
  }

  function placeOf(m) {
    if (m.format === "online") return "Online";
    var loc = m.location || {};
    var place = [loc.venue, loc.city, loc.country].filter(Boolean).join(", ");
    return m.format === "hybrid" ? place + " (also online)" : place;
  }

  function statusFor(m, cfg) {
    var id = m.status || "scheduled";
    var list = (cfg && cfg.statuses) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id && list[i].ics_status) return list[i].ics_status;
    return id === "cancelled" ? "CANCELLED" : id === "postponed" ? "TENTATIVE" : "CONFIRMED";
  }

  function rrule(m, occs) {
    var r = m.recurrence;
    var parts = ["FREQ=" + String(r.freq).toUpperCase(), "INTERVAL=" + (r.interval || 1)];
    if (r.freq === "weekly") {
      if (r.byday && r.byday.length) parts.push("BYDAY=" + r.byday.join(","));
      parts.push("WKST=MO");
    }
    if (r.count) parts.push("COUNT=" + r.count);
    else if (r.until && occs.length) parts.push("UNTIL=" + utc(occs[occs.length - 1].startMs)); // exact UTC bound
    return "RRULE:" + parts.join(";");
  }

  /* Content lines (unfolded) of one VEVENT; also reports the instant range. */
  function eventLines(m, cfg, opts) {
    var origin = opts.origin || DEFAULT_ORIGIN;
    var occs = core.expandOccurrences(m);
    if (!occs.length) return null;
    var page = origin + "/meetings/#" + m.id;
    var desc = [m.description || ""];
    if (m.access === "registration" && m.registration_url) desc.push("Registration: " + m.registration_url);
    if (m.access === "private" && m.access_note) desc.push(m.access_note);
    desc.push(page);

    var lines = [
      "BEGIN:VEVENT",
      "UID:" + m.id + "@" + hostOf(origin),
      "DTSTAMP:" + utc(opts.stamp),
      "SEQUENCE:0",
      dateProp("DTSTART", occs[0].startLocal, m.timezone),
      dateProp("DTEND", occs[0].endLocal, m.timezone)
    ];
    if (m.recurrence) {
      lines.push(rrule(m, occs));
      ((m.recurrence.exceptions) || []).forEach(function (d) {
        lines.push(dateProp("EXDATE", d + occs[0].startLocal.slice(10), m.timezone));
      });
    }
    lines.push(
      "SUMMARY:" + escapeText(m.title),
      "DESCRIPTION:" + escapeText(desc.filter(Boolean).join("\n\n")),
      "LOCATION:" + escapeText(placeOf(m)),
      "CATEGORIES:" + (m.wgs || []).map(function (w) { return escapeText(w.toUpperCase()); }).join(","),
      "STATUS:" + statusFor(m, cfg),
      "TRANSP:OPAQUE",
      "URL:" + (m.access === "public" && m.url ? m.url : page),
      "END:VEVENT"
    );
    return { lines: lines, from: occs[0].startMs, to: occs[occs.length - 1].endMs };
  }

  /* The full subscribable calendar. `meetings` are validated records. */
  function buildCalendar(meetings, cfg, opts) {
    opts = opts || {};
    opts.stamp = opts.stamp || Date.now();
    var name = (cfg && cfg.ui && cfg.ui.calendar_name) || "PaleoIMAGING meetings";
    var sorted = meetings.slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1; });

    var zones = {};
    var events = [];
    sorted.forEach(function (m) {
      var ev = eventLines(m, cfg, opts);
      if (!ev) return;
      events.push(ev.lines);
      if (!isUtcZone(m.timezone)) {
        var z = zones[m.timezone] || (zones[m.timezone] = { from: Infinity, to: -Infinity });
        z.from = Math.min(z.from, ev.from);
        z.to = Math.max(z.to, ev.to);
      }
    });

    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//PaleoIMAGING//Meetings 1.0//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + escapeText(name),
      "REFRESH-INTERVAL;VALUE=DURATION:P1D",
      "X-PUBLISHED-TTL:P1D"
    ];
    Object.keys(zones).sort().forEach(function (tz) {
      lines = lines.concat(vtimezone(tz, zones[tz].from - 2 * DAY, zones[tz].to + 2 * DAY));
    });
    events.forEach(function (e) { lines = lines.concat(e); });
    lines.push("END:VCALENDAR");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  /* One occurrence as a standalone UTC-based file (browser download). */
  function buildOccurrenceIcs(m, occ, opts) {
    opts = opts || {};
    var origin = opts.origin || DEFAULT_ORIGIN;
    var page = origin + "/meetings/#" + m.id;
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PaleoIMAGING//Meetings 1.0//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + m.id + "-" + occ.startLocal.replace(/[-:]/g, "") + "@" + hostOf(origin),
      "DTSTAMP:" + utc(opts.nowMs || Date.now()),
      "DTSTART:" + utc(occ.startMs),
      "DTEND:" + utc(occ.endMs),
      "SUMMARY:" + escapeText(m.title),
      "DESCRIPTION:" + escapeText([m.description || "", page].filter(Boolean).join("\n\n")),
      "LOCATION:" + escapeText(placeOf(m)),
      "STATUS:" + statusFor(m, opts.config),
      "URL:" + (m.access === "public" && m.url ? m.url : page),
      "END:VEVENT", "END:VCALENDAR"
    ];
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  return {
    escapeText: escapeText,
    foldLine: foldLine,
    transitions: transitions,
    vtimezone: vtimezone,
    buildCalendar: buildCalendar,
    buildOccurrenceIcs: buildOccurrenceIcs
  };
});
