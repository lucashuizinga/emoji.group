// STATIC SITE GENERATOR
//   npm run site
// Reads /dist and renders the emoji.group website into site/public:
//   index.html                landing page
//   {slug}.html               one page per collection (emoji.group/blue)
//   {slug}.json               a JSON twin so emoji.group/blue.json also works
//   emojis.json, collections/, blocklists/   the raw API, copied verbatim
//   search.json               slim per emoji index for the client side search
//   favicon.svg, og.png, sitemap.xml, robots.txt, llms.txt, 404.html
// Plain Node, no framework. Design system: cream background, one orange
// accent, Instrument Sans with JetBrains Mono, per the emoji.group mockup.

import { existsSync, rmSync, cpSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ROOT, readJSON, writeJSON, ensureDir, log } from "../lib/util.js";

// Content hashed asset versions, filled in by run() before any page renders.
// Browsers cache assets for a day, and a deploy only purges the CDN, so a
// changed stylesheet must change URL or returning visitors get stale CSS.
const ASSET_V = { css: "", js: "" };

function contentHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

const DIST = `${ROOT}/dist`;
const OUT = `${ROOT}/site/public`;
const ORIGIN = "https://emoji.group";

// Human readable copy for each facet, in display order.
const FACETS = {
  vibe: { title: "Vibe", blurb: "The feeling it gives off." },
  object: { title: "Object", blurb: "The thing it depicts." },
  domain: { title: "Domain", blurb: "The industry it belongs to." },
  theme: { title: "Theme", blurb: "Moments and topics: summer, space, school, trading." },
  category: { title: "Category", blurb: "Straight from the Unicode structure: flags, faces, hands, animals. Variants included." },
  set: { title: "Sets", blurb: "Hand curated packs: the reaction canon, kid friendly fun, check marks." },
  color: { title: "Color", blurb: "Dominant hue, measured from the artwork. Tagged only when one hue covers 45% of the fill." },
  safety: { title: "Safety", blurb: "Content apps may want to exclude. Every tag is human reviewed." },
  gender: { title: "Gender", blurb: "The gender presentation of the figure, kept per record." },
  "skin-tone": { title: "Skin tone", blurb: "Every skin tone variant is its own record, pointing at its base." },
  audience: { title: "Audience", blurb: "Derived at build time, never tagged by hand." },
};
const FACET_ORDER = Object.keys(FACETS);

// Swatch colours for the colour facet chips.
const SWATCH = {
  red: "#D84A3A", orange: "#E8940A", yellow: "#E0B33A", green: "#4C9A4C",
  blue: "#4A7DD8", purple: "#8B6BD8", pink: "#E86B9A", brown: "#8A5A3B",
  black: "#1B1812", white: "#DFD9CE", gray: "#9A958A",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => n.toLocaleString("en-US");

const LOGO = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--accent)"/><circle cx="9.5" cy="11.5" r="2" fill="#1B1812"/><circle cx="18.5" cy="11.5" r="2" fill="#1B1812"/><path d="M8.5 16.5c1.5 2.2 3.3 3.3 5.5 3.3s4-1.1 5.5-3.3" stroke="#1B1812" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#E8940A"/><circle cx="9.5" cy="11.5" r="2" fill="#1B1812"/><circle cx="18.5" cy="11.5" r="2" fill="#1B1812"/><path d="M8.5 16.5c1.5 2.2 3.3 3.3 5.5 3.3s4-1.1 5.5-3.3" stroke="#1B1812" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;

function head({ title, description, path }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="emoji.group">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}${path}">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css?v=${ASSET_V.css}">
</head>
<body>`;
}

function nav() {
  return `<nav class="nav">
  <a class="brand" href="/">${LOGO(28)}<span>emoji<i>.group</i></span></a>
  <div class="navlinks">
    <a href="/#collections">Collections</a>
    <a href="/#developers">Docs</a>
    <a href="/#safety">Safety</a>
    <a class="btn dark" href="/emojis.json">Get the data</a>
  </div>
