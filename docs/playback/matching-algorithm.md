# The matching algorithm

> Codex spec. How liszt decides that a tube upload IS a given TPDB scene. Source priority lives in `docs/playback/link-sources.md` (PR #41; embeds in the sxyprn-embed and eporner-embed specs). Every stage below carries its measured evidence from the 2026-09-25 runs (184-scene catalogue, sxyprn + eporner + xvideos).

## Principle

**Better no link than a wrong link.** Every stage is a precision instrument. When candidates disagree about identity, the algorithm rejects rather than guesses.

## Query construction (before the cascade runs)

The candidate pool comes from search queries. Queries are cheap recall; the gate below is the precision mechanism.

The algorithm is **uniform across all studios** - no per-studio branches. Studios differ only in query configuration (which extra queries a studio's watchlist adds) and in source-pool coverage, never in the cascade or the gate.

- Up to 2 normalised performer names. **Single-token performer names MUST generate queries too** - the earlier >=2-token rule produced zero queries for "Beauty Saves Marriage With Anal" (performer "Geishakyd") and silently skipped the scene; it sits on sxyprn at 1s off (two uploads, 2504s vs TPDB 2503s).
- The studio name as an additional query. Measured rescue: the `tushy` query surfaced the Geishakyd scene above. Studio in the QUERY list is cheap recall. (Studio in the GATE is falsified - see stage 4.)
- Per-studio query config, e.g. the Mambo scene code (existing behaviour). Config, not an algorithm branch.
- **Never tag-based search (Chris's constraint, 2026-09-25).** Tube tags are optional and poorly
  applied - on eporner especially. Candidate pools are built ONLY from performer-name, studio-name,
  scene-code, and title-keyword queries (full-text), never from tag filters or tag-derived queries.
  Tags on a candidate may be READ as corroborating evidence after the gate, but a tag can never be
  the reason a candidate enters the pool.

## The cascade

### Stage 1 - duration: |candidate - scene| <= 2s

The filter that makes everything else cheap. True matches land on the exact second or 1s off (measured on sxyprn and eporner true pairs all night). Duration alone is NOT sufficient: 15 eporner rows landed inside Lancelot duration windows while being different Lancelot scenes of near-identical length (same studio publishes many scenes at 2439s/2630s); every one was correctly rejected by stage 3. xvideos density at short durations reaches a median 6,615 in-window candidates per Maximo scene.

### Stage 2 - upload-date window: upload within [release, release+7d] - MEASURED, NOT match-grade

Chris's proposed stage 2, measured before adoption (2026-09-25):

- **Sensitivity 0/19.** Across every verified true match with a known upload date, NONE fall in the window: eporner 0/11 (Tushy scenes released Jul-Aug 2026 were uploaded 2026-09-17/18 - repost lag runs 6-10 weeks); xvideos 0/8, including one verbatim-title true match uploaded 2026-07-17, one day BEFORE its 2026-07-18 release (leaks precede street date).
- Specificity is excellent (eporner 96/97 wrong candidates filtered; xvideos 84,631/85,055) but useless when the condition also kills every true match.
- **Verdict: rejected as a stop-and-match condition.** Upload date is demoted to a tiebreak signal (ranking only, below). Field availability: eporner `added` (verified genuine, spread 2009-2026), xvideos export column 13. sxyprn cards carry no upload date; using it there would need a details() fetch per candidate and breaks the zero-extra-HTTP design of the sxyprn second pass.
- **Fresh-item retest, Chris's exact spec (2026-09-25 PM).** Duration ±30s AND upload within release ±7d, NO title/performer/studio criteria, the 10 most recent catalogue scenes (8 runnable, 2 lack TPDB durations). Sxyprn: 5/8 items matched, 16 claimed hits, manual review 13 true / 3 false (~81% precision - Maya Bell would have linked a Yasmina Khan gangbang; Marfe a "Badgirl Sandra" scene). Eporner: 0/8 from query pools; against an unbiased latest-600 pool all 8 items "matched" but 42/44 were wrong scenes (~2-5% precision). Conclusions: for FRESH items the ±7d window costs no true matches (uploads land same-day; no contradiction with the 0/19 tail result - repost lag hits the July/Aug catalogue, not release-week items); and duration+date WITHOUT identity verification produces false links at 19% (sxyprn) to ~97% (eporner) rates - confirming stage 3 must remain the gate.

### Stage 3 - performer OR verbatim title (the match condition)

Accept when: every token of a performer name is present in the normalised candidate title (any performer, any token count), OR the candidate title contains the normalised scene title verbatim. Measured precision ~100% on both tubes (eporner 7/7 Tushy spot-checked true; sxyprn 13/13 second-pass spot-checked true; the 15 Lancelot collisions all correctly rejected). Uploader retitling is why title SIMILARITY is not required; token presence is.

### Stage 4 - studio in title - MEASURED, rejected

Chris's proposed stage 4, measured with the exact variant (duration +-2s AND (performer OR verbatim OR studio-in-title)):

- eporner + xvideos: gains 13 scenes, **all 13 verified wrong** - "Legendary Alinas First Anal" matched a Maddie Wren upload; the Lancelot gains are the known 15-collision set (Cheyla Collins upload matched to an Emy Rous scene, etc.); xvideos' gain is two Tushy compilations.
- sxyprn Tushy slice: zero studio-only gains (the 8 matched scenes all carry performer/verbatim evidence anyway).
- Mechanism: same-studio scenes cluster at near-identical durations and repost titles almost always carry the studio tag, so studio-only matches are pure noise.
- **Verdict: rejected as a match condition. Studio stays query-only** (query construction above), where it measured as a recall win.

## Tiebreak: picking among multiple accepted candidates

When stages 1+3 accept more than one candidate (duplicate rips are routine - "Perfect Hottie Wants Anal" has 5 in-window sxyprn uploads):

1. **Dedupe by title stem.** Normalise title, strip repost decorations (`{NEW}`, `{Watch/Download:}` URLs, trailing hashtag blocks, dates); candidates sharing a stem are one logical upload - keep the best by the ranking below.
2. **Rank:** exact-duration closeness first, then upload date closest to release date (where the field exists), then views, then oldest.
3. **Distinct-identity disagreement = reject.** If surviving candidates have genuinely different identities (different title stems AND different uploaders - i.e. possibly different scenes), do not force a pick. No link beats a wrong link.

## Non-goals / falsified stages (do not re-add)

- Thumbnail similarity, all variants (dHash, colour histogram, average colour): no identity signal. Measured on both tubes.
- Upload-date window as a match condition: 0/19 sensitivity on the catalogue tail; ~19-97% false-positive rate without identity checks on fresh items.
- Studio-in-title as a match condition: 13/13 false positives.
- Tag-based candidate search on any tube (tags optional and poorly applied; eporner worst). Pools come from name/code/title full-text queries only.

## Negative tests (must not match)

- "Shy Pale Skin White Brazilian, Margo Ferreira" (1850s) must NOT match "La Paisita Oficial MILF..." (wrong performer at the right duration).
- The 15 eporner Lancelot duration-window rows (e.g. "Megan Petite's Return Vs Lancelot" at 2632s) must NOT match the Ashley Vixen / Cindy Lore / Desire Adams scenes at 2630/2441s.
- "Legendary Alinas First Anal" must NOT match "Tushy 26 09 06 maddie wren perfect hottie wants anal" (same studio, in-window, wrong performer - this is the studio-OR trap).
- Duration off by 3s: no match even with performer present.
- "Beauty Saves Marriage With Anal" (2503s, performer "Geishakyd") MUST match the 2504s sxyprn uploads - regression test for single-token performer queries.
- From the 2026-09-25 fresh-item test: "Maya Bell, 20Y Beautiful Brazilian First Double Anal" (2115s) must NOT match the in-window Yasmina Khan gangbang upload; "Petite Argentinian Anal Demolished" (1418s) must NOT match the in-window "Badgirl Sandra" creampie upload. Both land inside duration+date with no other check - stage 3 is what rejects them.
