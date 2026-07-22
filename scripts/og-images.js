// SOCIAL SHARE IMAGES · node scripts/og-images.js [--only=slug]
// Renders one 1200x630 Open Graph card per collection, plus the landing card,
// into site/assets/og/. Uses headless Chrome with the system emoji font, so
// this runs on a Mac and the PNGs are committed; the site build just copies
// them. Deterministic given the same /dist and platform emoji font.

import { existsSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ROOT, readJSON, ensureDir, log } from "../lib/util.js";

const OUT = `${ROOT}/site/assets/og`;
const PAGE = `${ROOT}/.cache/og-render.html`;
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const FACET_LABEL = {
  vibe: "VIBE", object: "OBJECT", domain: "DOMAIN", theme: "THEME",
  category: "CATEGORY", set: "CURATED SET", color: "COLOR", safety: "SAFETY",
  gender: "GENDER", "skin-tone": "SKIN TONE", audience: "AUDIENCE",
};

const LOGO = `<svg width="46" height="46" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#E8940A"/><circle cx="9.5" cy="11.5" r="2" fill="#1B1812"/><circle cx="18.5" cy="11.5" r="2" fill="#1B1812"/><path d="M8.5 16.5c1.5 2.2 3.3 3.3 5.5 3.3s4-1.1 5.5-3.3" stroke="#1B1812" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;

const BASE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;background:#FAF9F7;overflow:hidden;
    font-family:'Instrument Sans',sans-serif;color:#1B1812;position:relative}
  .accent{position:absolute;top:0;left:0;right:0;height:10px;background:#E8940A}
  .wrap{position:absolute;inset:10px 0 0 0;padding:54px 72px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:14px}
  .brand span{font-size:30px;font-weight:700;letter-spacing:-.02em}
  .brand span i{font-style:normal;font-weight:400;color:#8A8578}
  .kicker{font-family:'JetBrains Mono',monospace;font-size:19px;font-weight:600;
    letter-spacing:.12em;color:#B87708;margin:44px 0 10px}
  h1{font-size:88px;font-weight:650;letter-spacing:-.035em;margin:0;line-height:1.02}
  .tiles{display:flex;gap:18px;margin-top:44px}
  .tile{width:118px;height:118px;background:#fff;border:2px solid #E7E2D8;border-radius:22px;
    display:flex;align-items:center;justify-content:center;font-size:72px;
    box-shadow:0 8px 24px -12px rgba(27,24,18,.15)}
  .foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between}
  .url{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:600;
    background:#1B1812;color:#FAF9F7;border-radius:14px;padding:16px 26px}
  .url b{color:#E8940A;font-weight:600}
  .meta{font-family:'JetBrains Mono',monospace;font-size:20px;color:#6B6558}
`;

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;650;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">`;

function collectionCard(col, samples) {
  const tiles = samples.map((c) => `<div class="tile">${c}</div>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}<style>${BASE_CSS}</style></head><body>
  <div class="accent"></div>
  <div class="wrap">
    <div class="brand">${LOGO}<span>emoji<i>.group</i></span></div>
    <div class="kicker">${FACET_LABEL[col.facet] || col.facet.toUpperCase()} · ${col.count.toLocaleString("en-US")} EMOJIS</div>
    <h1>${col.title}</h1>
    <div class="tiles">${tiles}</div>
    <div class="foot">
      <div class="url">emoji.group/<b>${col.slug}</b></div>
      <div class="meta">free static JSON · v${col.version}</div>
    </div>
  </div>
</body></html>`;
}

function landingCard(meta, samples) {
  const tiles = samples.map((c) => `<div class="tile">${c}</div>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}<style>${BASE_CSS}
  h1{font-size:76px}</style></head><body>
  <div class="accent"></div>
  <div class="wrap">
    <div class="brand">${LOGO}<span>emoji<i>.group</i></span></div>
    <div class="kicker">${meta.emojis.toLocaleString("en-US")} EMOJIS · ${meta.collections} COLLECTIONS · FREE STATIC JSON</div>
    <h1>The emoji database,<br>grouped for developers</h1>
    <div class="tiles">${tiles}</div>
    <div class="foot">
      <div class="url">emoji.group</div>
      <div class="meta">open source · MIT · v${meta.version}</div>
    </div>
  </div>
</body></html>`;
}

function run() {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  if (!chrome) {
    log("No Chrome found; og images unchanged.");
    process.exit(1);
  }
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

  const meta = readJSON(`${ROOT}/dist/index.json`);
  const index = readJSON(`${ROOT}/dist/collections/index.json`);
  const emojis = readJSON(`${ROOT}/dist/emojis.json`);

  // Confidence per facet:tag:char, to pick the most representative samples.
  const conf = new Map();
  for (const e of emojis) {
    for (const t of e.tags) conf.set(`${t.facet} ${t.tag} ${e.char}`, t.confidence);
  }
  const toneOf = new Map(emojis.map((e) => [e.char, e.skin_tone]));

  function samplesFor(col, n) {
    // Default (untoned) members, ranked by confidence, full pictographs first.
    const pool = (col.emojis_default || col.emojis)
      .filter((c) => toneOf.get(c) === null)
      .sort((a, b) =>
        (conf.get(`${col.facet} ${col.tag} ${b}`) ?? 0) - (conf.get(`${col.facet} ${col.tag} ${a}`) ?? 0),
      );
    const pictos = pool.filter((c) => c.codePointAt(0) >= 0x1f000);
    return (pictos.length >= n ? pictos : pool).slice(0, n);
  }

  ensureDir(OUT);
  if (!only) {
    for (const f of readdirSync(OUT)) rmSync(`${OUT}/${f}`);
  }
  ensureDir(`${ROOT}/.cache`);

  function shoot(html, outPath) {
    writeFileSync(PAGE, html);
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars",
      "--force-device-scale-factor=1", "--window-size=1200,630",
      `--screenshot=${outPath}`, `file://${PAGE}`,
    ], { stdio: "ignore" });
  }

  let count = 0;
  for (const summary of index.collections) {
    if (only && summary.slug !== only) continue;
    const col = readJSON(`${ROOT}/dist/collections/${summary.slug}.json`);
    shoot(collectionCard(col, samplesFor(col, 7)), `${OUT}/${col.slug}.png`);
    count += 1;
    if (count % 20 === 0) log(`  ${count} cards rendered…`);
  }

  if (!only) {
    const heroSamples = ["🕯️", "🍕", "🚀", "🎃", "🐼", "💙", "🎉"];
    shoot(landingCard(meta, heroSamples), `${ROOT}/site/assets/og.png`);
  }

  log(`OG IMAGES complete: ${count} collection cards + landing card`);
  log(`  wrote  site/assets/og/ and site/assets/og.png`);
}

run();
