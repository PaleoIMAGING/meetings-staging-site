# Website content guide

Content is Markdown and YAML; there are no plugins beyond the GitHub Pages set.

| What | Where |
| --- | --- |
| Navigation | `_includes/header.html` (Working Group entries come from `_data/working_groups.yml`) |
| Working Groups (title, repository, private/public) | `_data/working_groups.yml`; one page per group in `working-groups/` |
| Core Group members | `_data/core_group.yml` (empty until members are confirmed; the page shows a placeholder) |
| News | Add `_posts/YYYY-MM-DD-title.md` with `layout: post` and a `title` |
| Search | `search.json` (built index) and `assets/js/search.js`; pages with `noindex: true` are left out |
| Join Us | Links directly to the Mailman list; there is no separate registration |

The Meetings system is documented in [MEETINGS.md](MEETINGS.md) and is unchanged.
