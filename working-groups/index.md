---
layout: default
title: Working Groups
description: The four PaleoIMAGING Working Groups.
permalink: /working-groups/
---
# Working Groups

<p class="lead">PaleoIMAGING work is organised in four Working Groups. Each has a workspace on GitHub.</p>

<ul class="list">
{%- for wg in site.data.working_groups %}
  <li class="card">
    <h2><a href="{{ '/working-groups/' | append: wg.slug | append: '/' | relative_url }}">{{ wg.code }} &mdash; {{ wg.title }}</a></h2>
    <p class="meta">{{ wg.summary }}</p>
  </li>
{%- endfor %}
</ul>
