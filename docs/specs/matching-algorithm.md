# The matching algorithm

> **Depends on:** link-sources, studio-site-scraper.

> Codex spec. How liszt decides that a tube upload IS a given TPDB scene. Source priority lives in `docs/specs/link-sources.md` (PR #41; embeds in the sxyprn-embed and eporner-embed specs). Every stage below carries its measured evidence from the 2026-09-25 runs (184-scene catalogue, sxyprn + eporner + xvideos).

## Principle

**Better no link than a wrong link.** Every stage is a precision instrument. When candidates disagree about identity, the algorithm rejects rather than guesses.

## Query construction (before the cascade runs)

The candidate pool comes from search queries. Queries are cheap recall; the gate below is the precision mechanism.

The algorithm is **uniform across all studios** - no per-studio branches. Studios differ only in query configuration (which extra queries a studio's watchlist adds) and in source-pool coverage, never in the cascade or the gate.

- Up to 2 normalised performer names. **Single-token performer names MUST generate queries too** - the earlier >=2-token rule produced zero queries for "Beauty Saves Marriage W..." (performer "Geishakyd") and silently skipped the scene; it sits on sxyprn at 1s off (two uploads, 2504s vs TPDB 2503s).
- The studio name as an additional query. Measured rescue: the `tushy` query surfaced the Geishakyd scene above. Studio in the QUERY list is cheap recall. (Studio in the GATE is falsified - see stage 4.) **Exception:** studios flagged `creator_studio: true` on their studio record (seed: Maximo Garcia - creator content surfaces on tubes under performer aliases, studio-name queries return noise) build performer-only queries; no studio-name query is generated. Flag lives on the studio record, checked at query-build time - not a cascade branch.
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
- **Fresh-item retest, Chris's exact spec (2026-09-25 PM).** Duration ±30s AND upload within release ±7d, NO title/performer/studio criteria, the 10 most recent catalogue scenes (8 runnable, 2 lack TPDB durations). Sxyprn: 5/8 items matched, 16 claimed hits, manual review 13 true / 3 false (~81% precision - Maya Bell would have linked a Yasmina Khan scene; Marfe a "Badgirl Sandra" scene). Eporner: 0/8 from query pools; against an unbiased latest-600 pool all 8 items "matched" but 42/44 were wrong scenes (~2-5% precision). Conclusions: for FRESH items the ±7d window costs no true matches (uploads land same-day; no contradiction with the 0/19 tail result - repost lag hits the July/Aug catalogue, not release-week items); and duration+date WITHOUT identity verification produces false links at 19% (sxyprn) to ~97% (eporner) rates - confirming stage 3 must remain the gate.

### Stage 3 - performer OR verbatim title (the match condition)

Accept when: every token of a performer name is present in the normalised candidate title (any performer, any token count), OR the candidate title contains the normalised scene title verbatim. Measured precision ~100% on both tubes (eporner 7/7 Tushy spot-checked true; sxyprn 13/13 second-pass spot-checked true; the 15 Lancelot collisions all correctly rejected). Uploader retitling is why title SIMILARITY is not required; token presence is.

### Stage 4 - studio in title - MEASURED, rejected

Chris's proposed stage 4, measured with the exact variant (duration +-2s AND (performer OR verbatim OR studio-in-title)):

- eporner + xvideos: gains 13 scenes, **all 13 verified wrong** - "Legendary Alinas First A..." matched a Maddie Wren upload; the Lancelot gains are the known 15-collision set (Cheyla Collins upload matched to an Emy Rous scene, etc.); xvideos' gain is two Tushy compilations.
- sxyprn Tushy slice: zero studio-only gains (the 8 matched scenes all carry performer/verbatim evidence anyway).
- Mechanism: same-studio scenes cluster at near-identical durations and repost titles almost always carry the studio tag, so studio-only matches are pure noise.
- **Verdict: rejected as a match condition. Studio stays query-only** (query construction above), where it measured as a recall win.


## Trusted-uploader pools (eporner, measured 2026-09-25)

Some high-volume uploaders consistently carry a studio's releases but title them in an
obfuscated convention that open search cannot match. Proof case (Chris, 2026-09-25): eporner
profile **Vovick17** (1,589 uploads). Crawled the newest ~320 uploads (profile pages reach
back to April): **18/46 (39%) of the last month's Mambo Perv + Lancelot Styles Evolution
scenes are present**, every one within +-2s of the TPDB duration (17 of 18 exact or 1s off),
every one titled like `LLW - LanaWills 924` / `Little Latina W... MAYA922` - unicode-bold
(NFKC-foldable), FIRST-NAME-only, with a trailing MMDD code equal to the scene's release
date. These uploads are invisible to the open-search gate: first-name-only titles fail the
every-token performer check, and tag search is ruled out. The uploader profile is the
retrieval path.

The rule:

1. **Trust is bespoke.** Chris hand-lists trusted uploaders; no auto-promotion counting, no
   verification thresholds, no decay machinery. The list is data, not code - a named account
   goes in, a named account comes out. Seed list (Chris, 2026-09-25): **Vovick17**,
   **KJUIUI**, **Rafael12021988**, **wmrt0s**.
2. **Pool construction.** Profile pages newest-first, no search queries at all - this
   sidesteps tag search and title-mangling entirely. Depth: until uploads predate the oldest
   unmatched scene for the studio.
3. **Pool-scoped gate (ONLY inside trusted pools).** NFKC unicode fold, strip decorative
   symbols; duration +-2s unchanged; identity = any performer token OR a FIRST-NAME-only
   token; and when the title carries a trailing MMDD code it MUST equal the scene release
   date +-1 day. First-name acceptance stays forbidden on open search.
4. **Measured on the Vovick17 pool:** 18 true accepts, 0 false accepts across the 46-scene
   last-month test set. The duration gate alone would have admitted wrong-scene collisions
   (the 3102s Cherry Kiss scene sits 2s from the 3100s LanaWills upload); the name/code
   requirement rejects every one.

Caveat against over-trusting the uploader: coverage is partial, not "almost all" - 28/46
last-month scenes are absent (whole performers missing: Margo Ferreira, Line Heat, Bibi,
Megan Noir, Andrea Frank, Ellie Nova; same-day releases not yet up). Uploader pools supplement
open search; they do not replace it.

Seed-pool notes (census of 6,964 most-recent matching uploads, 2026-09-25): **KJUIUI** (17 uploads
in 2 weeks, 2.4M views) carries the same Lancelot/Mambo scenes but keeps full performer names
in Lancelot's house-style titles - the open-search name gate works on him where Vovick's
retitles need the pool gate. **wmrt0s** (18 uploads) carried the Tushy "STACY CRYSTAL No More
Fires" uploads (verified true matches). **Rafael12021988** (45 uploads, 6.7M views) is a
general tube reposter who carries TUSHY content among much else - trust with the same gates,
not as a coverage guarantee.

## Tiebreak: picking among multiple accepted candidates

When stages 1+3 accept more than one candidate (duplicate rips are routine - "Perfect H... Wants A..." has 5 in-window sxyprn uploads):

1. **Dedupe by title stem.** Normalise title, strip repost decorations (`{NEW}`, `{Watch/Download:}` URLs, trailing hashtag blocks, dates); candidates sharing a stem are one logical upload - keep the best by the ranking below.
2. **Rank:** exact-duration closeness first, then upload date closest to release date (where the field exists), then views, then oldest.
3. **Distinct-identity disagreement = reject.** If surviving candidates have genuinely different identities (different title stems AND different uploaders - i.e. possibly different scenes), do not force a pick. No link beats a wrong link.

## Corpus-scale measurement (2026-09-25, evening)

Last 2 weeks of ALL watchlist scenes (36: Lancelot 21, Maximo 8, Mambo 5, Tushy 2; 29
runnable - 7 Maximo scenes lack TPDB durations) against the whole reachable eporner corpus
(15,000 latest uploads + studio pools + trusted pools = 15,546 rows), every accept manually
FP-reviewed:

| rule | scenes | accepts | true | false | precision |
|---|---|---|---|---|---|
| dur +-2s AND (name OR date +-1w) | 12/29 | 244 | 15 | 229 | 6% |
| dur +-2s AND (name OR MMDD code) [this spec] | 13/29 | 16 | 16 | 0 | 100% |
| + first-name inside trusted pools only | 14/29 | 18 | 18 | 0 | 100% |
| dur +-2s AND (name OR code OR studio OR date+-1w) | 14/29 | 249 | 17 | 232 | 7% |
| same at +-5s / +-30s | 14/29 | 505 / 2878 | 18 / 18 | 487 / 2860 | 4% / 1% |

Disjunct autopsy (+-30s, 4,894 candidates): date+-1w fires 2,842 times, ZERO unique true
accepts; studio-in-title fires 92 times, zero unique true. Widening Z adds 1 true for 2,600
extra false. The disjunction buys no recall, only false positives.

Same 29 scenes on sxyprn (query-built candidate pools, titles carry performer + studio):
26/29 scenes, 84/84 accepts true at +-2s (100%); the generalized disjunction costs 1 FP
(99%) and the date disjunct literally had zero candidates to admit. Union of both tubes:
27/29 (93%); eporner's unique contribution is 1 scene.

Duration + date ALONE inside the trusted pool (no name/code): 26% precision at +-2s (11
true, 31 false - pool-internal duration collisions), best 62% at release+-1d while losing
half the true scenes. Even inside a trusted pool, name-or-code stays a hard requirement.

Maximo Garcia: no eporner carrier exists (zero watchlist scenes in 15k corpus + 7k listing;
only one old Lana Roy clip reposted 4x). On sxyprn, Maximo scenes surface under the FEMALE
performer's alias filed as studio "Onlyfans" (e.g. "Marfe okkk"). For creator studios the
performer alias is the load-bearing signal; tube studio labels are unreliable. 7/8 recent
Maximo scenes also lack TPDB durations - see the duration-less fallback below.

## Duration-less scenes (the Maximo problem)

Some scenes reach the watchlist with no duration on TPDB (7/8 recent Maximo Garcia scenes).
Fallback path, in order:

1. **Enrich at the source.** The watchlist's release URL (the studio's own page) carries the
   real duration even when TPDB lacks it; scrape it per unmatched scene, then run the normal
   cascade. Duration enrichment is cheaper and safer than any duration-less gate.
2. **Creator-studio retrieval.** Creator content (Maximo etc.) surfaces on the tubes under the
   performer's alias with studio label "Onlyfans" - query the alias, never the tube studio
   label. Chris-confirmed pattern, 2026-09-25.
3. **No duration-less admission.** Chris ruling 2026-09-25: no manual review in the end UX.
   Without a duration there is no auto-grade identity separator (alias queries return the
   performer's whole catalog - measured 8/8 wrong-scene for Lola Bratz), so duration-less
   candidates are dropped, not queued. The scene stays unmatched and is retried silently on
   later passes as pools and enrichment improve. Duration enrichment for these scenes is
   owned end-to-end by the studio-site scraper spec (studio-site provenance) - the cascade
   only matches, it never writes metadata.

## Non-goals / falsified stages (do not re-add)

- Date +-1 week (or any date window) as an admission disjunct: 2,842 fires, 0 unique true accepts - pure firehose.
- Duration + date alone, even inside trusted pools: 26-65% precision across all windows.

- Thumbnail similarity, all variants (dHash, colour histogram, average colour): no identity signal. Measured on both tubes.
- Upload-date window as a match condition: 0/19 sensitivity on the catalogue tail; ~19-97% false-positive rate without identity checks on fresh items.
- Studio-in-title as a match condition: 13/13 false positives.
- Tag-based candidate search on any tube (tags optional and poorly applied; eporner worst). Pools come from name/code/title full-text queries only.

## Negative tests (must not match)

- "Shy Pale Skin White Brazilian, Margo Ferreira" (1850s) must NOT match "La Paisita Oficial ..." (wrong performer at the right duration).
- The 15 eporner Lancelot duration-window rows (e.g. "Megan Petite's Return Vs Lancelot" at 2632s) must NOT match the Ashley Vixen / Cindy Lore / Desire Adams scenes at 2630/2441s.
- "Legendary Alinas First A..." must NOT match "Tushy 26 09 06 maddie wren perfect h..." (same studio, in-window, wrong performer - this is the studio-OR trap).
- Duration off by 3s: no match even with performer present.
- "Beauty Saves Marriage W..." (2503s, performer "Geishakyd") MUST match the 2504s sxyprn uploads - regression test for single-token performer queries.
- Trusted-pool disambiguation: "Maya Bell 2115s" MUST match `MAYA922` (2115s) and MUST NOT match `MAYA922 2` (2555s) - same uploader, same name, same date code; duration is the only separator.
- Trusted-pool collision: the 3102s Cherry Kiss scene MUST NOT match the 3100s `LLW - LanaWills 924` upload (2s apart, wrong performer, wrong date code).
- From the 2026-09-25 fresh-item test: "Maya Bell, 20Y Beautiful Brazilian First D..." (2115s) must NOT match the in-window Yasmina Khan upload; "Petite Argentinian A... Demolished" (1418s) must NOT match the in-window "Badgirl Sandra" upload. Both land inside duration+date with no other check - stage 3 is what rejects them.
