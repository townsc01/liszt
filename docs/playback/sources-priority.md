# Playback sources: priority order and coverage

> Codex spec. Supersedes the draft specs in PR #35 (eporner fallback lane) and PR #36 (sxyprn duration-matching second pass). Consolidates both into one source-priority design. Matching algorithm details live in `docs/playback/matching-algorithm.md`.

## Source priority

liszt resolves playback for TPDB-catalogue scenes against two tube sources, in this order:

1. **sxyprn (first source).** Backbone. Full-length uploads of the catalogue's studios actually exist here. Measured coverage on the 184-scene catalogue (2026-09-25 snapshot): **103/184 = 56.0%** (90 from the existing first-pass enrichment + 13 from the duration-gate second pass). Playback goes through the server-side stream proxy shipped in PR #38 (`src/video-proxy.js`) because sxyprn CDN URLs are IP-bound to the minting IP.
2. **eporner (second source).** Supplement, queried only for scenes sxyprn missed. Real REST API, no key, per_page=1000, `length_sec` on every row, iframe-clean embeds (no IP-binding, no proxy needed). Measured: 7 matches, all Tushy, ~100% precision; **+2 net-new over sxyprn** (union 105/184 = 57.1%). Studio-keyword search pools are the query mechanism.

### Rejected sources (measured, 2026-09-25)

- **xvideos**: official full-database export (5,211,923 rows measured, daily deltas at info.xvideos.net/db) ran through the identical gate: **3 matches, 1 solid** (+3 net-new, union 57.6%). The library is amateur/clip-shaped; full-length studio uploads essentially do not exist (0 matches across 116 applicable non-Maximo scenes). Not worth a lane.
- **Thumbnail matching (any tube, any variant)**: falsified three ways - dHash 95-145/256 (random), colour histogram no separation (true-mean 0.459 vs control-min 0.473), average colour controls closer than true pairs. Uploaders re-encode/re-thumb; thumbnails carry no identity signal.

## Coverage ceiling: missing TPDB durations

Only **120/184** scenes have a TPDB duration to gate on (Maximo Garcia missing 59/63, Bang! Originals 5/5). Duration-based matching on any source caps at 65.2% of the catalogue. The largest single coverage lever is an alternate duration source for Maximo scenes (studio-site / AnalVids page scrape), not another tube.

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

## Flow

1. First pass (existing): sxyprn performer/code search, title-score >= 0.75, details-verified.
2. Second pass (PR #36 mechanism): for scenes still unmatched with a known duration, re-sift the search cards through the matching algorithm (see matching-algorithm.md). No extra HTTP: cards already carry `durationSeconds`.
3. Third pass: eporner studio-pool sweep for remaining unmatched scenes with durations, same gate. Embed URL stored directly (no proxy).

## Non-goals

- No xvideos lane (measured yield does not justify it).
- No thumbnail stage (falsified three ways).
- No merging of this spec; docs only.