</nav>`;
}

function footer(meta) {
  return `<footer class="footer">
  <div class="footcol brandcol">
    <a class="brand" href="/">${LOGO(22)}<span>emoji<i>.group</i></span></a>
    <p class="muted">The emoji database, curated.</p>
    <p class="faint">© 2026 emoji.group · v${esc(meta.version)}</p>
  </div>
  <div class="footcol">
    <h4>Data</h4>
    <a href="/emojis.json">emojis.json</a>
    <a href="/collections/index.json">Collections index</a>
    <a href="/blocklists/index.json">Blocklists</a>
    <a href="/search.json">Search index</a>
  </div>
  <div class="footcol">
    <h4>Resources</h4>
    <a href="/#developers">Docs</a>
    <a href="/#safety">Safety model</a>
    <a href="/llms.txt">llms.txt</a>
    <a href="/sitemap.xml">Sitemap</a>
  </div>
  <div class="footcol">
    <h4>Project</h4>
    <a href="https://github.com/Lucaks3/emoji.group" rel="noopener">GitHub</a>
    <a href="/#manifesto">Manifesto</a>
  </div>
</footer>`;
}

const pageEnd = () => `</body>\n</html>\n`;

// ---------------------------------------------------------------------------
// Data helpers

function loadModel() {
  const meta = readJSON(`${DIST}/index.json`);
  const index = readJSON(`${DIST}/collections/index.json`);
  const emojis = readJSON(`${DIST}/emojis.json`);
  const collections = index.collections.map((c) => readJSON(`${DIST}/collections/${c.slug}.json`));

  // char -> record, and per facet:tag confidence and source maps.
  const byChar = new Map(emojis.map((e) => [e.char, e]));
  const conf = new Map(); // "facet tag char" -> confidence
  const src = new Map(); // "facet tag char" -> source
  for (const e of emojis) {
    for (const t of e.tags) {
      conf.set(`${t.facet} ${t.tag} ${e.char}`, t.confidence);
      src.set(`${t.facet} ${t.tag} ${e.char}`, t.source);
    }
  }

  for (const col of collections) {
    // Members ranked by confidence (most representative first) for display.
    // The JSON stays codepoint sorted; this order is presentation only.
    const tag = tagOf(col);
    col.ranked = [...col.emojis].sort((a, b) => {
      const ca = conf.get(`${col.facet} ${tag} ${a}`) ?? 0;
      const cb = conf.get(`${col.facet} ${tag} ${b}`) ?? 0;
      return cb - ca;
    });
    // Source breakdown for the trust pills.
    col.sources = { programmatic: 0, llm: 0, human: 0 };
    for (const ch of col.emojis) {
      const s = src.get(`${col.facet} ${tagOf(col)} ${ch}`);
      if (s) col.sources[s] += 1;
    }
    col.reviewedPct = col.count
      ? Math.round(((col.count - col.sources.llm) / col.count) * 100)
      : 100;
  }

  const byFacet = {};
  for (const c of collections) (byFacet[c.facet] ||= []).push(c);
  for (const list of Object.values(byFacet)) list.sort((a, b) => b.count - a.count);

  return { meta, index, emojis, collections, byFacet, byChar, conf };
}

// The tag a collection was generated from (carried explicitly in the JSON).
function tagOf(col) {
  return col.tag;
}

// Prefer full pictographs for sample glyphs, so a chip shows 👮‍♀️ rather than
// the ♀ sign when both carry the tag.
function sampleOf(col, n) {
  const pictos = col.ranked.filter((c) => c.codePointAt(0) >= 0x1f000);
  const pool = pictos.length >= n ? pictos : col.ranked;
  return pool.slice(0, n);
}

// ---------------------------------------------------------------------------
// Landing page pieces

function chip(col) {
  const sample = sampleOf(col, 1)[0] || "";
  const sw = col.facet === "color" && SWATCH[tagOf(col)]
    ? `<span class="sw" style="background:${SWATCH[tagOf(col)]}"></span>`
    : `<span class="chipglyph">${sample}</span>`;
  return `<a class="chip" href="/${esc(col.slug)}">${sw}<span class="chiptag">${esc(tagOf(col))}</span><span class="chipcount">${num(col.count)}</span></a>`;
}

function marquee(model) {
  // A scrolling strip of enlarged collection pills: a taste of the catalogue,
  // each one clickable. A curated spread across facets, not the full list.
  const want = [
    "cozy", "food", "flags", "spooky", "ai", "reactions", "summer", "blue",
    "kid-safe", "vehicle", "hearts", "space", "fun", "retro", "animals", "festive",
  ];
  const pills = want
    .map((slug) => {
      const c = model.collections.find((x) => x.slug === slug);
      if (!c) return "";
      const sw = c.facet === "color" && SWATCH[tagOf(c)]
        ? `<span class="sw big" style="background:${SWATCH[tagOf(c)]}"></span>`
        : `<span class="mpglyphs">${sampleOf(c, 3).join("")}</span>`;
      return `<a class="mpill" href="/${esc(c.slug)}">${sw}<span class="mptag">${esc(c.slug)}</span><span class="mpcount">${num(c.count)}</span></a>`;
    })
    .join("");
  return `<div class="marquee"><div class="mtrack">${pills}${pills}</div></div>`;
}

function facetCards(model) {
  const cards = [];
  for (const facet of ["vibe", "theme", "category", "object", "domain", "set", "color", "safety"]) {
    const list = model.byFacet[facet] || [];
    if (!list.length) continue;
    const info = FACETS[facet];
    const chips = list.map(chip).join("\n        ");
    const extra = facet === "safety"
      ? `<div class="cardnote">Ships as include collections and as <a href="/blocklists/index.json">exclude mode blocklists</a>.</div>`
      : "";
    cards.push(`<article class="fcard reveal">
      <div class="ftitle">${esc(info.title)}</div>
      <div class="fblurb">${esc(info.blurb)}</div>
      <div class="chips">
        ${chips}
      </div>${extra}
    </article>`);
  }
  // Variants card: gender, skin tone, audience together.
  const variantChips = [
    ...(model.byFacet.gender || []),
    ...((model.byFacet["skin-tone"] || []).filter((c) => c.slug !== "skin-tone-default")),
    ...(model.byFacet.audience || []),
  ].map(chip).join("\n        ");
  cards.push(`<article class="fcard reveal">
      <div class="ftitle">Variants, first class</div>
      <div class="fblurb">Every skin tone and gender variant is its own record, pointing at its base. Tags inherit automatically, so 👍🏿 is one GET away too.</div>
      <div class="vrows">
        <div class="vrow"><span class="vglyphs">👋 👋🏻 👋🏼 👋🏽 👋🏾 👋🏿</span><span class="vmeta">skin_tone: 1-5</span></div>
        <div class="vrow"><span class="vglyphs">🧑‍🚒 👨‍🚒 👩‍🚒</span><span class="vmeta">gender: neutral · male · female</span></div>
      </div>
      <div class="chips">
        ${variantChips}
      </div>
    </article>`);
  return cards.join("\n    ");
}

function devSection(model) {
  const cozy = model.collections.find((c) => c.slug === "cozy");
  const violent = readJSON(`${DIST}/blocklists/violent.json`);
  const sampleEmoji = model.emojis.find((e) => e.char === "🕯️") || model.emojis[0];

  const tabs = [
    {
      id: "cozy",
      label: "cozy.json",
      url: `${ORIGIN}/cozy.json`,
      body: JSON.stringify({ ...cozy, ranked: undefined, sources: undefined, reviewedPct: undefined, emojis: cozy.emojis.slice(0, 8).concat(["…"]) }, null, 2),
    },
    {
      id: "index",
      label: "collections/index.json",
      url: `${ORIGIN}/collections/index.json`,
      body: JSON.stringify({ version: model.meta.version, count: model.index.count, collections: model.index.collections.slice(0, 4).concat([{ "…": `${model.index.count - 4} more` }]) }, null, 2),
    },
    {
      id: "violent",
      label: "blocklists/violent.json",
      url: `${ORIGIN}/blocklists/violent.json`,
      body: JSON.stringify(violent, null, 2),
    },
    {
      id: "emoji",
      label: "emojis.json",
      url: `${ORIGIN}/emojis.json`,
      body: JSON.stringify([sampleEmoji, { "…": `${num(model.meta.emojis - 1)} more records` }], null, 2),
    },
  ];

  const tabBtns = tabs
    .map((t, i) => `<button class="tab${i === 0 ? " on" : ""}" data-tab="${t.id}">${esc(t.label)}</button>`)
    .join("");
  const panels = tabs
    .map(
      (t, i) => `<div class="panel${i === 0 ? " on" : ""}" id="panel-${t.id}">
      <div class="codebar"><span class="get">GET</span> <span class="url">${esc(t.url)}</span><button class="copybtn" data-copy="${esc(t.url)}">copy ⧉</button></div>
      <pre>${esc(t.body)}</pre>
    </div>`,
    )
    .join("\n");

  return `<section id="developers" class="section">
  <div class="kicker reveal">DEVELOPERS</div>
  <h2 class="reveal">No SDK. No API key. Just JSON.</h2>
  <div class="code reveal">
    <div class="tabs">${tabBtns}</div>
    ${panels}
  </div>
  <div class="negotiate reveal">
    <div class="negcol">
      <div class="neglabel">A person opens it</div>
      <div class="negbody"><span class="negurl">emoji.group/cozy</span> → the page, with copy buttons</div>
    </div>
    <div class="negmid">add .json</div>
    <div class="negcol">
      <div class="neglabel">A program requests it</div>
      <div class="negbody"><span class="negurl">emoji.group/cozy.json</span> → the raw collection</div>
    </div>
  </div>
  <div class="cards3">
    <div class="mini reveal"><h3>Deterministic</h3><p>Same input, same output. Stable codepoint order, byte for byte reproducible builds.</p></div>
    <div class="mini reveal"><h3>Versioned by date</h3><p>Pin a build and nothing changes underneath you. Upgrade when you choose.</p></div>
    <div class="mini reveal"><h3>Cache forever</h3><p>Static files on a CDN with open CORS. Ship it to the client, bundle it, or mirror everything.</p></div>
  </div>
