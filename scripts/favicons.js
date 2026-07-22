// FAVICONS · node scripts/favicons.js
// Renders the logo once at 512px with headless Chrome, downscales with sips
// to every size that matters, and packs 16/32/48 into a classic favicon.ico
// (PNG-in-ICO, supported everywhere that matters). Google's favicon crawler
// wants a stable URL and a size that is a multiple of 48, so 48 and 96 px
// PNGs ship alongside the SVG. All output lands in site/assets/ and is
// committed; the site build just copies it.

import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ROOT, ensureDir, log } from "../lib/util.js";

const ASSETS = `${ROOT}/site/assets`;
const CACHE = `${ROOT}/.cache`;
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const PAGE = `<!DOCTYPE html><meta charset="utf-8"><style>body{margin:0;width:512px;height:512px}</style>
<svg width="512" height="512" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="28" rx="8" fill="#E8940A"/><circle cx="9.5" cy="11.5" r="2" fill="#1B1812"/><circle cx="18.5" cy="11.5" r="2" fill="#1B1812"/><path d="M8.5 16.5c1.5 2.2 3.3 3.3 5.5 3.3s4-1.1 5.5-3.3" stroke="#1B1812" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;

// Pack PNG files into a single .ico (PNG-in-ICO container).
function packIco(pngPaths, outPath) {
  const images = pngPaths.map((p) => readFileSync(p));
  const sizes = pngPaths.map((p) => Number(p.match(/-(\d+)\.png$/)[1]));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  images.forEach((img, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // width
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit depth
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    entries.push(e);
  });
  writeFileSync(outPath, Buffer.concat([header, ...entries, ...images]));
}

function run() {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  if (!chrome) {
    log("No Chrome found; favicons unchanged.");
    process.exit(1);
  }
  ensureDir(CACHE);
  ensureDir(ASSETS);

  const pagePath = `${CACHE}/favicon-render.html`;
  writeFileSync(pagePath, PAGE);
  const master = `${CACHE}/favicon-512.png`;
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--window-size=512,512",
    `--screenshot=${master}`, `file://${pagePath}`,
  ], { stdio: "ignore" });

  const sizes = [16, 32, 48, 96, 192];
  for (const s of sizes) {
    const out = s <= 48 ? `${CACHE}/favicon-${s}.png` : `${ASSETS}/favicon-${s}.png`;
    execFileSync("sips", ["-z", String(s), String(s), master, "--out", out], { stdio: "ignore" });
  }
  execFileSync("sips", ["-z", "48", "48", master, "--out", `${ASSETS}/favicon-48.png`], { stdio: "ignore" });

  packIco(
    [16, 32, 48].map((s) => `${CACHE}/favicon-${s}.png`),
    `${ASSETS}/favicon.ico`,
  );

  log("FAVICONS complete");
  log("  wrote  site/assets/favicon.ico (16+32+48), favicon-48.png, favicon-96.png, favicon-192.png");
}

run();
