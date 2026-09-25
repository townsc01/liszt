# Playback link sources: sxyprn and eporner

> **Depends on:** none. **Status:** implemented (#46).

> Codex spec. The foundational statement: liszt resolves playback for TPDB-catalogue scenes
> against **two tube sources, sxyprn and eporner**, and stores what it finds as LINKS on the
> scene record. How those links are turned into playable embeds is specified per source in
> `docs/playback/sxyprn-embed.md` and `docs/playback/eporner-embed.md`. How a candidate is
> judged to BE a scene is `docs/playback/matching-algorithm.md`.
>
> Supersedes the draft specs in PR #35 (eporner fallback lane), PR #36 (sxyprn
> duration-matching second pass) and PR #39 (combined sources-priority draft, closed in
> favour of this split). Docs-only; do not merge without review.

## The two sources, in priority order

1. **sxyprn (first source).** Backbone. Full-length uploads of the catalogue's studios
   actually exist here. Measured coverage on the 184-scene catalogue (2026-09-25 snapshot):
   **103/184 = 56.0%** (90 first-pass + 13 duration-gate second pass).
2. **eporner (second source).** Supplement, queried only for scenes sxyprn missed. Real REST
   API, no key, `per_page=1000`, `length_sec` on every row. Measured: 7 matches, all Tushy,
   ~100% precision; **+2 net-new over sxyprn** (union 105/184 = 57.1%). Studio-keyword search
   pools are the query mechanism (never tags - tube tags are optional and poorly applied).

### Rejected sources (measured, 2026-09-25)

- **xvideos**: official full-database export (5,211,923 rows, daily deltas at
  info.xvideos.net/db) through the identical gate: **3 matches, 1 solid** (+3 net-new, union
  57.6%). The library is amateur/clip-shaped; full-length studio uploads essentially do not
  exist (0 matches across 116 applicable non-Maximo scenes). Not worth a lane.
- **Thumbnail matching (any tube, any variant)**: falsified three ways - dHash 95-145/256
  (random), colour histogram no separation (true-mean 0.459 vs control-min 0.473), average
  colour controls closer than true pairs. Thumbnails carry no identity signal.

## Link storage

One generic field, `videoUrls`: a list of `{ source: "sxyprn" | "eporner", url, embedUrl,
verifiedAt }` entries per scene. Source-tagged so additional sources never need a schema
migration, and so the UI can offer both when present. Sxyprn links point at the watch page;
eporner links carry the API's `embed` URL as well (see the embed specs).

## Coverage ceiling: missing TPDB durations

Only **120/184** scenes have a TPDB duration to gate on (Maximo Garcia missing 59/63,
Bang! Originals 5/5). Duration-based matching on any source caps at 65.2% of the catalogue.
The largest single coverage lever is an alternate duration source for Maximo scenes
(studio-site / AnalVids page scrape), not another tube.

## Per-studio measured coverage (2026-09-25)

| studio | N (with dur) | sxyprn | eporner | xvideos |
|---|---|---|---|---|
| Lancelot Styles Evolution | 71 (71) | 65 | 0 | 0 |
| Maximo Garcia | 63 (4) | 1 | 0 | 3 |
| Mambo Perv | 32 (32) | 27 | 0 | 0 |
| Tushy | 13 (13) | 8 | 7 | 0 |
| Bang! Originals | 5 (0) | 2 | 0 | 0 |
| **total** | **184 (120)** | **103 (56.0%)** | **7 (3.8%)** | **3 (1.6%)** |

Three-tube union: 108/184 = 58.7%.

## Resolution flow

1. First pass: sxyprn performer/code search, details-verified.
2. Second pass: for scenes still unmatched with a known duration, re-sift the search cards.
   No extra HTTP: cards already carry `durationSeconds`.
3. Third pass: eporner studio-pool sweep for remaining unmatched scenes with durations.

**One gate (DECIDED 2026-09-26).** The matching algorithm's cascade is the ONLY admission
gate in every pass - passes differ in query breadth, never in the gate. The legacy 0.75
title-score threshold and any duration-only admission path are superseded by the cascade.

## Per-lane matcher contract

Each catalogue lane (a studio adapter, or a lane adapter like FC2) declares whether and how
its scenes match against tube sources:

- **matcher**: the module that maps the lane's scene records to tube candidates. Western
  studios: the matching-algorithm cascade against sxyprn + eporner. FC2: exact PPV-code
  identity. A lane may declare NO matcher (metadata-only, e.g. madouqu) - sync then skips
  video matching for its scenes entirely.
- **identity**: the lane's match condition (the cascade's stage-3 gate for western studios;
  exact code-in-title for FC2).
- Sync consults the lane's declaration before matching anything. The current implementation
  matches every scene against sxyprn+eporner globally; bringing sync under this contract is
  prerequisite work for the FC2 lane, and the FC2/madouqu lane specs point here for it.

The contract lives here because link-sources owns which sources exist and how links are
stored; the gates themselves live in `docs/specs/matching-algorithm.md` (western) and the
lane specs (per-lane identity rules).

## Link lifecycle: dead-link re-verify

Links go stale (uploader deletion, DMCA, removed posts). Each sync re-verifies a rotating
slice of stored links, cheaply: sxyprn watch URLs via a fetch of the watch page, eporner
links via the API's `video/id` lookup. A link that fails verification is marked dead on the
scene record (kept for history, hidden from the UI) and the scene re-enters the normal
resolution flow on a later pass. This is where the eporner-embed spec's "mark the link dead
on the next sync's spot-check" hook lands.

## Non-goals

- No xvideos lane (measured yield does not justify it).
- No thumbnail stage (falsified three ways).
- No tag-based search on any tube.
- Embed mechanics live in the two embed specs, not here.
- No merging of this spec; docs only.
