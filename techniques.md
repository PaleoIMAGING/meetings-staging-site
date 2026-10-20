---
layout: default
title: Imaging Techniques
description: The imaging and analytical scanning techniques used in PaleoIMAGING and what they contribute to paleoenvironmental reconstruction.
permalink: /techniques/
---
# Imaging techniques

<p class="lead">PaleoIMAGING brings together four families of imaging and scanning techniques. Each records a different property of the same archive, and the group works towards combining them in multi-proxy datasets aligned at micrometer scale.</p>

<ul class="list">
{%- for t in site.data.techniques %}
  <li class="card" id="{{ t.id | escape }}">
    <p class="meta"><span class="chip">{{ t.abbr | escape }}</span></p>
    <h2>{{ t.name | escape }}</h2>
    <p><strong>What it measures.</strong> {{ t.measures | escape }}</p>
    <p><strong>Why it matters.</strong> {{ t.relevance | escape }}</p>
    {%- if t.resources and t.resources.size > 0 %}
    <ul class="resource-links">
      {%- for r in t.resources %}
      <li><a href="{% if r.url contains '://' %}{{ r.url | escape }}{% else %}{{ r.url | relative_url }}{% endif %}">{{ r.label | escape }}</a></li>
      {%- endfor %}
    </ul>
    {%- endif %}
  </li>
{%- endfor %}
</ul>

## Resources

- [Where We Are]({{ '/where-we-are/' | relative_url }}): which institutions run which techniques.
- [Working Groups]({{ '/working-groups/' | relative_url }}): standard materials, interlaboratory comparison, best practices and datasets.
- [PANGAEA-Paleoimaging-Deep-Search](https://github.com/PaleoIMAGING/PANGAEA-Paleoimaging-Deep-Search): survey of imaging datasets in PANGAEA.

Technique descriptions follow the [PAGES PaleoIMAGING page](https://pastglobalchanges.org/paleoimaging). See [About]({{ '/about/' | relative_url }}) for the scientific goals.
