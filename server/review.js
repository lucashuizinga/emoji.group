// STEP 6 · REVIEW GRID (server)
//   npm run review
// A tiny dependency free Node server for the local review app. It builds a
// queue of proposed tags that still need a human decision, and records
// approvals and rejections into data/reviews.json.
//   approve -> compile rewrites the tag source to human
//   reject  -> compile drops the tag
// Safety facet tags always appear in the queue regardless of confidence, and
// the build refuses to ship a safety tag a human has not seen.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { ROOT, readJSON, writeCharKeyedJSON, log } from "../lib/util.js";
import { readdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5787;
const REVIEWS_PATH = `${ROOT}/data/reviews.json`;
const SAFETY_FACET = "safety";

function loadReviews() {
  return existsSync(REVIEWS_PATH) ? readJSON(REVIEWS_PATH) : {};
}

// Every reviewable proposal comes from the LLM stores and the colour store.
// Gender and skin tone are deterministic facts, so they are not reviewed.
function loadProposals() {
  const stores = [];
  const colorPath = `${ROOT}/data/tags/color.json`;
  if (existsSync(colorPath)) stores.push(readJSON(colorPath));
  const llmDir = `${ROOT}/data/llm`;
  if (existsSync(llmDir)) {
    for (const file of readdirSync(llmDir)) {
      if (!file.endsWith(".json") || file.endsWith(".processed.json")) continue;
      stores.push(readJSON(`${llmDir}/${file}`));
    }
  }
  return stores;
}

function buildQueue({ facet, threshold }) {
  const records = readJSON(`${ROOT}/data/records.json`);
  const nameByChar = new Map(records.map((r) => [r.char, r.name]));
  const reviews = loadReviews();
  const items = [];
  const facets = new Set();

  for (const store of loadProposals()) {
    for (const [char, tags] of Object.entries(store)) {
      for (const t of tags) {
        facets.add(t.facet);
        if (facet && facet !== "all" && t.facet !== facet) continue;
        const decided = reviews[char]?.[`${t.facet}::${t.tag}`];
        if (decided) continue;
        const mustReview = t.facet === SAFETY_FACET;
        if (!mustReview && t.confidence >= threshold) continue;
        items.push({
          char,
          name: nameByChar.get(char) || char,
          facet: t.facet,
          tag: t.tag,
          confidence: t.confidence,
          source: t.source,
        });
      }
    }
  }

  items.sort((a, b) => a.confidence - b.confidence || (a.char < b.char ? -1 : 1));
  return { items, facets: [...facets].sort() };
}

function recordDecision({ char, facet, tag, action }) {
  const reviews = loadReviews();
  if (!reviews[char]) reviews[char] = {};
  const key = `${facet}::${tag}`;
  if (action === "clear") delete reviews[char][key];
  else reviews[char][key] = action === "approve" ? "approved" : "rejected";
  if (Object.keys(reviews[char]).length === 0) delete reviews[char];
  writeCharKeyedJSON(REVIEWS_PATH, reviews);
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = readFileSync(`${ROOT}/server/review.html`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/queue") {
    const facet = url.searchParams.get("facet") || "all";
    const threshold = Number(url.searchParams.get("threshold"));
    const queue = buildQueue({ facet, threshold: Number.isFinite(threshold) ? threshold : 0.8 });
    json(res, 200, queue);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/decision") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (!payload.char || !payload.facet || !payload.tag || !payload.action) {
          json(res, 400, { error: "char, facet, tag and action are required" });
          return;
        }
        recordDecision(payload);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  log(`Review grid running at http://localhost:${PORT}  (override with PORT=...)`);
  log("  y approve   n reject   left/right navigate   u undo");
  log("  Approvals set source to human, rejections drop the tag.");
  log("  Run npm run build afterwards to fold decisions into /dist.");
});
