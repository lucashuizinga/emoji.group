// STEP 4 · LLM TAGGING HARNESS
//   npm run tag -- --facet=safety
// Reads prompts/facet-{name}.txt, batches BASE emojis 40 per request with their
// name and CLDR keywords as context, calls the Anthropic API, validates every
// response against the closed vocabulary in the prompt file, and retries a batch
// once on unknown tags or malformed JSON. Writes data/llm/{facet}.json with
// source "llm". Idempotent: skips emojis already processed for that facet unless
// --force.
//
// Flags:
//   --facet=<name>   required, matches prompts/facet-<name>.txt
//   --force          re-tag everything, ignore prior progress
//   --limit=<n>      only process the first n base emojis (handy for a trial run)
//   --batch-size=<n> emojis per request (default 40)
//   --dry-run        build batches and print one filled prompt, make no API call

import { existsSync, readFileSync } from "node:fs";
import { ROOT, readJSON, writeCharKeyedJSON, writeJSON, makeTag, log } from "../lib/util.js";

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { force: false, dryRun: false, batchSize: 40, limit: 0, facet: null };
  for (const a of argv) {
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--facet=")) args.facet = a.slice(8);
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice(8), 10) || 0;
    else if (a.startsWith("--batch-size=")) args.batchSize = parseInt(a.slice(13), 10) || 40;
  }
  return args;
}