</section>`;
}

function buildLanding(model) {
  const { meta } = model;
  return (
    head({
      title: "emoji.group · the emoji database, grouped for developers",
      description: "Stop hand-picking emoji lists. 79 ready-made collections covering all 3,816 emojis, human reviewed safety blocklists included. Static JSON on a CDN, no key, no SDK.",
      path: "/",
    }) +
    nav() +
    `
<header class="hero">
  <div class="badge reveal"><span class="dot"></span> v${esc(meta.version)} · ${num(meta.emojis)} emojis · ${meta.collections} collections</div>
  <h1 class="reveal" style="--d:.05s">The emoji database, grouped for developers</h1>
  <p class="lede reveal" style="--d:.1s">Every emoji list you were about to hand-build: food, flags, cozy, kid-safe. ${meta.collections} collections covering all ${num(meta.emojis)} emojis, served as static JSON from a CDN. No key, no SDK, one GET.</p>
  <div class="herobtns reveal" style="--d:.15s">
    <a class="btn dark" href="#collections">Browse ${meta.collections} collections</a>
    <a class="btn ghost" href="#developers">See the API →</a>
  </div>
</header>

${marquee(model)}

<section class="section searchsec" id="search">
  <div class="searchbox reveal">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
    <input id="q" type="search" placeholder="Search ${num(meta.emojis)} emojis: try truck, cozy, or 🌵" autocomplete="off" spellcheck="false" aria-label="Search emojis">
  </div>
  <div id="results" class="results" aria-live="polite"></div>
