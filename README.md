# emoji.group

The emoji database, curated. A deterministic data pipeline that produces a
static JSON emoji API, plus the website that renders it.

Every skin tone and gender variant is its own queryable record, so `👍🏿` is
directly addressable, while tagging only ever happens on base emojis and the
variants inherit. Collections are sorted by how people actually use emoji:
by vibe (cozy, spooky, retro), by industry (logistics, healthcare), by
measured colour, and by safety, with human review gating everything that
ships in a blocklist.

The whole build is deterministic: same input, same output, stable codepoint
order everywhere, dated by the `VERSION` file rather than the wall clock.
No em-dashes anywhere in code or data, by house rule.

## The data model

Emoji record (`/emojis.json`):

```json
{
  "char": "👍🏿",
  "name": "thumbs up: dark skin tone",
  "slug": "thumbs-up-dark-skin-tone",
  "codepoints": [128077, 127999],
  "unicode_version": "1.0",
  "base": "👍️",
  "skin_tone": 5,
  "gender": null,
  "tags": [ { "tag": "skin-tone-5", "facet": "skin-tone", "confidence": 1, "source": "programmatic" } ]
}
```

Collection record (`/collections/{slug}.json`, also served at `/{slug}.json`):

```json
{ "slug": "cozy", "tag": "cozy", "title": "Cozy", "facet": "vibe",
  "mode": "include", "emojis": ["🕯️", "🧸", "☕️"], "count": 22,
  "version": "2026-07-21" }
```

When a collection contains skin tone variants it also carries
`emojis_default` and `count_default`: the members without a tone modifier
(the standard yellow spellings). Collections without tone variants omit the
fields, so `emojis_default ?? emojis` always gives the standard set:

```json
{ "slug": "gestures", "count": 278, "emojis": ["👍️", "👍🏻", "👍🏼", "…"],
  "count_default": 43, "emojis_default": ["👍️", "👋", "…"] }
```

Safety collections are additionally emitted under `/blocklists/{slug}.json`
with `mode: "exclude"`, meaning apps should exclude those emojis. Blocklists
carry the same default fields, so tone aware exclusion stays one lookup.

## Facets

| Facet | Source | Tags |
|---|---|---|
| vibe | model proposed, review pending | dark, cute, aesthetic, chaotic, cozy, retro, romantic, spooky, festive, calm |
| object | model proposed, review pending | weapon, tool, vehicle, food, drink, clothing, tech, instrument, sport-equipment |
| domain | model proposed, review pending | logistics, construction, healthcare, finance, education, travel, nature, office, gaming, music, sports |
| color | measured from Twemoji artwork | red, orange, yellow, green, blue, purple, pink, brown, black, white, gray |
| safety | model proposed, human reviewed | suggestive, violent, substances, gambling |
| gender | derived from codepoints | male, female, neutral |
| skin-tone | derived from codepoints | skin-tone-1 … skin-tone-5, skin-tone-default |
| audience | derived at build time | kid-safe (everything minus the safety blocklists) |

## Pipeline

Each step is a standalone npm script. `npm run pipeline` runs the full offline
chain; `npm run release` also rebuilds the site.

| Step | Command | What it does |
|---|---|---|
| 1. Ingest | `npm run ingest` | Load emojibase-data into `data/raw.json`. |
| 2. Expand | `npm run expand` | Every skin tone and gender variant becomes its own record with a `base` pointer. |
| 3a/b. Programmatic | `npm run tag:programmatic` | Gender (ZWJ sequences, person components) and skin tone tags. |
| 3c. Colour | `npm run tag:color` | Rasterise each Twemoji SVG, measure the dominant hue by filled pixel area, tag a colour only at 45% coverage or more. Cached in `.cache/`. |
| 4. LLM tags | `npm run tag -- --facet=safety` | Batch base emojis (40 per request, 4 concurrent) against the closed vocabulary in `prompts/facet-{name}.txt`, validate, retry once, write `data/llm/{facet}.json`. Idempotent; `--dry-run` works without credentials. |
| 4-alt. Seed | `npm run seed:llm` | Model proposals authored offline by Claude (the same model family the harness calls), for building without an API key. The harness replaces these when run for real. |
| 6. Review | `npm run review` | Local web grid to approve or reject proposed tags. Approvals become `source: "human"`, rejections drop the tag. |
| 5+7. Build | `npm run build` | Inheritance, review decisions, kid-safe derivation, collections and blocklists into `/dist`. Fails if any safety tag is still `source: "llm"`. |
| 8. Verify | `npm run check` | JSON schema validation of `/dist`, duplicate and sort-order detection, coverage report. |
| Site | `npm run site` | Render `/dist` into `site/public/`: landing page, one page per collection, client side search, sitemap, llms.txt, OG images. |
| Preview | `npm run serve` | Local server with the production URL behaviour (clean URLs, JSON twins, 404). |

### Inheritance rules

Vibe, object, domain and safety tags inherit from a base emoji to every
variant. Gender and skin tone are per-record facts and never inherit. Colour
inherits to gender variants but **not** to skin tone variants, because the
skin tone changes the artwork the hue was measured from: a dark thumbs up is
not "yellow" just because the base artwork is.

### Safety gates

Safety tags pass three gates: a programmatic pass, a model proposal with a
confidence score, and a human review. The compiler refuses to ship any safety
tag a reviewer has not approved, and `kid-safe` is derived at build time as
everything minus the blocklists, so the two can never drift apart.

The current safety decisions were made in a review pass by Claude and recorded
in `data/reviews.json`. To re-review from scratch, delete the relevant entries
there and run `npm run review`; the build will hold until every safety tag has
a fresh decision.

## Serving

`vercel.json` deploys `site/public` with clean URLs. Every collection lives at
two URLs, one character pair apart:

```
emoji.group/cozy                     the page, for people
emoji.group/cozy.json                the data, for programs
emoji.group/emojis.json              the full database
emoji.group/collections/index.json   every collection with counts
emoji.group/blocklists/violent.json  exclude mode blocklist
```

JSON responses carry `access-control-allow-origin: *`. Caching leans on the
fact that Vercel purges its edge cache on every deployment: `s-maxage` is a
full year (the CDN serves from edge until the next deploy), browser `max-age`
stays short (10 minutes for pages, 1 hour for JSON, 1 day for assets), and
`stale-while-revalidate` keeps responses instant while the edge refreshes.

## Versioning and reproducibility

Builds are dated by the `VERSION` file. CI rebuilds the pipeline from committed
inputs and fails if any output differs by a single byte (`.github/workflows/ci.yml`).
Bump `VERSION` to cut a new dated release.

## Licences

Code is MIT. Emoji metadata derives from emojibase-data (MIT). Colour tags are
computed from Twemoji artwork (CC-BY 4.0); the artwork itself is not
redistributed. See `LICENSE` for details.
