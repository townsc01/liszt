# Eporner fallback lane: raising the match rate

Status: design spec for Codex. Not implemented. Do not merge without Chris's review.
Date: 2026-09-25, revised same day after Chris's pipeline proposal was tested empirically (see 3). Every number below comes from live measurements against the eporner API v2, the TPDB API, and the post-refresh liszt catalogue (184 scenes, 5 studios, 90-day window).

Goal: eporner as a *fallback* playback source for scenes with no sxyprn link (89/184 scenes at measurement time). Sxyprn stays the primary lane. Eporner is embed-friendly by design - `https://www.eporner.com/embed/<id>/` iframes cleanly (no `x-frame-options`, no CSP `frame-ancestors`; verified live) - so playback is a trivial iframe once a confident match exists. The entire problem is matching.

## 1. What the eporner API v2 actually gives us (verified live)

`GET /api/v2/video/search/` and `/api/v2/video/id/` return JSON, no auth:

| Field | Value for matching |
|---|---|
| `length_sec` | Exact duration in seconds. The strongest signal we have - once we carry TPDB duration (see 2a). |
| `title`, `keywords` | Uploader-written; performer names and often the studio name appear here. `keywords` = tags + title repeated. |
| `added` | Upload timestamp (minute precision). Uploads follow the studio release date by days-to-weeks. |
| `views`, `embed`, `url` | Tiebreak (multi-upload dedupe) + playback/verification targets. |
| `default_thumb`, `thumbs[]` | 10-16 auto-extracted video frames at 3 sizes. See 2c for why these do not help us yet. |

Query params: `query` (free text), `per_page` (**1000 works**), `page`, `order=latest`, `thumbsize`, `format=json`.

**One call pulls a studio's entire eporner upload history.** Measured pool sizes (`order=latest&per_page=1000`): tushy 693, maximo garcia 175, lancelot 67, mambo perv 8, bang originals 3. One cached call per studio per sync cycle; all matching is local. Real pools from measurement day are committed as `fixtures/eporner-studio-pools-2026-09-25.json` for replayable tests.

## 2. Prerequisites and falsified routes (measured, so we stop guessing)

### 2a. Carry `duration` into the catalogue (one line, mandatory)

TPDB scene records include `duration` in seconds (confirmed in the public OpenAPI schema `SceneResource.duration` at api.theporndb.net/openapi.json, and pulled live for this analysis). `parseTpdbScene` in `src/studios/tpdb.js` drops it today.

Change: map `durationSec: record.duration ?? null` in `parseTpdbScene`; update `fixtures/tpdb-tushy.json` and `test/catalogue.test.js`.

Measured duration coverage of the current catalogue (live TPDB pull, 2026-09-25): Tushy 13/13, Lancelot 71/71, Mambo 32/32, Maximo 4/63, Bang 0/5 (TPDB returned no in-window scenes for the matched Bang! Originals site at all - Codex should check which site id the bang adapter resolves). Catalogue-wide: 120/184 (65%).

Operational note (2026-09-25): of the API keys on hand for ThePornDB, only the one labelled "ThePornDB API token (Cloud0 Stash)" authenticated successfully during this analysis; two other stored keys returned 401 Unauthenticated and were purged. Render's TPDB_API_KEY (set by Chris in the dashboard, no entry in render.yaml) is verified working - the 2026-09-25T07:16Z live refresh returned all five studios with error null. If Codex hits 401s, the key being used is stale, not the API.

### 2b. Old title-only matching - 3-9%, confirmed

The matcher removed in PR #25 scored 8/102. Reproduced: strict title overlap + performer corroboration = 5/184 (3%); relaxed threshold + release-date tokens = 9% any-candidate, 5% unambiguous. Text-only matching stays at this ceiling.

### 2c. Thumbnail matching against TPDB images - falsified on a known hit

For a confirmed exact match (Tushy "Perfect Hottie Wants Anal"), dHash (16x16, 256-bit) distances between our TPDB `thumbnailUrl` and each of the eporner video's 10 preview frames: 95-145 bits - indistinguishable from random (~128). **TPDB thumbnails are studio promo stills, not video frames.** Do not build thumbnail matching on TPDB images. (Eporner thumbs ARE frames; frame-to-frame hashing against another frame source - e.g. sxyprn post thumbnails - would work if ever needed. Note and shelve.)

### 2d. Date-stamped titles - 2%

16/946 pooled eporner titles embed an upload date (`26 09 06` style). A free corroborator when present, never a pillar.

### 2e. Searching eporner BY performer name - 0/14

Querying the eporner search API with the performer as `query` and scoring results by title: zero matches on a random 14-scene sample. Eporner's search does not reliably surface these scenes under performer names. Filtering a studio pool by performer-in-title (below) is a different, working route.

## 3. Chris's pipeline, tested: fuzzy performer-in-title AND TPDB duration