</section>

<section id="collections" class="section">
  <div class="kicker reveal">COLLECTIONS</div>
  <h2 class="reveal">Sorted by how people actually use them</h2>
  <div class="fgrid">
    ${facetCards(model)}
  </div>
</section>

${devSection(model)}

<section id="safety" class="section">
  <div class="kicker reveal">SAFETY</div>
  <h2 class="reveal">Blocklists a human signed off on</h2>
  <p class="lede center reveal">Suggestive, violent, substances, gambling. Every safety tag passes three gates before it ships, and the build fails if one hasn't.</p>
  <div class="cards3">
    <div class="mini step reveal"><span class="stepno">STEP 1</span><h3>Programmatic pass</h3><p>Codepoints, ZWJ sequences and artwork analysis tag everything a rule can prove.</p></div>
    <div class="mini step reveal"><span class="stepno">STEP 2</span><h3>Model proposals</h3><p>An LLM tags against a closed vocabulary with a confidence score. It can propose, never publish.</p></div>
    <div class="mini step reveal"><span class="stepno">STEP 3</span><h3>Human review</h3><p>A person approves every safety tag. The compiler rejects any that a human hasn't seen.</p></div>
  </div>
  <div class="kidsafe reveal">
    <span class="kidglyph">🧒</span>
    <p><b>Kid-safe is derived, not tagged.</b> It is everything minus the safety blocklists, computed at build time, so it can never drift out of sync.</p>
    <a class="kidmeta" href="/kid-safe">kid-safe.json · ${num(model.collections.find((c) => c.slug === "kid-safe")?.count || 0)} emojis</a>
  </div>
