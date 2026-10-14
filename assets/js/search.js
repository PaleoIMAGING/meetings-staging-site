// Minimal client-side search over /search.json (built by Jekyll). No dependencies.
(function () {
  var input = document.getElementById("q");
  var list = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  var urlEl = document.getElementById("search-index-url");
  if (!input || !list || !urlEl) return;
  var index = null;

  function norm(s) { return String(s).toLowerCase(); }
  function render(q) {
    list.textContent = "";
    var terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) { status.textContent = ""; return; }
    var hits = index.filter(function (e) {
      var hay = norm(e.title + " " + e.text);
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
    status.textContent = hits.length + (hits.length === 1 ? " result" : " results");
    hits.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "card";
      var h = document.createElement("h2");
      var a = document.createElement("a");
      a.href = e.url;
      a.textContent = e.title;
      h.appendChild(a);
      var p = document.createElement("p");
      p.className = "meta";
      p.textContent = e.text.slice(0, 160);
      li.appendChild(h);
      li.appendChild(p);
      list.appendChild(li);
    });
  }

  fetch(JSON.parse(urlEl.textContent))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      index = d;
      var q = new URLSearchParams(location.search).get("q");
      if (q) { input.value = q; render(q); }
      input.addEventListener("input", function () { render(input.value); });
    })
    .catch(function () { status.textContent = "Search is currently unavailable."; });
})();
