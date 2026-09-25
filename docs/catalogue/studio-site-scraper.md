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

1. **Trigger.** A watchlist scene missing duration (or any match-critical field) after a TPDB
   poll gets a studio-site scrape, once, at ingest time - not lazily at match time.
2. **Fetch.** GET the stored release URL with a normal UA. Parse JSON-LD / meta tags first
   (cheap, stable); fall back to a per-host extractor only where metadata is absent.
3. **Per-host extractors.** Small, data-driven: host -> CSS/regex recipe, kept in one table so
   adding a studio is a row, not code. First rows: sexlikereal.com (JSON-LD duration),
   analvids.com (duration + performers).
4. **Write-back.** Enriched fields update the scene record with provenance `studio-site` so
   later TPDB backfills can be compared, not blindly overwritten.
5. **Failure handling.** 404/dead URL or no extractable field: mark the scene
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
adjustment left: skip the studio-name query for mapped creator studios (it returns noise);
that is a flag on the studio record, not a mapping table. Coverage floor stands: scenes not
uploaded under any performer alias stay unmatched - retrieval failure, not gate failure.

## Measured basis

- 7/8 recent Maximo Garcia scenes lack TPDB durations; SLR/analvids release URLs exist for all
  of them in the watchlist.
- Maximo scenes that did match (Marfe Okkk, 1418s) matched exactly because a duration was
  known - enrichment converts the whole class into normal-cascade scenes.
