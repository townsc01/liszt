# Sxyprn matching: performer + duration second pass

Status: design spec for Codex. Not implemented. Do not merge without Chris's review.
Date: 2026-09-25. Chris's idea (WhatsApp, same day): "What if we tried the same matching method for sxyprn? Does sensitivity increase?" Tested empirically against live sxyprn search and the post-refresh catalogue. Answer: yes - measured below.

Pairs with: `eporner-fallback-matching.md` (same pipeline, fallback lane) and `sxyprn-stream-proxy.md` (playback). All three assume `durationSec` lands in the catalogue (one-line `parseTpdbScene` change - TPDB records carry `duration`, schema-confirmed; see the eporner spec 2a).

## 1. Why this is cheap on sxyprn (unlike feared)

The sxyprn library's search cards already expose `durationSeconds` on every `VideoSummary` (parsed from the card, no details-page fetch), plus `title`, `views`, `isExternal`, `tags`. The duration gate runs on search results alone - zero extra HTTP calls per candidate, no 15-19s details() latency in the loop. The current matcher (`src/sxyprn.js`) already fetches these cards; the second pass reuses the same searches.

## 2. Measured (2026-09-25, post-refresh 184-scene catalogue)

Population: 94 scenes without sxyprn links at 07:16Z snapshot. TPDB duration available for 32 of them (the other 62 are 59 Maximo + 3 Bang scenes with no TPDB duration - the pipeline cannot apply; Maximo's TPDB duration gap is the dominant blocker).

Pipeline: queries = up to 2 normalised performer names + mambo scene code (same as the current matcher); collect all search cards; accept when `|durationSeconds - durationSec| <= 2` AND fuzzy performer-in-title (every token of a >=2-token performer name present in the card title).

| Studio | pipeline matches / unmatched-with-duration |
|---|---|
| Tushy | 8/13 |
| Mambo Perv | 3/8 |
| Lancelot | 1/7 |
| Maximo | 1/4 |
| **Total** | **13/32 (41%)** |

- 3 of the 13 (all Mambo) were also found by the current title matcher minutes later (07:22 snapshot). Net-new at measurement time: **10 scenes**.
- Union recall: 51.6% -> **57.1%** (95 + 10 of 184). The delta moves as enrichment catches up, but the pipeline's hits arrive immediately and include scenes the title matcher had already failed once.
- Precision: all 13 hits spot-checked - every one is the correct scene (candidates carry the verbatim scene title or the performer name at the exact duration). No false positives observed.

### Why the gates are shaped this way (evidence)

- True matches land on the exact second or +-1s (community re-encodes); +-2s suffices.
- Performer-gate rejections: exactly 1 scene had duration candidates that failed the performer gate - "Shy Pale Skin White Brazilian, Margo Ferreira" (1850s): its candidates were "La Paisita Oficial MILF..." (wrong performer, correct rejection) and "Margarida - Shy pale skin white #Brazilian..." (uploader wrote "Margarida", fuzzy tokens "margo ferreira" fail - but the post title contains the scene title verbatim). This motivates one OR-corroborator below.
- Retitled re-uploads exist: "Gorgeous Suraya Loves Anal" (2490s) surfaced two "Suraya Ndia Spicy Wet Black Pussy..." posts (2489/2491s) alongside the title-bearing "Tushy Suraya Ndia - Gorgeous Suraya Loves Anal" (2490s). Same-scene dupes; the title-bearing candidate must win.
- External-link posts (`isExternal`, e.g. lulustream/vidara wrappers) appear among candidates; keep the existing deprioritisation.

## 3. Design

After the current title-score pass fails for a scene, a second pass over the same search results (already fetched and cached - no new sxyprn traffic for scenes the first pass searched):

1. Candidates: all cards from the performer's/code queries (the current matcher discards sub-0.75 title scores; the second pass reconsiders the full card set).
2. Gate: `|durationSeconds - durationSec| <= 2` AND (fuzzy performer-in-title OR the post title contains the scene title verbatim, normalised).
3. Ranking: title-bearing candidates first, then non-external over external, then views. Store up to `maxMatches` URLs as usual.
4. Skip scenes without `durationSec`; log them so the TPDB duration gap is visible (59 Maximo scenes today).
5. Runs inside the existing enrichment loop (10s/scene pacing unchanged - no new requests, just extra scoring over already-fetched cards). One exception: if the first pass never issued a performer query (it stops early on success), the second pass may need one additional search for failed scenes.

## 4. Expected impact, stated honestly

- Today: +10 matched scenes (51.6% -> 57.1% catalogue coverage), 41% hit rate on duration-having unmatched scenes, ~100% observed precision.
- Ceiling rises with TPDB duration coverage: 62 unmatched scenes (59 Maximo) currently can't be evaluated at all.
- Some of today's net-new would eventually be found by the title matcher (3 of 13 were, within minutes). The pipeline's durable value is the residue the title matcher structurally misses (uploader retitles, tag-heavy titles) plus faster first-pass coverage.

## 5. Tests

- Fixture: a captured set of search cards per query for the measured scenes (record from the lib; commit alongside the spec implementation).
- Positive: "Maya Bell, 20Y..." (2115s) matches "{NEW} Maya Bell..." posts; "Perfect Hottie Wants Anal" (2160s) matches the Maddie Wren posts at 2159-2161s.
- Negative: "Shy Pale Skin White Brazilian, Margo Ferreira" (1850s) must NOT match "La Paisita Oficial MILF..." (wrong performer, no title overlap); "Gorgeous Suraya Loves Anal" must rank "Tushy Suraya Ndia - Gorgeous Suraya Loves Anal" above the two retitled dupes.
- Gate-boundary: duration off by 3s -> no match even with performer present.
