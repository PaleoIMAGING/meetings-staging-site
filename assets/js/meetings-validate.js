/* PaleoIMAGING meetings: the single record validator.
 *
 * Pure function of (record, config): no file, network, DOM or Node access, so
 * the very same file serves the build and CI tooling (tools/), the browser
 * form, and the submission Worker. The rules come from
 * _data/meetings_config.yml; only structural rules live here.
 *
 *   validate(record, config, { filenameId }) -> array of "field: message"
 *
 * An empty array means valid. Depends only on meetings-core.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./meetings-core.js"));
  else root.PaleoMeetingsValidate = factory(root.PaleoMeetings);
})(typeof self !== "undefined" ? self : this, function (core) {
  "use strict";

  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  // Plain text only: no markup, control characters or bidirectional overrides.
  var BAD_TEXT_RE = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
  var WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  var LOCATION_KEYS = ["venue", "address", "city", "country"];
  // Privacy guards for prose (see `privacy` in the config).
  var EMAIL_RE = /[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}/;
  var URL_IN_TEXT_RE = /(?:https?:\/\/|www\.)\S|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S/i;
  var RECURRENCE_KEYS = ["freq", "interval", "until", "count", "byday", "exceptions"];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function present(v) { return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === ""); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function getPath(o, p) {
    return p.split(".").reduce(function (a, k) { return isObj(a) && has(a, k) ? a[k] : undefined; }, o);
  }
  function ids(list) { return list.map(function (x) { return x.id; }); }

  function validateUrl(value, max) {
    if (typeof value !== "string" || value.length > max) return "must be a string of at most " + max + " characters";
    if (/\s/.test(value)) return "must not contain whitespace";
    if (/[<>]/.test(value)) return "must not contain < or >";
    var u;
    try { u = new URL(value); } catch (e) { return "must be a valid URL"; }
    if (u.protocol !== "https:") return "must use https";
    if (u.username || u.password) return "must not contain credentials";
    return null;
  }

  function validate(rec, config, options) {
    var filenameId = options && options.filenameId;
    var errors = [];
    function err(field, msg) { errors.push(field + ": " + msg); }
    if (!isObj(rec)) return ["record must be a mapping"];

    var L = config.limits;
    var allowed = config.fields.required.concat(config.fields.optional);
    Object.keys(rec).forEach(function (k) { if (allowed.indexOf(k) === -1) err(k, "unknown field"); });
    config.fields.required.forEach(function (k) { if (!present(rec[k])) err(k, "required"); });

    function text(field, value, max, required) {
      if (!present(value)) { if (required) err(field, "required"); return; }
      if (typeof value !== "string") return err(field, "must be a string");
      if (value.length > max) err(field, "must be at most " + max + " characters");
      if (BAD_TEXT_RE.test(value)) err(field, "contains markup or control characters");
      var priv = config.privacy || {};
      if (priv.block_emails && EMAIL_RE.test(value)) err(field, "must not contain email addresses (contact details stay private)");
      if (priv.block_urls_in_text && URL_IN_TEXT_RE.test(value)) err(field, "must not contain web addresses (use the dedicated link fields)");
    }

    if (present(rec.schema_version) &&
        !(Number.isInteger(rec.schema_version) && rec.schema_version >= 1 && rec.schema_version <= config.schema_version)) {
      err("schema_version", "must be an integer from 1 to " + config.schema_version);
    }

    if (!SLUG_RE.test(String(rec.id == null ? "" : rec.id)) || String(rec.id).length > 80) err("id", "must be a lowercase slug (max 80)");
    else if (filenameId && rec.id !== filenameId) err("id", "must match the file name (" + filenameId + ")");

    text("title", rec.title, L.title, true);
    text("description", rec.description, L.description);
    text("access_note", rec.access_note, L.access_note);
    text("platform", rec.platform, L.platform);

    // Working groups (retired ids stay valid for old records).
    if (!Array.isArray(rec.wgs) || rec.wgs.length === 0) err("wgs", "must be a non-empty list");
    else {
      var wgIds = ids(config.wgs);
      rec.wgs.forEach(function (w) { if (wgIds.indexOf(w) === -1) err("wgs", 'unknown working group "' + w + '"'); });
      if (new Set(rec.wgs).size !== rec.wgs.length) err("wgs", "duplicate entries");
      var excl = config.wgs.filter(function (w) { return w.exclusive; }).map(function (w) { return w.id; });
      var hit = rec.wgs.filter(function (w) { return excl.indexOf(w) > -1; })[0];
      if (hit && rec.wgs.length > 1) err("wgs", '"' + hit + '" cannot be combined with other groups');
    }

    if (present(rec.type) && ids(config.types).indexOf(rec.type) === -1) err("type", 'unknown type "' + rec.type + '"');
    if (present(rec.status) && ids(config.statuses).indexOf(rec.status) === -1) err("status", 'unknown status "' + rec.status + '"');

    // Time
    var s = core.parseLocal(rec.start);
    var e = core.parseLocal(rec.end);
    var tzOk = typeof rec.timezone === "string" && core.isValidTimeZone(rec.timezone);
    if (present(rec.start) && !s) err("start", 'must be a quoted local time like "2026-11-10T14:00"');
    if (present(rec.end) && !e) err("end", 'must be a quoted local time like "2026-11-10T15:00"');
    if (present(rec.timezone) && !tzOk) err("timezone", "must be a valid IANA time zone");
    if (s && e && tzOk) {
      var a = core.wallToInstant(rec.start, rec.timezone);
      var b = core.wallToInstant(rec.end, rec.timezone);
      if (!(b > a)) err("end", "must be after start");
      else if (b - a > 14 * 86400000) err("end", "meeting longer than 14 days");
    }

    // Format and location
    var fmt = config.formats.filter(function (f) { return f.id === rec.format; })[0];
    if (present(rec.format) && !fmt) err("format", 'unknown format "' + rec.format + '"');
    if (rec.location !== undefined) {
      if (!isObj(rec.location)) err("location", "must be a mapping");
      else Object.keys(rec.location).forEach(function (k) {
        if (LOCATION_KEYS.indexOf(k) === -1) err("location." + k, "unknown field");
        else text("location." + k, rec.location[k], L[k]);
      });
    }
    if (fmt) fmt.requires.forEach(function (p) { if (!present(getPath(rec, p))) err(p, "required for " + fmt.id + " meetings"); });

    // Access: public records never carry private links.
    var acc = config.access.filter(function (x) { return x.id === rec.access; })[0];
    if (present(rec.access) && !acc) err("access", 'unknown access level "' + rec.access + '"');
    if (acc) {
      var skip = (acc.requires_skip_formats || []).indexOf(rec.format) > -1;
      if (!skip) acc.requires.forEach(function (p) { if (!present(getPath(rec, p))) err(p, 'required for access "' + acc.id + '"'); });
      if (acc.id !== "public" && present(rec.url)) err("url", 'must not be published when access is "' + acc.id + '"');
      if (acc.id !== "registration" && present(rec.registration_url)) err("registration_url", 'only allowed when access is "registration"');
    }
    ["url", "registration_url"].forEach(function (f) {
      if (present(rec[f])) { var m = validateUrl(rec[f], L.url); if (m) err(f, m); }
    });
    if (rec.format === "in-person" && present(rec.url)) err("url", "in-person meetings have no join link");

    // Organizers: names and affiliations only. Contact details stay private.
    if (present(rec.organizers)) {
      if (!Array.isArray(rec.organizers) || rec.organizers.length < 1 || rec.organizers.length > L.organizers) err("organizers", "must be a list of 1 to " + L.organizers);
      else rec.organizers.forEach(function (o, i) {
        var at = "organizers[" + i + "]";
        if (!isObj(o)) return err(at, "must be a mapping");
        Object.keys(o).forEach(function (k) {
          if (k !== "name" && k !== "affiliation") err(at + "." + k, "not allowed in public data (contact details stay private)");
        });
        text(at + ".name", o.name, L.organizer_name, true);
        text(at + ".affiliation", o.affiliation, L.organizer_affiliation);
      });
    }

    // Links (agenda, minutes, recording...)
    if (rec.links !== undefined) {
      if (!Array.isArray(rec.links) || rec.links.length > L.links) err("links", "must be a list of at most " + L.links);
      else rec.links.forEach(function (l, i) {
        var at = "links[" + i + "]";
        if (!isObj(l)) return err(at, "must be a mapping");
        Object.keys(l).forEach(function (k) { if (k !== "label" && k !== "url") err(at + "." + k, "unknown field"); });
        text(at + ".label", l.label, L.link_label, true);
        var m = validateUrl(l.url, L.url);
        if (m) err(at + ".url", m);
      });
    }

    if (present(rec.language) && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(rec.language)) err("language", "must be a language code such as en");
    if (rec.sample !== undefined && typeof rec.sample !== "boolean") err("sample", "must be true or false");

    // Recurrence
    if (rec.recurrence !== undefined) {
      var r = rec.recurrence;
      var R = config.recurrence;
      var before = errors.length;
      if (!isObj(r)) err("recurrence", "must be a mapping");
      else {
        Object.keys(r).forEach(function (k) { if (RECURRENCE_KEYS.indexOf(k) === -1) err("recurrence." + k, "unknown field"); });
        if (R.freqs.indexOf(r.freq) === -1) err("recurrence.freq", "must be one of " + R.freqs.join(", "));
        if (r.interval !== undefined && !(Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= R.max_interval)) err("recurrence.interval", "must be an integer from 1 to " + R.max_interval);
        if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1 && r.count <= R.max_occurrences)) err("recurrence.count", "must be an integer from 1 to " + R.max_occurrences);
        if (r.until !== undefined && !core.parseDate(r.until)) err("recurrence.until", 'must be a quoted date like "2027-06-30"');
        if (r.until !== undefined && r.count !== undefined) err("recurrence", "use either until or count, not both");
        if (R.require_end && r.until === undefined && r.count === undefined) err("recurrence", "needs until or count");
        if (r.byday !== undefined) {
          if (r.freq !== "weekly") err("recurrence.byday", "only valid for weekly series");
          else if (!Array.isArray(r.byday) || !r.byday.length || r.byday.some(function (d) { return WEEKDAYS.indexOf(d) === -1; })) err("recurrence.byday", "must be a list of " + WEEKDAYS.join(", "));
        }
        if (r.exceptions !== undefined && (!Array.isArray(r.exceptions) || r.exceptions.length > 100 || r.exceptions.some(function (d) { return !core.parseDate(d); }))) err("recurrence.exceptions", "must be a list of quoted dates");
      }
      // Expand only when the series itself is well formed, so bad input cannot loop.
      if (errors.length === before && s && e && tzOk) {
        var n = core.expandOccurrences(rec, { maxOccurrences: R.max_occurrences + 1 }).length;
        if (n > R.max_occurrences) err("recurrence", "produces more than " + R.max_occurrences + " meetings");
        if (n === 0) err("recurrence", "produces no meetings");
      }
    }
    return errors;
  }

  return { validate: validate, validateUrl: validateUrl };
});
