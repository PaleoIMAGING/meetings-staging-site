---
layout: default
title: Events Archive
description: Past PaleoIMAGING workshops, meetings, conferences and community events.
permalink: /meetings/archive/
---
# Events archive

<p class="lead">Past PaleoIMAGING workshops, meetings, conferences and community events. For upcoming and scheduled activities, see the <a href="{{ '/meetings/' | relative_url }}">Meetings calendar</a>.</p>

{%- assign events = site.data.past_events | sort: "start" | reverse %}
{%- if events.size > 0 %}
<ul class="list">
{%- for e in events %}
  {%- assign sy = e.start | date: "%Y" %}
  {%- assign ey = e.end | date: "%Y" %}
  <li class="card" id="{{ e.id | escape }}">
    <div class="chips">
      <span class="chip">{{ e.type | capitalize | escape }}</span>
      {%- if e.format %}<span class="chip chip--format">{{ e.format | capitalize | escape }}</span>{% endif %}
    </div>
    <h2>{{ e.title | escape }}</h2>
    <p class="when">
      {%- if e.end and e.end != e.start -%}
        {%- if sy == ey %}{{ e.start | date: "%-d %B" }}{% else %}{{ e.start | date: "%-d %B %Y" }}{% endif %} &ndash; {{ e.end | date: "%-d %B %Y" }}
      {%- else -%}
        {{ e.start | date: "%-d %B %Y" }}
      {%- endif -%}
    </p>
    <p class="meta">{{ e.location | escape }}</p>
    {%- if e.organizers %}<p class="meta">Organizers: {{ e.organizers | escape }}</p>{% endif %}
    {%- if e.summary %}<p>{{ e.summary | escape }}</p>{% endif %}
    {%- if e.links and e.links.size > 0 %}
    <ul class="resource-links">
      {%- for l in e.links %}
      <li><a href="{{ l.url | escape }}" rel="noopener">{{ l.label | escape }}</a></li>
      {%- endfor %}
    </ul>
    {%- endif %}
    <p class="meta">Source: <a href="{{ e.source.url | escape }}" rel="noopener">{{ e.source.label | escape }}</a></p>
  </li>
{%- endfor %}
</ul>
{%- else %}
<div class="empty-state">
  <h2>No past events yet</h2>
  <p>Past workshops and meetings will be listed here.</p>
</div>
{%- endif %}
