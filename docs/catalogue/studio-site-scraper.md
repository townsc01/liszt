# Studio-site metadata scraper (draft spec, Chris 2026-09-25)

## Principle

TPDB is a cache, not the source of truth. When TPDB lacks a field, scrape the studio's own
site - Chris: "scraping the actual studio site for missing metadata, rather than just polling
the TPDB api." The watchlist already stores each scene's release URL; use it.

## What the studio pages carry

Measured 2026-09-25: sexlikereal scene pages embed ISO-8601 durations
(`"duration":"PT1H21M42S"`) in page metadata; analvids scene pages carry duration, release
date, and performer lists. A watchlist release URL that resolves yields the missing duration
directly. (One sampled SLR URL 404'd - freshness of the stored release URL must be verified
before trusting a miss.)

## Design

1. **Trigger.** ANY TPDB entry arriving with incomplete metadata (missing duration first;
   missing release date or performers count too) triggers a source-site scrape immediately -
   event-driven on the TPDB poll result, not a batch job and not lazy at match time. New
   ingest and re-polls of existing scenes both fire it.
2. **Second trigger: the no-match case (Chris 2026-09-25).** TPDB can carry a performer alias
   that differs from the studio's own naming, and the tube reposts follow the STUDIO's
   branding - so a scene can fail retrieval purely on a name mismatch. When a scene completes
   a matching pass with ZERO matches, fire a source-site scrape to align the search data
   points: pull the studio's canonical performer naming (and any other stale fields), update
   the scene record, and re-run retrieval with the corrected names on the next pass. The
   no-match scrape fires at most once per scene per naming version - a scene that stays
   unmatched after alignment is genuinely absent from the tubes, not retried forever.

3. **Fetch.** GET the stored release URL with a normal UA. Parse JSON-LD / meta tags first
   (cheap, stable); fall back to a per-host extractor only where metadata is absent.
4. **Per-host extractors.** Small, data-driven: host -> CSS/regex recipe, kept in one table so
   adding a studio is a row, not code. First rows: sexlikereal.com (JSON-LD duration),
   analvids.com (duration + performers).
5. **Write-back.** Enriched fields update the scene record with provenance `studio-site` so
   later TPDB backfills can be compared, not blindly overwritten.
6. **Failure handling.** 404/dead URL or no extractable field: mark the scene
   metadata-poor and let the matching cascade treat it as duration-less (unmatched until a
   later pass). No manual review - per Chris, nothing queues for a human.

## Creator studios need no alias map (supersedes the Onlyfans-alias branch, PR #44)

Chris asked 2026-09-25 whether the studio-alias map is still needed once scraped metadata
exists. Measured answer: no. Retrieval for creator content runs on PERFORMER-name queries,
and TPDB's performer names for creator scenes ARE the tube aliases ("Marfe okkk" found its
scene 2/2 on sxyprn; token normalization absorbs "Marfe.Ok" vs "Marfe okkk"). The tube's
"Onlyfans" studio label never enters the pipeline - studio-in-title was already falsified as
a match signal (13/13 FP) and retrieval never queries the tube studio bucket. Once the
duration is enriched, the normal cascade admits (Marfe, 1418s exact) or rejects the
performer-catalog noise (Lola Bratz 8/8 wrong-scene) unchanged. The only creator-studio
adjustment left: skip the studio-name query for mapped creator studios (it returns noise).
Concretely: `creator_studio: true` on the studio record (seed: Maximo Garcia) - a flag, not
a mapping table. The matching cascade's query construction (#40) checks the flag and builds
performer-only queries when set. Coverage floor stands: scenes not
uploaded under any performer alias stay unmatched - retrieval failure, not gate failure.

## Measured basis

- 7/8 recent Maximo Garcia scenes lack TPDB durations; SLR/analvids release URLs exist for all
  of them in the watchlist.
- Maximo scenes that did match (Marfe Okkk, 1418s) matched exactly because a duration was
  known - enrichment converts the whole class into normal-cascade scenes.
