# Eporner fallback lane: raising the match rate

Status: design spec for Codex. Not implemented. Do not merge without Chris's review.
Date: 2026-09-25. Every number below comes from live measurements against the eporner API v2 and the post-refresh liszt catalogue (184 scenes, 5 studios, 90-day window) on that date.

Goal: eporner as a *fallback* playback source for scenes with no sxyprn link (89/184 scenes at measurement time). Sxyprn stays the primary lane. Eporner is embed-friendly by design - `https://www.eporner.com/embed/<id>/` iframes cleanly (no `x-frame-options`, no CSP `frame-ancestors`; verified live) - so playback is a trivial iframe once a confident match exists. The entire problem is matching.

## 1. What the eporner API v2 actually gives us (verified live)

`GET /api/v2/video/search/` and `/api/v2/video/id/` return JSON, no auth:

| Field | Value for matching |
|---|---|
| `length_sec` | Exact duration in seconds. The strongest signal we have - if we carry duration in our catalogue (see 3a). |
| `title`, `keywords` | Uploader-written; performer names and sometimes the studio name appear here. `keywords` = tags + title repeated. |
| `added` | Upload timestamp (minute precision). Uploads follow the studio release date by days-to-weeks. |
| `embed`, `url` | Playback + verification targets. |
| `default_thumb`, `thumbs[]` | 10-16 auto-extracted video frames at small/medium/big. See 2c for why these do not help us yet. |

Query params: `query` (free text), `per_page` (**1000 works**), `page`, `order=latest`, `thumbsize`, `format=json`.

**One call pulls a studio's entire eporner upload history.** Measured pool sizes (`order=latest&per_page=1000`): tushy 693, maximo garcia 175, lancelot 67, mambo perv 8, bang originals 3. The candidate-pool problem is therefore solved for free: one cached call per studio per sync cycle, then all matching is local. Real pools from measurement day are committed as `fixtures/eporner-studio-pools-2026-09-25.json` for replayable tests.

## 2. What does NOT work (measured, so we stop here)

### 2a. The old approach (title + performer only) - 3-9%, confirmed

The matcher removed in PR #25 scored 8/102. Reproduced against the current catalogue: strict title overlap + performer corroboration = 5/184 (3%); relaxed threshold + release-date token matching = 16/184 any-candidate (9%), 9/184 unambiguous. This is the ceiling of text-only matching, not an implementation bug.

### 2b. Per-performer queries - 0/14

A random 14-scene sample, querying eporner by each scene's performers and scoring all results: zero matches. The gap is *coverage*, not scoring: these niche Brazilian studios barely reach eporner within 90 days of release (lancelot 67 uploads all-time vs 71 catalogue scenes; mambo 8; bang 3). No matcher fixes content that is not there.

### 2c. Thumbnail matching against TPDB images - falsified on a known hit

Chris's hunch was that thumbnails are the route. Tested directly: for a confirmed exact match (Tushy scene "Perfect Hottie Wants Anal", title score 1.0), the dHash (16x16, 256-bit) distance between our TPDB `thumbnailUrl` and each of the eporner video's 10 preview frames was 95-145 bits - indistinguishable from random (~128). **TPDB thumbnails are studio promo stills, not video frames.** Perceptual hashing cannot bridge promo-still -> frame. Do not build thumbnail matching on TPDB images.

(For the record: eporner `thumbs[]` ARE video frames, so frame-to-frame hashing would work against another frame source - e.g. sxyprn post thumbnails - if that ever becomes useful. Note and shelve.)

### 2d. Release-date tokens in titles - 2%

Only 16/946 pooled eporner titles embed an upload date (`26 09 06` style). A nice corroborator when present, useless as a pillar.

## 3. The recommended pipeline

Ordered; each step is independently shippable.

### 3a. Carry `duration` into the catalogue (one line, biggest lever)

TPDB's scene payload includes `duration` (seconds; confirmed in the public OpenAPI schema `SceneResource.duration` at api.theporndb.net/openapi.json, and present on the `/scenes` records we already fetch). `parseTpdbScene` in `src/studios/tpdb.js` currently drops it - the catalogue rows have no duration field, which is the only reason duration matching is not already possible.