</section>

<section class="section" id="manifesto">
  <div class="manifesto reveal">
    <div class="mtitle">We want emoji to be boring.</div>
    <div class="mbody">
      <p>Every app rebuilds the same lists. Which emojis are food. Which are safe for kids. Which ones are actually purple. Then Unicode ships a new version, and the lists quietly rot.</p>
      <p>emoji.group is that work done once, in the open: deterministic builds, human reviewed safety tags, and static JSON that will still resolve in ten years.</p>
      <p>Pin a version and forget about us. That is the point.</p>
    </div>
    <div class="sig">· the emoji.group team 🫶</div>
  </div>
</section>

<section class="section cta">
  <div class="ctatitle reveal">Start with one GET</div>
  <button class="terminal reveal" data-copy="curl https://emoji.group/collections/index.json" title="Copy command"><span class="prompt">$</span> curl https://emoji.group/collections/index.json<span class="cursor">▌</span></button>
</section>
` +
    footer(meta) +
    `<div class="toast" id="toast">Copied</div>
<script src="/site.js?v=${ASSET_V.js}" defer></script>
` +
    pageEnd()
  );
}

// ---------------------------------------------------------------------------
// Collection pages

function buildCollection(model, col) {
  const info = FACETS[col.facet] || { title: col.facet, blurb: "" };
  const tag = tagOf(col);
  const siblings = (model.byFacet[col.facet] || []).filter((c) => c.slug !== col.slug);
  const sibNav = siblings.length
    ? `<div class="sibs">${siblings.map((s) => `<a class="chip" href="/${esc(s.slug)}"><span class="chiptag">${esc(tagOf(s))}</span><span class="chipcount">${num(s.count)}</span></a>`).join("")}</div>`
    : "";

  const grid = col.ranked
    .map((c) => {
      const rec = model.byChar.get(c);
      const cf = model.conf.get(`${col.facet} ${tag} ${c}`);
      const title = `${rec ? rec.name : c}${cf != null ? ` · ${cf}` : ""}`;
      return `<button class="ecell" title="${esc(title)}" data-c="${esc(c)}" data-n="${esc(rec ? rec.name : "")}">${c}</button>`;
    })
    .join("");

  const modeBadge = col.mode === "exclude"
    ? `<span class="pill warn">exclude mode</span>`
    : `<span class="pill ok">include mode</span>`;
  const srcPills = [
    col.sources.human ? `<span class="pill">human reviewed ${num(col.sources.human)}</span>` : "",
    col.sources.programmatic ? `<span class="pill">measured ${num(col.sources.programmatic)}</span>` : "",
    col.sources.llm ? `<span class="pill">model proposed ${num(col.sources.llm)}</span>` : "",
  ].join("");

  const fetchSnippet = `const ${tag.replace(/-/g, "_")} = await fetch("${ORIGIN}/${col.slug}.json")\n  .then(r => r.json()); // { emojis: [...], count: ${col.count} }`;

  return (
    head({
      title: `${col.title} emojis · emoji.group`,
      description: `${col.count} ${col.title.toLowerCase()} emojis, ${col.facet} facet, curated by emoji.group. Static JSON at ${ORIGIN}/${col.slug}.json`,
      path: `/${col.slug}`,
    }) +
    nav() +
    `
<main class="detail">
  <div class="crumbs"><a href="/">emoji.group</a> <span>/</span> <a href="/#collections">${esc(col.facet)}</a> <span>/</span> <span class="cur">${esc(col.slug)}</span></div>
  <div class="dhead">
    <div>
      <div class="kicker left">${esc(col.facet.toUpperCase())}</div>
      <h1>${esc(col.title)}</h1>
      <p class="muted">${esc(info.blurb)}</p>
    </div>
    <div class="dmeta">
      ${modeBadge}
      <span class="pill">${num(col.count)} emojis</span>
      <span class="pill">v${esc(col.version)}</span>
      ${srcPills}
    </div>
  </div>
  <div class="dactions">
    <button class="btn dark" id="copyall">Copy all ${num(col.count)}</button>
    <a class="btn ghost" href="/${esc(col.slug)}.json">View JSON →</a>
    <input id="filter" type="search" placeholder="Filter by name…" aria-label="Filter emojis by name">
  </div>
  <p class="ranknote">Ranked by how strongly each emoji matches, most representative first. The <a href="/${esc(col.slug)}.json">JSON</a> is sorted by codepoint.</p>
  <div class="egrid" id="egrid">${grid}</div>
  <div class="usage">
    <h3>Use it</h3>
    <div class="codebar slim"><span class="get">GET</span> <span class="url">${ORIGIN}/${esc(col.slug)}.json</span><button class="copybtn" data-copy="${ORIGIN}/${esc(col.slug)}.json">copy ⧉</button></div>
    <pre class="snippet">${esc(fetchSnippet)}</pre>
  </div>
  <div class="morelike">
    <h3>More in ${esc(info.title.toLowerCase())}</h3>
    ${sibNav}
  </div>
</main>
` +
    footer(model.meta) +
    `<div class="toast" id="toast">Copied</div>
<script>window.__ALL__=${JSON.stringify(col.emojis.join(" "))};</script>
<script src="/site.js?v=${ASSET_V.js}" defer></script>
` +
    pageEnd()
  );
}

