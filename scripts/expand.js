// STEP 2 · EXPAND VARIANTS
// Every skin tone variant and gender variant becomes its own record.
//   base       points at the parent char, null for a true base emoji
//   skin_tone  1 (light) to 5 (dark), or an array for mixed multi person combos
//   gender     male, female, neutral, or null
// Writes data/records.json, sorted by code point.

import {
  ROOT,
  readJSON,
  writeJSON,
  slugify,
  codepointsFromHex,
  sortByCodepoint,
  log,
} from "../lib/util.js";

// Person component code points that carry a gender signal, as hexcode parts.
const FEMALE_PARTS = new Set(["2640", "1F469", "1F467", "1F475"]); // sign, woman, girl, old woman
const MALE_PARTS = new Set(["2642", "1F468", "1F466", "1F474"]); // sign, man, boy, old man
const NEUTRAL_PARTS = new Set(["1F9D1", "1F9D2", "1F9D3"]); // person, child, older person

// A small curated set of single code point emojis that are gender coded but
// carry no person component to detect. Kept short and unambiguous on purpose.
const CURATED_GENDER = {
  "1F385": "male", // Santa Claus
  "1F936": "female", // Mrs. Claus
  "1F934": "male", // prince
  "1F478": "female", // princess
  "1F57A": "male", // man dancing
  "1F483": "female", // woman dancing
  "1F930": "female", // pregnant woman
  "1FAC3": "male", // pregnant man
};

// Map a gendered person component to its gender neutral equivalent.
const TO_NEUTRAL = {
  "1F468": "1F9D1",
  "1F469": "1F9D1", // man, woman -> person
  "1F466": "1F9D2",
  "1F467": "1F9D2", // boy, girl -> child
  "1F474": "1F9D3",
  "1F475": "1F9D3", // old man, old woman -> older person
};

function genderOf(hexcode) {
  const parts = new Set(hexcode.split("-"));
  let female = false;
  let male = false;
  let neutral = false;
  for (const p of parts) {
    if (FEMALE_PARTS.has(p)) female = true;
    if (MALE_PARTS.has(p)) male = true;
    if (NEUTRAL_PARTS.has(p)) neutral = true;
  }
  if (female && male) return { gender: null, confidence: 0 }; // mixed, e.g. couples and families
  if (female) return { gender: "female", confidence: parts.has("2640") ? 1 : 0.95 };
  if (male) return { gender: "male", confidence: parts.has("2642") ? 1 : 0.95 };
  if (neutral) return { gender: "neutral", confidence: 0.95 };
  if (CURATED_GENDER[hexcode]) return { gender: CURATED_GENDER[hexcode], confidence: 0.85 };
  return { gender: null, confidence: 0 };
}

// Resolve candidate gender neutral hexcodes for a gendered emoji. Returns a
// list because FE0F presentation selectors differ between the variant and its
// base in emojibase (e.g. 26F9-FE0F-200D-2640-FE0F vs base 26F9), so we try
// the exact strip plus the with and without FE0F spellings.
function neutralHexCandidates(hexcode) {
  const stripped = hexcode.replace(/-200D-264[02]-FE0F/g, "");
  if (stripped !== hexcode) {
    // gender sign form, e.g. runner
    return [stripped, stripped.replace(/-FE0F$/, ""), `${stripped}-FE0F`];
  }
  let changed = false;
  const swapped = hexcode
    .split("-")
    .map((p) => {
      if (TO_NEUTRAL[p]) {
        changed = true;
        return TO_NEUTRAL[p];
      }
      return p;
    })
    .join("-");
  return changed ? [swapped] : [];
}

// A number tone stays a number. A uniform array collapses to one number.
// A mixed array (two people, two tones) is kept as an array.
function normalizeTone(tone) {
  if (tone == null) return null;
  if (Array.isArray(tone)) {
    const uniq = [...new Set(tone)];
    return uniq.length === 1 ? uniq[0] : tone;
  }
  return tone;
}

function versionString(v) {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

function makeRecord(source, { base, skinTone, hasSkins }) {
  const g = genderOf(source.hexcode);
  return {
    char: source.emoji,
    name: source.label,
    slug: slugify(source.label),
    codepoints: codepointsFromHex(source.hexcode),
    unicode_version: versionString(source.version),
    base,
    skin_tone: normalizeTone(skinTone),
    gender: g.gender,
    tags: [],
    _hexcode: source.hexcode,
    _keywords: source.tags || [],
    _hasSkins: hasSkins,
    _group: source.group,
    _genderConfidence: g.confidence,
  };
}

const raw = readJSON(`${ROOT}/data/raw.json`);
const records = [];

for (const entry of raw.emojis) {
  const hasSkins = Array.isArray(entry.skins) && entry.skins.length > 0;
  records.push(makeRecord(entry, { base: null, skinTone: null, hasSkins }));
  if (hasSkins) {
    for (const skin of entry.skins) {
      records.push(
        makeRecord(skin, { base: entry.emoji, skinTone: skin.tone, hasSkins: false }),
      );
    }
  }
}

// Index by char and by hexcode so we can link gender variants to their base.
const byChar = new Map(records.map((r) => [r.char, r]));
const charByHex = new Map(records.map((r) => [r._hexcode, r.char]));

// Link top level gender variants to their neutral base, and promote that base
// to gender neutral when a gendered sibling points at it.
for (const r of records) {
  if (r.base !== null) continue; // skin variants already carry a base
  if (r.gender !== "male" && r.gender !== "female") continue;
  let neutralChar = null;
  for (const nHex of neutralHexCandidates(r._hexcode)) {
    const hit = charByHex.get(nHex);
    if (hit && hit !== r.char) {
      neutralChar = hit;
      break;
    }
  }
  if (!neutralChar) continue;
  r.base = neutralChar;
  const neutral = byChar.get(neutralChar);
  if (neutral && neutral.gender === null) {
    neutral.gender = "neutral";
    neutral._genderConfidence = 0.9;
  }
}

// Assign slugs, resolving the rare collision with a short code point suffix.
const seen = new Map();
for (const r of sortByCodepoint(records)) {
  let slug = r.slug;
  if (seen.has(slug)) {
    slug = `${slug}-${r.codepoints.map((c) => c.toString(16)).join("-")}`;
  }
  seen.set(slug, true);
  r.slug = slug;
}

const sorted = sortByCodepoint(records);
writeJSON(`${ROOT}/data/records.json`, sorted);

// Counts for the summary.
const bases = sorted.filter((r) => r.base === null).length;
const skinVariants = sorted.filter((r) => r.skin_tone !== null).length;
const genderVariants = sorted.filter((r) => r.base !== null && r.skin_tone === null).length;
const genders = { male: 0, female: 0, neutral: 0, none: 0 };
for (const r of sorted) genders[r.gender ?? "none"] += 1;

log("EXPAND complete");
log(`  total records    ${sorted.length}`);
log(`  base emojis      ${bases}`);
log(`  skin variants    ${skinVariants}`);
log(`  gender variants  ${genderVariants}`);
log(`  gender male      ${genders.male}`);
log(`  gender female    ${genders.female}`);
log(`  gender neutral   ${genders.neutral}`);
log(`  wrote            data/records.json`);
