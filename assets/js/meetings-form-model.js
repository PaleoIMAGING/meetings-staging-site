/* PaleoIMAGING meetings: submission-form model (pure, no DOM).
 *
 * Turns the raw form values into a meeting record and maps validator output
 * back to form controls. It contains NO validation rules of its own: every
 * rule comes from meetings-validate.js and _data/meetings_config.yml. What
 * lives here is only presentation logic: which inputs are relevant for the
 * current answers, how the answers map onto the record, and friendlier wording
 * for the validator's messages.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaleoMeetingsFormModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function emptyOrganizer() {
    return { name: "", affiliation: "" };
  }

  function defaultValues() {
    return {
      title: "", description: "", type: "", wgs: [],
      date: "", startTime: "", endTime: "", multiDay: false, endDate: "",
      timezone: "", tzOther: "",
      recFreq: "none", recInterval: "1", recEnd: "count", recCount: "", recUntil: "", recByday: [], recExceptions: "",
      format: "", venue: "", city: "", country: "", address: "", platform: "",
      access: "", url: "", registrationUrl: "", accessNote: "",
      organizers: [emptyOrganizer()]
    };
  }

  function find(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* Which optional inputs are relevant for the current answers. */
  function visibility(values, config) {
    var fmt = find(config.formats, values.format);
    var onlineCapable = !!values.format && values.format !== "in-person";
    var hasRec = values.recFreq && values.recFreq !== "none";
    return {
      endDate: !!values.multiDay,
      tzOther: values.timezone === "__other__",
      recInterval: !!hasRec,
      recEnd: !!hasRec,
      recCount: !!hasRec && values.recEnd === "count",
      recUntil: !!hasRec && values.recEnd === "until",
      recByday: values.recFreq === "weekly",
      recExceptions: !!hasRec,
      location: !!fmt && fmt.requires.some(function (p) { return p.indexOf("location.") === 0; }),
      platform: onlineCapable,
      url: values.access === "public" && onlineCapable,
      registrationUrl: values.access === "registration",
      accessNote: values.access === "private"
    };
  }

  function trimmed(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  function isFilled(o) {
    return !!(o && (trimmed(o.name) || trimmed(o.affiliation)));
  }

  function put(obj, key, value) {
    if (value !== "" && value !== undefined) obj[key] = value;
  }

  function number(v) {
    var s = trimmed(v);
    return s === "" ? undefined : Number(s);
  }

  /* Provisional id; the Worker assigns the definitive one. */
  function provisionalId(values) {
    var slug = slugify(values.title).slice(0, 55).replace(/-+$/, "") || "proposal";
    var d = trimmed(values.date).replace(/-/g, "");
    return d ? slug + "-" + d : slug;
  }

  /* Form values -> meeting record. Irrelevant (hidden) inputs never leak in. */
  function buildRecord(values, config) {
    var vis = visibility(values, config);
    var rec = { schema_version: config.schema_version, id: provisionalId(values) };
    put(rec, "title", trimmed(values.title));
    put(rec, "description", trimmed(values.description));
    put(rec, "type", values.type);
    rec.wgs = (values.wgs || []).slice();
    put(rec, "format", values.format);

    var date = trimmed(values.date);
    var endDate = values.multiDay ? trimmed(values.endDate) : date;
    if (date && trimmed(values.startTime)) rec.start = date + "T" + trimmed(values.startTime);
    if (endDate && trimmed(values.endTime)) rec.end = endDate + "T" + trimmed(values.endTime);
    put(rec, "timezone", values.timezone === "__other__" ? trimmed(values.tzOther) : values.timezone);

    if (values.recFreq && values.recFreq !== "none") {
      var r = { freq: values.recFreq };
      var interval = number(values.recInterval);
      if (interval !== undefined) r.interval = interval;
      if (vis.recCount) { var c = number(values.recCount); if (c !== undefined) r.count = c; }
      if (vis.recUntil && trimmed(values.recUntil)) r.until = trimmed(values.recUntil);
      if (vis.recByday && values.recByday && values.recByday.length) {
        r.byday = WEEKDAYS.filter(function (d) { return values.recByday.indexOf(d) > -1; });
      }
      var ex = trimmed(values.recExceptions).split(/[\s,;]+/).filter(Boolean);
      if (ex.length) r.exceptions = ex;
      rec.recurrence = r;
    }

    if (vis.location) {
      var loc = {};
      put(loc, "venue", trimmed(values.venue));
      put(loc, "city", trimmed(values.city));
      put(loc, "country", trimmed(values.country));
      put(loc, "address", trimmed(values.address));
      rec.location = loc;
    }
    if (vis.platform) put(rec, "platform", trimmed(values.platform));

    put(rec, "access", values.access);
    if (vis.url) put(rec, "url", trimmed(values.url));
    if (vis.registrationUrl) put(rec, "registration_url", trimmed(values.registrationUrl));
    if (vis.accessNote) put(rec, "access_note", trimmed(values.accessNote));

    rec.organizers = (values.organizers || [])
      .filter(isFilled)
      .map(function (o) {
        var out = {};
        put(out, "name", trimmed(o.name));
        put(out, "affiliation", trimmed(o.affiliation));
        return out;
      });
    return rec;
  }

  var LOCATION_CONTROL = { venue: "venue", city: "city", country: "country", address: "address" };
  var RECURRENCE_CONTROL = {
    freq: "recFreq", interval: "recInterval", count: "recCount", until: "recUntil",
    byday: "recByday", exceptions: "recExceptions"
  };

  /* Which control a validator field path belongs to. */
  function controlFor(field, values) {
    var m;
    switch (field) {
      case "title": case "id": return "title";
      case "description": case "type": case "wgs": case "format": case "access": case "platform": return field;
      case "url": return "url";
      case "registration_url": return "registrationUrl";
      case "access_note": return "accessNote";
      case "start": return !trimmed(values.date) ? "date" : !trimmed(values.startTime) ? "startTime" : "date";
      case "end":
        if (values.multiDay && !trimmed(values.endDate)) return "endDate";
        return "endTime";
      case "timezone": return values.timezone === "__other__" ? "tzOther" : "timezone";
      case "organizers": return "organizers";
      case "recurrence": return values.recEnd === "until" ? "recUntil" : "recCount";
      default:
    }
    if ((m = /^location\.(\w+)$/.exec(field))) return LOCATION_CONTROL[m[1]] || "general";
    if ((m = /^recurrence\.(\w+)$/.exec(field))) return RECURRENCE_CONTROL[m[1]] || "general";
    if ((m = /^organizers\[(\d+)\]\.(\w+)$/.exec(field))) {
      // The record only holds non-empty rows; map its position back to the form row.
      var rows = (values.organizers || []).filter(isFilled);
      var row = rows[Number(m[1])];
      return "org-" + (row && row.rowId !== undefined ? row.rowId : m[1]) + "-" + m[2];
    }
    return "general";
  }

  function sentence(s) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + ".";
  }

  /* Validator message -> plain-language message. */
  function humanize(field, message) {
    var m;
    if (message === "required") {
      return field === "organizers" ? "Add at least one organizer." : "This field is required.";
    }
    if ((m = /^must be at most (\d+) characters$/.exec(message))) return "Use at most " + m[1] + " characters.";
    if (message.indexOf("contains markup") === 0) return "Remove “<”, “>” and control characters.";
    if (message.indexOf("must not contain email") === 0) return "Please do not include email addresses; contact details stay private.";
    if (message.indexOf("must not contain web addresses") === 0) return "Please do not paste web addresses here; use the dedicated link fields.";
    if (message.indexOf("must be a quoted local time") === 0) return "Enter a valid date and time.";
    if (message.indexOf("must be a valid IANA") === 0) return "Choose a time zone from the list, or type a valid name such as Europe/Warsaw.";
    if (message === "must be after start") return "The end must be after the start.";
    if (message.indexOf("meeting longer than") === 0) return "Meetings can last at most 14 days.";
    if (message === "must use https") return "The address must start with https://";
    if (message === "must be a valid URL") return "Enter a full web address such as https://example.org/page";
    if (message.indexOf("must not contain credentials") === 0) return "Remove the user name and password from the address.";
    if ((m = /^must be an integer from (\d+) to (\d+)$/.exec(message))) return "Enter a whole number from " + m[1] + " to " + m[2] + ".";
    if (message.indexOf("must be a quoted date") === 0) return "Enter a valid date.";
    if (message === "needs until or count") return "Choose how the series ends.";
    if ((m = /^produces more than (\d+) meetings$/.exec(message))) return "This series is too long (at most " + m[1] + " meetings).";
    if (message === "produces no meetings") return "This series produces no meetings; check the dates.";
    if (message.indexOf("must be a list of 1 to") === 0) return "Add at least one organizer.";
    if (field === "wgs" && message.indexOf("non-empty list") > -1) return "Choose at least one Working Group, or General community.";
    if (message.indexOf("cannot be combined") > -1) return "“General community” cannot be combined with a specific Working Group.";
    if (/^required for /.test(message)) return "This field is required for the chosen format or access level.";
    if (message.indexOf("must not be published") === 0) return "A join link must not be published for this access level.";
    if (message.indexOf("in-person meetings have no join link") === 0) return "In-person meetings have no join link.";
    return sentence(message);
  }

  /* Validator error strings -> { byControl: { control: [message] }, general: [message] }. */
  function groupErrors(errors, values) {
    var byControl = {};
    var general = [];
    var order = [];
    errors.forEach(function (e) {
      var i = e.indexOf(": ");
      var field = i > -1 ? e.slice(0, i) : "";
      var message = i > -1 ? e.slice(i + 2) : e;
      var control = controlFor(field, values);
      var text = humanize(field, message);
      if (control === "general") { general.push(text); return; }
      if (!byControl[control]) { byControl[control] = []; order.push(control); }
      if (byControl[control].indexOf(text) === -1) byControl[control].push(text);
    });
    return { byControl: byControl, general: general, order: order };
  }

  return {
    WEEKDAYS: WEEKDAYS,
    slugify: slugify,
    emptyOrganizer: emptyOrganizer,
    defaultValues: defaultValues,
    visibility: visibility,
    buildRecord: buildRecord,
    provisionalId: provisionalId,
    controlFor: controlFor,
    humanize: humanize,
    groupErrors: groupErrors
  };
});