// Load KEY=VALUE pairs from .env without adding a dependency.
function loadEnv() {
  const path = `${ROOT}/.env`;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Pull the closed vocabulary out of the prompt file itself, so the file stays
// the single source of truth for what is allowed.
function parseVocabulary(prompt) {
  const match = prompt.match(/VOCABULARY[^:]*:\s*(.+)/);
  if (!match) throw new Error("prompt file has no VOCABULARY line");
  return match[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function stripFences(text) {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// Validate a model response for one batch. Returns { ok, results, reason }.
function validateResponse(text, vocab, batchChars) {
  let parsed;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, reason: "malformed JSON" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "top level is not an array" };
  const vocabSet = new Set(vocab);
  const batchSet = new Set(batchChars);
  const results = {};
  for (const item of parsed) {
    if (!item || typeof item.char !== "string" || !Array.isArray(item.tags)) {
      return { ok: false, reason: "item missing char or tags" };
    }
    if (!batchSet.has(item.char)) continue; // ignore anything not in the batch
    const clean = [];
    for (const t of item.tags) {
      if (!t || typeof t.tag !== "string") return { ok: false, reason: "tag missing name" };
      if (!vocabSet.has(t.tag)) return { ok: false, reason: `unknown tag "${t.tag}"` };
      const conf = typeof t.confidence === "number" ? t.confidence : NaN;
      if (!(conf >= 0 && conf <= 1)) return { ok: false, reason: "confidence out of range" };
      clean.push({ tag: t.tag, confidence: conf });
    }
    results[item.char] = clean;
  }
  return { ok: true, results };
}

// ---------------------------------------------------------------------------
async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.facet) {
    log("Usage: npm run tag -- --facet=<name> [--force] [--limit=n] [--dry-run]");
    process.exit(1);
  }

  const promptPath = `${ROOT}/prompts/facet-${args.facet}.txt`;
  if (!existsSync(promptPath)) {
    log(`No prompt file at prompts/facet-${args.facet}.txt`);
    process.exit(1);
  }
  const prompt = readFileSync(promptPath, "utf8");
  const vocab = parseVocabulary(prompt);
  const [promptPrefix] = prompt.split("{batch}");

  const records = readJSON(`${ROOT}/data/records.json`);
  let bases = records.filter((r) => r.base === null);
  if (args.limit > 0) bases = bases.slice(0, args.limit);

  const storePath = `${ROOT}/data/llm/${args.facet}.json`;
  const progressPath = `${ROOT}/data/llm/${args.facet}.processed.json`;
  const store = !args.force && existsSync(storePath) ? readJSON(storePath) : {};
  const progress =
    !args.force && existsSync(progressPath) ? readJSON(progressPath) : { model: null, chars: [] };
  const processed = new Set(progress.chars);

  const todo = bases.filter((r) => args.force || !processed.has(r.char));
  const batches = [];
  for (let i = 0; i < todo.length; i += args.batchSize) {
    batches.push(todo.slice(i, i + args.batchSize));
  }

  log(`LLM TAGGING · facet ${args.facet}`);
  log(`  vocabulary        ${vocab.join(", ")}`);
  log(`  base emojis       ${bases.length}`);
  log(`  already processed ${bases.length - todo.length}`);
  log(`  to tag            ${todo.length} in ${batches.length} batches of ${args.batchSize}`);

  const serializeBatch = (batch) =>
    JSON.stringify(batch.map((r) => ({ char: r.char, name: r.name, keywords: r._keywords })));

  if (args.dryRun) {
    log("  --dry-run, no API calls. Sample filled prompt for batch 1:");
    log("  ----------------------------------------------------------");
    if (batches.length) log(promptPrefix + serializeBatch(batches[0].slice(0, 3)));
    return;
  }

  loadEnv();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  // Zero-arg client: the SDK resolves ANTHROPIC_API_KEY (including from .env
  // loaded above), ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  let client;
  try {
    client = new Anthropic();
  } catch {
    client = null;
  }
  if (!client) {
    log("");
    log("  No Anthropic credentials found. Either:");
    log("    copy .env.example to .env and set ANTHROPIC_API_KEY, or");
    log("    run `ant auth login` so the SDK picks up your profile, or");
    log("    run with --dry-run to exercise the harness without the API.");
    process.exit(1);
  }

  const stats = { tagged: 0, empty: 0, failedBatches: 0, requests: 0 };

  async function callBatch(batch) {
    const userContent = "BATCH\n" + serializeBatch(batch);
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: "text", text: promptPrefix.trim(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });
    stats.requests += 1;
    return res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  // Process batches with a small worker pool. Results are applied to the
  // store as they arrive; the final write sorts keys so output order stays
  // deterministic regardless of completion order.
  const CONCURRENCY = 4;
  let cursor = 0;
  let done = 0;
  async function processBatch(b) {
    const batch = batches[b];
    const chars = batch.map((r) => r.char);
    let result = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let text;
      try {
        text = await callBatch(batch);
      } catch (err) {
        log(`  batch ${b + 1} attempt ${attempt} request error: ${err.message}`);
        continue;
      }
      const validated = validateResponse(text, vocab, chars);
      if (validated.ok) {
        result = validated.results;
        break;
      }
      log(`  batch ${b + 1} attempt ${attempt} rejected: ${validated.reason}`);
    }

    if (!result) {
      stats.failedBatches += 1;
      log(`  batch ${b + 1} failed twice, leaving its emojis for a later run`);
      return;
    }

    for (const r of batch) {
      processed.add(r.char);
      const tags = result[r.char] || [];
      if (tags.length) {
        store[r.char] = tags.map((t) => makeTag(t.tag, args.facet, t.confidence, "llm"));
        stats.tagged += 1;
      } else {
        delete store[r.char];
        stats.empty += 1;
      }
    }
    done += 1;
    log(`  batch ${b + 1} done (${done}/${batches.length})`);
  }
  async function worker() {
    while (cursor < batches.length) {
      const b = cursor++;
      await processBatch(b);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  writeCharKeyedJSON(storePath, store);
  writeJSON(progressPath, { model, chars: [...processed].sort() });

  log("LLM TAGGING complete");
  log(`  requests          ${stats.requests}`);
  log(`  emojis tagged     ${stats.tagged}`);
  log(`  emojis empty      ${stats.empty}`);
  log(`  failed batches    ${stats.failedBatches}`);
  log(`  wrote             data/llm/${args.facet}.json`);
}

run();
