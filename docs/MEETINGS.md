# PaleoIMAGING meetings: data model and operations

This document describes how the public meetings calendar (`/meetings/`) is
built and how to change it. Everything is English. The design is provisional:
the Working Group can change groups, meeting types, required fields and
presentation by editing configuration, not code.

## Where things live

| Path | Purpose |
| --- | --- |
| `_data/meetings_config.yml` | Governance and presentation settings (groups, types, formats, access levels, statuses, recurrence limits, field limits, UI options). |
| `_data/meetings/<id>.yml` | One file per meeting. The file name equals the record `id`. |
| `meetings/submit/index.html`, `assets/js/meetings-form*.js` | The submission form (review-only for now; see "Submission form"). |
| `meetings/index.html` | Calendar page (Liquid renders data, `assets/js/meetings-page.js` adds filters). |
| `meetings/feed.ics` | The subscribable iCalendar feed. A **generated** file (see "Calendar feed"); do not edit by hand. |
| `assets/js/meetings-core.js`, `meetings-validate.js`, `meetings-ics.js`, `meetings-render.js` | The shared logic: time zones and recurrence, the record validator, iCalendar generation. One implementation used by the page, CI and the future Worker. |
| `tools/` | Node tooling and tests (never published): validator CLI, feed generator, shared-file manifest, 114 tests. |
| `tools/test/fixtures/` | The eight **sample** meetings and the portable validation vectors. Used only by tests and CI; never published. |

## Meeting record (schema version 2)

```yaml
schema_version: 1
id: wg2-call-2027-01            # lowercase slug, must match the file name
title: "WG2 interlab call"      # plain text
description: "Optional text."   # plain text, no markup
wgs: [wg2]                      # ids from meetings_config.yml; "general" stands alone
type: wg-meeting                # id from meetings_config.yml
format: online                  # online | in-person | hybrid
status: scheduled               # optional: scheduled | postponed | cancelled
platform: "Zoom"                # optional, online and hybrid: platform name only, never a link
start: "2027-01-12T10:00"       # QUOTED local time at the venue / in `timezone`
end: "2027-01-12T11:00"
timezone: "Europe/Warsaw"       # IANA name
access: public                  # public | registration | private
url: "https://example.org/join" # only when access is public
organizers:
  - name: "Name"
    affiliation: "Institution"  # names and affiliations only
location:                       # required for in-person and hybrid
  venue: "..."
  city: "..."
  country: "..."
recurrence:                     # optional
  freq: weekly                  # daily | weekly | monthly
  interval: 2                   # every 2 weeks
  count: 8                      # or `until: "2027-06-30"` (not both)
  byday: [MO, TH]               # weekly only
  exceptions: ["2027-02-09"]    # skipped dates (still count toward `count`)
links:                          # agenda, minutes, recording
  - label: "Minutes"
    url: "https://example.org/minutes"
```

Rules enforced by `tools/validate-meetings.mjs` (and by CI on pull requests):

- Unknown fields are rejected. Organizer **contact details have no field** and
  are rejected if added; they must never enter the public repository.
- Text fields are plain text: `<`, `>`, control characters and bidirectional
  override characters are rejected, and every field has a length limit.
- URLs must be `https`, free of credentials.
- Join links (`url`) are only allowed when `access: public`. Registration and
  invitation-only meetings publish only a registration page or a note such as
  "Link sent to WG1 members". The real private link is shared outside the repo.
- Times must be quoted strings, valid for the stated time zone, with `end`
  after `start`.
- Recurring series must have an end (`until` or `count`) and stay within the
  configured maximum.

## What the community can change without code

Edit `_data/meetings_config.yml`:

- **Working Groups** (`wgs`): add, rename, or retire (`active: false`).
- **Meeting types, formats, access levels, statuses**: same pattern.
- **Required fields per format**: the `requires` lists.
- **Limits and recurrence rules**: `limits`, `recurrence`.
- **Presentation**: `ui` (default tab, how many occurrences of a series are
  shown under "Upcoming", calendar name, the submission banner).

Compatibility rule: never delete or rename an id that existing records use.
Mark it `active: false`; it then disappears from the filters but old records
remain valid. New fields are added as optional fields and bump
`schema_version`; the validator accepts any version up to the configured one.

## Time, recurrence and archive

- Records store local wall-clock time plus an IANA zone. The page converts to
  the viewer's zone in the browser. A series keeps its local time across
  daylight-saving changes.
- Whether a meeting is upcoming or past is decided in the browser at view
  time, so the archive stays correct between site rebuilds. Past meetings are
  never deleted; they move to the **Past** tab.
- Recurring series are expanded in the browser; the feed carries `RRULE` and
  `EXDATE` so calendar apps expand them themselves.

## Calendar feed (iCalendar)

`meetings/feed.ics` is generated by `tools/build-ics.mjs` using
`assets/js/meetings-ics.js`, because Jekyll's Liquid cannot produce a
standards-compliant feed. The output has:

- CRLF line endings, lines folded at 75 octets, RFC 5545 text escaping
  (record text cannot inject calendar properties);
- an embedded `VTIMEZONE` for every non-UTC zone (built from the platform's
  real offset history), so clients do not depend on their own tz database;
  UTC meetings use plain UTC times;
- `RRULE` (with `WKST=MO`, exact UTC `UNTIL`), `EXDATE`, `STATUS`,
  `SEQUENCE`, `REFRESH-INTERVAL`;
- private meetings with title and time only, never a join link.

Verified by tests that parse the feed with an independent iCalendar library
(ical.js) and compare every occurrence of every sample series, including
daylight-saving changes, with our own expansion. Real-client import (Google
Calendar, Apple Calendar, Outlook, Thunderbird) has not been tested by
automation and should be checked manually once real events exist.