Change: map `durationSec: record.duration ?? null` in `parseTpdbScene`, update `fixtures/tpdb-tushy.json` and the expected shape in `test/catalogue.test.js`. Verify against a live TPDB response before relying on it (the fixture only ever carried the fields the parser read).

### 3b. Studio-pool fetch with caching

Per sync cycle, one call per studio: `query=<studio keyword>&per_page=1000&order=latest&thumbsize=medium&format=json`. Keyword per studio authority ("tushy", "lancelot", "mambo perv", "bang originals", "maximo garcia") - these exact strings produced the pools above. Cache the pool in memory keyed by studio; no persistence needed (prototype catalogue wipes on restart anyway).

### 3c. Candidate scoring (duration-first)

For a scene with `durationSec`, filter its studio's pool:

1. `|length_sec - durationSec| <= 20` (uploader trims and re-encodes shift runtime by seconds; 20s is generous but duration is nearly unique within a studio pool, so collisions stay rare).
2. Among duration survivors: title token overlap (reuse `titleWords`/`titleScore` from `src/sxyprn.js`) >= 0.5, OR any performer full-name substring in `title`/`keywords`.
3. Accept only if exactly one candidate survives, or the top candidate beats the runner-up on a second signal (title score margin >= 0.1, or one has a performer hit and the other does not).

Require >= 2 independent signals for any acceptance (duration alone is one signal; duration + title or duration + performer is a match).

Without `durationSec` (older rows): title >= 0.6 + performer hit + upload window (`added` within releaseDate-3d..releaseDate+120d). Expect single-digit percentages - this is the 2a regime, kept only so the lane degrades gracefully.

### 3d. Studio-aware enablement (the honest part)

Coverage, measured: Tushy 10/13 scenes had a candidate at title>=0.5; Maximo 4/63; Lancelot 2/71; Mambo 0/32; Bang 0/5. Eporner fallback is a **Tushy-only story today** and should ship that way: per-studio on/off driven by measured precision on the last sync, default off until a studio demonstrates >= ~30% recall with zero false positives on a hand-checked sample. Enabling globally would produce wrong-video playback for the Brazilian studios - worse than no playback.

### 3e. Storage and UI

On match: `epornerUrl` (the canonical page URL), `epornerEmbedUrl`, `epornerMatchedAt`, `epornerSignals` (which signals fired). Watch overlay: if no sxyprn link but a confident eporner match exists, offer the eporner iframe with a small "via eporner" badge. No sxyprn behavior changes.

## 4. Expected rates, stated honestly

- Tushy with duration matching: plausibly 50-70% of tushy scenes (77% had even a loose candidate; duration disambiguates the rest). Tushy is 13/184 of the catalogue.
- Catalogue-wide today: ~10-20% of the 89 unlinked scenes, almost all of it Tushy. This is a gap-filler, not a primary source - it complements the sxyprn proxy spec, it does not replace it.
- The number improves on its own as uploads accumulate; a weekly re-match pass over unlinked scenes will pick up late uploads (eporner lag is days-to-weeks).

## 5. Render $0 feasibility

Everything above is a JSON API call per studio per sync plus local scoring - trivial CPU, no new dependencies. The falsified thumbnail route was the only GPU/CPU-heavy idea; it is explicitly out. If frame-hashing is ever revived (2c), pure-JS dHash over `jimp` is sufficient at this scale - but do not build it against TPDB stills.

## 6. Tests

- `fixtures/eporner-studio-pools-2026-09-25.json` (committed): the real pools from measurement day, slimmed to match-relevant fields. Replay scoring against the committed catalogue snapshot and assert the measured hit set (Tushy hits are known and listed in test comments).
- Unit: duration tolerance filter, signal-count requirement, ambiguity rejection, per-studio enablement gate.
- Fixture-based integration: with duration present, "Perfect Hottie Wants Anal" must match exactly one eporner id; with duration absent, the same scene must not match on title alone below threshold.

## 7. Open questions for Chris

1. Tushy-only enablement at launch: acceptable, or hold the whole lane until Brazilian-studio coverage improves?
2. Wrong-match tolerance: is a badge-labeled fallback with a "wrong video?" report link enough, or should matches below the ambiguity margin be hidden entirely? (Spec assumes hidden.)