// ---------------------------------------------------------------------------
// Client JS shared by all pages

function siteJs() {
  return `// emoji.group site behaviour: copy buttons, tabs, search, filter.
(function () {
  var toast = document.getElementById('toast');
  var t;
  function flash(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(t);
    t = setTimeout(function () { toast.classList.remove('show'); }, 1100);
  }
  function copy(text, label) {
    navigator.clipboard.writeText(text).then(
      function () { flash(label); },
      function () { flash('Copy failed'); }
    );
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy]');
    if (el) { copy(el.getAttribute('data-copy'), 'Copied'); return; }
    var cell = e.target.closest('.ecell');
    if (cell) { copy(cell.dataset.c, 'Copied ' + cell.dataset.c); return; }
    var tab = e.target.closest('.tab');
    if (tab) {
      var id = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b === tab); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + id); });
    }
  });

  var copyAll = document.getElementById('copyall');
  if (copyAll && window.__ALL__) {
    copyAll.addEventListener('click', function () {
      copy(window.__ALL__, 'Copied ' + window.__ALL__.split(' ').length + ' emojis');
    });
  }

  // Collection page: filter cells by emoji name.
  var filter = document.getElementById('filter');
  if (filter) {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      document.querySelectorAll('#egrid .ecell').forEach(function (c) {
        c.style.display = !q || (c.dataset.n || '').toLowerCase().indexOf(q) !== -1 || c.dataset.c === q ? '' : 'none';
      });
    });
  }

  // Landing page: search across the whole database via the slim index.
  var q = document.getElementById('q');
  var results = document.getElementById('results');
  if (q && results) {
    var indexPromise = null;
    function ensureIndex() {
      if (!indexPromise) {
        indexPromise = fetch('/search.json').then(function (r) { return r.json(); });
      }
      return indexPromise;
    }
    function render(items, query) {
      if (!query) { results.innerHTML = ''; return; }
      if (!items.length) {
        results.innerHTML = '<div class="noresults">No matches for "' + query.replace(/[<>&]/g, '') + '"</div>';
        return;
      }
      results.innerHTML = items.slice(0, 24).map(function (it) {
        var tags = it.t.map(function (tag) {
          return '<a class="rtag" href="/' + tag + '">' + tag + '</a>';
        }).join('');
        return '<div class="rcell"><button class="ecell" data-c="' + it.c + '" data-n="' + it.n + '" title="' + it.n + '">' + it.c + '</button><div class="rmeta"><div class="rname">' + it.n + '</div><div class="rtags">' + tags + '</div></div></div>';
      }).join('');
    }
    var timer;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var query = q.value.trim().toLowerCase();
        if (!query) { render([], ''); return; }
        ensureIndex().then(function (idx) {
          var hits = [];
          for (var i = 0; i < idx.length; i++) {
            var it = idx[i];
            if (it.c === q.value.trim() || it.n.indexOf(query) !== -1 || it.k.indexOf(query) !== -1) {
              hits.push(it);
              if (hits.length >= 60) break;
            }
          }
          render(hits, query);
        });
      }, 120);
    });
  }
})();
`;
}