Because GitHub Pages' standard build cannot run scripts, the generated feed is
**committed**. After changing records run:

```bash
cd tools && npm run build:ics
```

CI fails a pull request whose feed is stale (`npm run check:ics`). To remove
this manual step, the site can later be deployed from a GitHub Actions
workflow that generates the feed during the build (this needs the repository's
Pages source switched to "GitHub Actions", an admin decision that has not been
made). The per-event "Add to calendar" download is generated in the browser by
the same module and is a standalone UTC file.

## Shared validation (website, CI, Worker)

There is exactly one validator: `assets/js/meetings-validate.js`. It is a pure
function `validate(record, config, { filenameId })` returning a list of
`"field: message"` strings, driven by `_data/meetings_config.yml`. It has no
file, network, DOM or Node dependencies (enforced by tests that load it in a
bare realm and compare results with Node), so it runs unchanged in:

| Consumer | How it uses the shared code |
| --- | --- |
| Website CI and local tools | `tools/validate-meetings.mjs`, `tools/build-ics.mjs` |
| Browser (submission form, later) | loaded as a classic script |
| Cloudflare Worker (private repo, later) | vendored by a sync script that copies the files listed in `tools/shared-manifest.json` and verifies their SHA-256 |

`tools/test/fixtures/validation-vectors.json` is a portable contract: the
Worker repository must run the same vectors against its copy. The
configuration can also be fetched by the Worker at runtime (with a bundled
fallback), so governance changes apply without redeploying it. After any
change to a shared file run `npm run shared:write`; CI runs
`npm run shared:check`.

## Local preview and checks

```bash
# Site (needs Ruby): same gems as GitHub Pages
bundle install
bundle exec jekyll serve          # http://localhost:4000/meetings/

# Validation and tests (needs Node 20+)
cd tools
npm ci
npm test                # 114 tests
npm run validate        # published records
npm run check:ics       # committed feed is current
npm run shared:check    # shared-file manifest is current

# After building the site:
#   node tools/site-test.mjs <_site> --empty      (also --samples, --hostile on special builds)
#   node tools/form-test.mjs <_site>               (submission form behaviour)
# (CI also builds a copy with the sample fixtures and runs --samples)
```

## Submission form (`/meetings/submit/`)

A single-page form with four sections (Meeting information, Date & Time,
Location & Access, Organizer), a review step that previews the proposal exactly
as the calendar will show it, and a "data that would be sent" panel.

**Current status: review-only.** The submit button is disabled and the form
script contains no network code at all (a test enforces this). It is not linked
from the site navigation and is marked `noindex`. Submissions will be enabled
only after the Cloudflare Worker is deployed and tested.

How it stays consistent with the rest of the system:

- Options, labels, help text, required fields, limits and the time-zone list
  come from `_data/meetings_config.yml`. Changing a Working Group, format,
  access level or limit there changes the form with no code change.
- The form has **no validation rules of its own**. It builds a record from the
  answers (`assets/js/meetings-form-model.js`, pure and unit-tested) and runs
  the shared validator (`meetings-validate.js`). Messages are translated to
  plain language and attached to the right control.
- Inputs that do not apply to the chosen answers are hidden, and **never reach
  the record**, so switching to "Invitation only" after typing a public link
  drops the link.
- The preview uses the same renderer as the calendar (`meetings-render.js`).

Privacy and safety rules (enforced by the shared validator, so the Worker
inherits them):

- No email or phone fields exist. Email addresses in any free-text field are
  rejected, and so are web addresses in prose (join links belong in the
  dedicated, reviewed link fields). Join links are published only for open
  meetings; registration meetings publish only the registration page;
  invitation-only meetings publish a short note.
- All text is rendered with `textContent`; there is no `innerHTML`. URLs must
  be https and may not contain `<` or `>`. Embedded JSON escapes `<`.
- A hidden honeypot field is in place for the future Worker. A browser-side
  draft is kept in `sessionStorage` only (cleared with "Clear form"), is
  validated on restore, and never leaves the browser.

Time zones: a curated, region-grouped list with common names (editable in the
config), a live "UTC offset on your date" hint, an explicit "use my browser's
time zone" button (never preselected), and a free-text IANA escape hatch.

Accessibility: every control has a label, groups use fieldset/legend, required
fields are marked by symbol, text and `aria-required`, errors are inline and
summarised in a focused alert with links to each field, and everything is
operable with the keyboard. Automated tests cover this structure; a manual
screen-reader pass is still recommended before launch.

## Sample data and the empty state

The eight sample meetings live in `tools/test/fixtures/meetings/` and are used
only by tests and the CI sample build. They are **not** in `_data/meetings/`,
so the published calendar starts empty and shows "No meetings are scheduled
yet". A test fails if a record marked `sample: true` (or named `sample-*`) ever
appears in `_data/meetings/`. The page also carries `noindex` until the
calendar is announced (remove `noindex: true` from `meetings/index.html`).
The homepage does not link to the calendar yet; navigation is enabled
separately.

## Continuous integration

- `validate-meetings.yml`: tests, record validation, feed and manifest freshness (on changes to meetings files and tools).
- `build-check.yml`: builds the site with the GitHub Pages gem set as published, with the sample fixtures, and with a deliberately hostile record, then runs the site checks and the form tests. It runs on pull requests and non-`main` branches, has read-only permissions and **never deploys**.

## Planned (not part of this phase)

The submission form, the Cloudflare Worker that opens review pull requests,
Turnstile, rate limiting, GitHub App authentication and branch protection are
specified separately. Until then `ui.submission.enabled` stays `false`.