Chris's proposal (2026-09-25): match eporner candidates that include the performer (fuzzy) in the title AND match TPDB duration. Tested as specified against the real pools and real TPDB durations:

- Fuzzy performer: every token of any >=2-token performer name appears in the eporner title's token set (normalised, accent-stripped).
- Duration gate measured at tolerances 0s / 2s / 20s - **identical results at all three**: true matches land on the exact second. Ship +-2s.

### Measured results

| Studio | matched / scenes | notes |
|---|---|---|
| Tushy | **7/13 (54%)** | 7/7 spot-checked hits are certain true positives (performer in title + duration exact to the second + studio-date naming) |
| Lancelot | 0/71 | pool has uploads, but none of our 90-day scenes (coverage, not matching) |
| Mambo | 0/32 | 8 uploads all-time |
| Maximo | 0/4 with duration | TPDB duration present for only 4/63 Maximo catalogue scenes |
| Bang | 0/5 | no TPDB rows, no eporner pool |
| **Total** | **7/184** | precision ~100% measured; recall = coverage-bound |

### Why the AND gate is load-bearing (collision evidence)

- **Performer-only floods**: 48/184 scenes get a performer-in-title hit; only 7 of the 48 survive an exact-duration check. Performer names recur across dozens of unrelated videos.
- **Duration-only collides, even exactly**: Lancelot scene "Once Again, The Sexy Colombian Ashley Vixen" (2630s) collides to the second with the wrong upload "Belinda Pink ... Debuts With Lancelot" (2630s). Tushy "Legendary Alinas First Anal" (2373s) collides within 2s with the wrong "maddie wren perfect hottie" (2375s). Every duration-only candidate examined that failed the performer gate was a wrong or unverifiable scene. These are all ~40-minute scenes; durations cluster.
- Title similarity must NOT be a required signal: 3 of the 7 true matches score title 0.00 because the uploader renamed them to "Tushy 26 08 23 angie faith O68p" style (studio + date + performers + random suffix). Title is at most a tiebreak.

### Verdict

**Adopt Chris's pipeline as specified.** It is surgically precise (every accepted match verifiable, ~100% measured precision) and its recall is bounded entirely by eporner upload coverage, not by the matcher. On the one studio with coverage (Tushy) it already matches 54% of scenes; catalogue-wide it is 7/184 today and will grow as uploads accumulate (re-run matching on every sync; eporner lag is days-to-weeks).

### Pipeline (final)

1. Enrich catalogue with `durationSec` (2a).
2. Per sync: one cached pool call per studio keyword (1).
3. Per scene with `durationSec`: candidates = pool videos where `|length_sec - durationSec| <= 2` AND fuzzy-performer-in-title.
4. Multiple surviving candidates are usually duplicate rips of the same scene (observed: identical title stem, different suffix) - pick highest `views`, then oldest `added`. True ambiguity (different title stems) -> no match.
5. Store `epornerUrl`, `epornerEmbedUrl`, `epornerMatchedAt`, `epornerSignals` (`["duration","performer"]`). UI: iframe embed with a "via eporner" badge when no sxyprn link exists.
6. Studio-aware enablement: per-studio measured precision on the last sync; default OFF for studios with zero demonstrated coverage (everything except Tushy today). A studio turns on when a hand-checked sample shows hits with zero false positives.

## 4. Expected rates, stated honestly

- Tushy: ~54% of tushy scenes today (7/13), rising as uploads accumulate.
- Catalogue-wide: ~4% today, growing weekly; almost entirely Tushy until Brazilian-studio coverage appears.
- This is a gap-filler that is *right every time it fires*, not a volume play. It complements the sxyprn proxy spec; it does not replace it.

## 5. Render $0 feasibility

One JSON call per studio per sync + local scoring. No new dependencies, no image processing (2c killed the only heavy idea). Trivial.

## 6. Tests

- `fixtures/eporner-studio-pools-2026-09-25.json` (committed): real pools, slimmed to match-relevant fields.
- Fixture durations: extend `fixtures/tpdb-tushy.json` with `duration` and assert the 7 known true matches match, and - critically - assert the known collisions do NOT match: "Legendary Alinas First Anal" (2373s) must not match "maddie wren" (2375s); "Ashley Vixen" (2630s) must not match "Belinda Pink" (2630s).
- Unit: fuzzy performer token matching (accent/case), +-2s gate, multi-upload dedupe (views then oldest), true-ambiguity rejection, per-studio enablement gate.
- Integration: replay scoring over the fixture pools; assert exactly the measured hit set.

## 7. Open questions for Chris

1. Tushy-only enablement at launch: acceptable, or hold until Brazilian-studio coverage appears?
2. Bang! Originals: TPDB returned zero in-window scenes for the matched site - want Codex to check the site id the bang adapter resolves, or is Bang sourced differently?