// ---------------------------------------------------------------------------
// Assets

function llmsTxt(model) {
  const lines = [
    "# emoji.group",
    "",
    "> A static JSON emoji API. Hand reviewed collections, skin tone and gender",
    "> variants as first class records, colours measured from the artwork, and",
    "> human reviewed safety blocklists. Deterministic, versioned by date.",
    "",
    `Version: ${model.meta.version}`,
    `Emojis: ${model.meta.emojis}`,
    `Collections: ${model.meta.collections}`,
    "",
    "## Data",
    "- [Full database](/emojis.json): every emoji with its tags",
    "- [Collections index](/collections/index.json): every collection with counts",
    "- [Blocklists index](/blocklists/index.json): safety collections in exclude mode",
    "- [Search index](/search.json): slim per emoji index (char, name, keywords, tags)",
    "",
    "## Collections",
  ];
  for (const c of model.index.collections) {
    lines.push(`- [${c.title}](/collections/${c.slug}.json): ${c.facet} facet, ${c.count} emojis`);
  }
  return lines.join("\n") + "\n";
}

function sitemap(model) {
  const urls = ["/", ...model.collections.map((c) => `/${c.slug}`)];
  const body = urls
    .map((u) => `  <url><loc>${ORIGIN}${u}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function notFound(model) {
  return (
    head({ title: "Not found · emoji.group", description: "That page does not exist.", path: "/404" }) +
    nav() +
    `
<main class="detail center404">
  <div class="glyph404">🫥</div>
  <h1>Nothing here</h1>
  <p class="muted">That collection does not exist, or the URL has a typo.</p>
  <div class="dactions center">
    <a class="btn dark" href="/">Back to emoji.group</a>
    <a class="btn ghost" href="/collections/index.json">Browse the index →</a>
  </div>
</main>
` +
    footer(model.meta) +
    pageEnd()
  );
}

// Slim search index: char, name, keywords, plus collection slugs it belongs to.
function searchIndex(model) {
  const memberOf = new Map();
  for (const col of model.collections) {
    if (col.facet === "audience") continue; // kid-safe would tag nearly everything
    for (const ch of col.emojis) {
      if (!memberOf.has(ch)) memberOf.set(ch, []);
      memberOf.get(ch).push(col.slug);
    }
  }
  const raw = readJSON(`${ROOT}/data/records.json`);
  const kw = new Map(raw.map((r) => [r.char, (r._keywords || []).join(" ")]));
  return model.emojis.map((e) => ({
    c: e.char,
    n: e.name,
    k: kw.get(e.char) || "",
    t: (memberOf.get(e.char) || []).slice(0, 6),
  }));
}

// ---------------------------------------------------------------------------
function run() {
  if (!existsSync(`${DIST}/index.json`)) {
    log("No /dist found. Run npm run build first.");
    process.exit(1);
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  ensureDir(OUT);

  // Raw API, verbatim, same origin.
  cpSync(`${DIST}/emojis.json`, `${OUT}/emojis.json`);
  cpSync(`${DIST}/index.json`, `${OUT}/api.json`);
  cpSync(`${DIST}/collections`, `${OUT}/collections`, { recursive: true });
  if (existsSync(`${DIST}/blocklists`)) cpSync(`${DIST}/blocklists`, `${OUT}/blocklists`, { recursive: true });

  const model = loadModel();

  // Version the assets by content before any page references them, so a CSS
  // or JS change always busts browser caches via a fresh query string.
  const css = readFileSync(`${ROOT}/site/style.css`, "utf8");
  const js = siteJs();
  ASSET_V.css = contentHash(css);
  ASSET_V.js = contentHash(js);

  writeFileSync(`${OUT}/index.html`, buildLanding(model));
  for (const col of model.collections) {
    writeFileSync(`${OUT}/${col.slug}.html`, buildCollection(model, col));
    writeJSON(`${OUT}/${col.slug}.json`, {
      slug: col.slug,
      tag: col.tag,
      title: col.title,
      facet: col.facet,
      mode: col.mode,
      emojis: col.emojis,
      count: col.count,
      version: col.version,
    });
  }

  writeFileSync(`${OUT}/style.css`, css);
  writeFileSync(`${OUT}/site.js`, js);
  writeFileSync(`${OUT}/favicon.svg`, FAVICON_SVG);
  writeFileSync(`${OUT}/llms.txt`, llmsTxt(model));
  writeFileSync(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  writeFileSync(`${OUT}/sitemap.xml`, sitemap(model));
  writeFileSync(`${OUT}/404.html`, notFound(model));
  writeJSON(`${OUT}/search.json`, searchIndex(model));

  // Static raster assets (og image, touch icon) generated once into site/assets.
  if (existsSync(`${ROOT}/site/assets`)) {
    for (const f of readdirSync(`${ROOT}/site/assets`)) {
      cpSync(`${ROOT}/site/assets/${f}`, `${OUT}/${f}`);
    }
  }

  const htmlCount = readdirSync(OUT).filter((f) => f.endsWith(".html")).length;
  log("SITE built");
  log(`  landing + ${model.collections.length} collection pages + 404 (${htmlCount} html files)`);
  log(`  search index of ${model.emojis.length} records, sitemap, llms.txt, favicon`);
  log(`  wrote          site/public/`);
}

run();
