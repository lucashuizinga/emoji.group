// STEP 8 · VERIFY
//   npm run check
// Validates /dist against JSON schemas, prints per collection counts, lists
// untagged emojis, and detects duplicates. Exits non zero on any hard failure
// so it can gate a deploy.

import { existsSync, readdirSync } from "node:fs";
import Ajv from "ajv";
import { ROOT, readJSON, compareChars, log, printTable } from "../lib/util.js";

const ajv = new Ajv({ allErrors: true });

const tagSchema = {
  type: "object",
  required: ["tag", "facet", "confidence", "source"],
  additionalProperties: false,
  properties: {
    tag: { type: "string" },
    facet: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source: { enum: ["programmatic", "llm", "human"] },
  },
};

const emojiSchema = {
  type: "array",
  items: {
    type: "object",
    required: [
      "char",
      "name",
      "slug",
      "codepoints",
      "unicode_version",
      "base",
      "skin_tone",
      "gender",
      "tags",
    ],
    additionalProperties: false,
    properties: {
      char: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      codepoints: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 } },
      unicode_version: { type: "string" },
      base: { type: ["string", "null"] },
      skin_tone: {
        anyOf: [
          { type: "null" },
          { type: "integer", minimum: 1, maximum: 5 },
          { type: "array", items: { type: "integer", minimum: 1, maximum: 5 } },
        ],
      },
      gender: { enum: [null, "male", "female", "neutral"] },
      tags: { type: "array", items: tagSchema },
    },
  },
};

const collectionSchema = {
  type: "object",
  required: ["slug", "title", "facet", "mode", "emojis", "count", "version"],
  additionalProperties: false,
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9-]+$" },
    title: { type: "string", minLength: 1 },
    facet: { type: "string", minLength: 1 },
    mode: { enum: ["include", "exclude"] },
    emojis: { type: "array", items: { type: "string", minLength: 1 } },
    count: { type: "integer", minimum: 0 },
    version: { type: "string" },
  },
};

const validateEmojis = ajv.compile(emojiSchema);
const validateCollection = ajv.compile(collectionSchema);

const problems = [];
function fail(msg) {
  problems.push(msg);
}

function checkSchema() {
  const emojis = readJSON(`${ROOT}/dist/emojis.json`);
  if (!validateEmojis(emojis)) {
    fail(`emojis.json failed schema: ${ajv.errorsText(validateEmojis.errors).slice(0, 300)}`);
  }
  const dirs = ["collections", "blocklists"];
  let checked = 0;
  for (const dir of dirs) {
    const path = `${ROOT}/dist/${dir}`;
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path)) {
      if (!file.endsWith(".json") || file === "index.json") continue;
      const data = readJSON(`${path}/${file}`);
      if (!validateCollection(data)) {
        fail(`${dir}/${file} failed schema: ${ajv.errorsText(validateCollection.errors).slice(0, 200)}`);
        continue;
      }
      if (data.count !== data.emojis.length) {
        fail(`${dir}/${file} count ${data.count} does not match emojis length ${data.emojis.length}`);
      }
      if (dir === "blocklists" && data.mode !== "exclude") {
        fail(`${dir}/${file} is a blocklist but mode is ${data.mode}`);
      }
      checked += 1;
    }
  }
  return { emojis, checked };
}

function checkDuplicates(emojis) {
  const seenChar = new Set();
  for (const e of emojis) {
    if (seenChar.has(e.char)) fail(`duplicate char in emojis.json: ${e.char}`);
    seenChar.add(e.char);
  }
  const seenSlug = new Set();
  const collectionsDir = `${ROOT}/dist/collections`;
  for (const file of readdirSync(collectionsDir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const c = readJSON(`${collectionsDir}/${file}`);
    if (seenSlug.has(c.slug)) fail(`duplicate collection slug: ${c.slug}`);
    seenSlug.add(c.slug);
    const inside = new Set();
    for (const ch of c.emojis) {
      if (inside.has(ch)) fail(`collection ${c.slug} lists ${ch} twice`);
      inside.add(ch);
    }
    const sorted = [...c.emojis].sort(compareChars);
    if (JSON.stringify(sorted) !== JSON.stringify(c.emojis)) {
      fail(`collection ${c.slug} is not sorted by codepoint`);
    }
  }
}

function checkChars(emojis) {
  // Every char in every collection must exist in the database.
  const known = new Set(emojis.map((e) => e.char));
  const collectionsDir = `${ROOT}/dist/collections`;
  for (const file of readdirSync(collectionsDir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const c = readJSON(`${collectionsDir}/${file}`);
    for (const ch of c.emojis) {
      if (!known.has(ch)) fail(`collection ${c.slug} references unknown emoji ${ch}`);
    }
  }
}

function reportUntagged(emojis) {
  const structural = new Set(["gender", "skin-tone"]);
  const zero = emojis.filter((e) => e.tags.length === 0);
  const noSemantic = emojis.filter((e) => !e.tags.some((t) => !structural.has(t.facet)));
  return { zero, noSemantic };
}

function run() {
  const { emojis, checked } = checkSchema();
  checkDuplicates(emojis);
  checkChars(emojis);

  const index = readJSON(`${ROOT}/dist/collections/index.json`);
  const rows = index.collections.map((c) => [c.slug, c.facet, c.mode, c.count]);
  log("VERIFY · collection counts");
  printTable(rows, ["slug", "facet", "mode", "count"]);

  const { zero, noSemantic } = reportUntagged(emojis);
  log("");
  log("VERIFY · coverage");
  log(`  emojis in database        ${emojis.length}`);
  log(`  collections validated     ${checked}`);
  log(`  with no tags at all       ${zero.length}`);
  log(`  with no semantic tag      ${noSemantic.length}  (colour, vibe, object, domain, safety)`);
  if (noSemantic.length) {
    log(`  sample untagged           ${noSemantic.slice(0, 20).map((e) => e.char).join(" ")}`);
  }

  log("");
  if (problems.length) {
    log(`VERIFY FAILED with ${problems.length} problem(s):`);
    for (const p of problems) log(`  - ${p}`);
    process.exit(1);
  }
  log("VERIFY passed. /dist is schema valid, deduplicated, and internally consistent.");
}

run();
