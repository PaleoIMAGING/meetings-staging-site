---
layout: default
title: Core Group
description: The PaleoIMAGING Core Group.
permalink: /core-group/
---
# Core Group

<p class="lead">The Core Group coordinates PaleoIMAGING activities.</p>

{%- if site.data.core_group.size > 0 %}
<ul class="list members">
{%- for m in site.data.core_group %}
  <li class="card member">
    {%- if m.photo %}<img class="member__photo" src="{{ m.photo | relative_url }}" alt="Photograph of {{ m.name | escape }}" loading="lazy">{% endif %}
    <h2>{% if m.url %}<a href="{{ m.url }}" rel="noopener">{{ m.name }}</a>{% else %}{{ m.name }}{% endif %}</h2>
    {%- if m.role %}<p class="meta">{{ m.role }}{% if m.wg %} &middot; {{ m.wg }}{% endif %}</p>{% endif %}
    {%- if m.affiliation %}<p class="meta">{{ m.affiliation }}</p>{% endif %}
  </li>
{%- endfor %}
</ul>
{%- else %}
<div class="empty-state">
  <h2>Member list to be confirmed</h2>
  <p>Core Group members will be listed here once names, affiliations and roles have been confirmed.</p>
</div>
{%- endif %}
