# Website content guide

Content is Markdown and YAML; there are no plugins beyond the GitHub Pages set.

| What | Where |
| --- | --- |
| Navigation | `_includes/header.html` (Working Group entries come from `_data/working_groups.yml`) |
| Working Groups (title, repository, private/public) | `_data/working_groups.yml`; one page per group in `working-groups/` |
| Core Group members | `_data/core_group.yml` (empty until members are confirmed; the page shows a placeholder) |
| News | Add `_posts/YYYY-MM-DD-title.md` with `layout: post` and a `title` |
| Search | `search.json` (built index) and `assets/js/search.js`; pages with `noindex: true` are left out |
| Imaging techniques (`/techniques/`) | `_data/techniques.yml`: one entry per technique (name, abbreviation, what it measures, why it matters, optional resource links and optional `image` with alt text, caption and credit; store images in `assets/images/techniques/`) |
| Past events archive (`/meetings/archive/`) | `_data/past_events.yml`: one entry per event; fields are documented at the top of the file |
| Join Us | Links directly to the Mailman list; there is no separate registration |

Adding a past event: copy an entry in `_data/past_events.yml`, fill in only verified facts, and cite a source. Note
materials that are expected but not yet public under `pending` (internal only, never shown on the site); when they are published, move them into `links`
(programme, report, presentations, photos, recordings). Entries are sorted by date automatically. Keep this file
separate from `_data/meetings/`, which holds validated calendar records and feeds the iCalendar file.

The Meetings system is documented in [MEETINGS.md](MEETINGS.md) and is unchanged.
