# Creator studios and the "Onlyfans" alias bucket (low priority)

Status: draft spec, Chris 2026-09-25. Separate from the main matching cascade; do not block #40 on this.

## Problem

Creator content (Maximo Garcia is the observed case) does not surface on the tubes under its
TPDB studio name. On sxyprn it appears under the performer's alias with studio label
"Onlyfans" - an alias bucket, not a real studio. Tube studio labels are therefore unreliable
for creator studios; the performer alias is the load-bearing signal. Measured 2026-09-25:
6,964-video eporner census has zero Maximo watchlist scenes; sxyprn carries them under female
performer aliases (e.g. "Marfe okkk - Petite Argentinian Anal Demolished By A Huge Cock!").

Creator scenes also frequently lack TPDB durations (7/8 recent Maximo scenes), which disables
the duration gate entirely.

## Mechanism: manual studio-alias map (Chris's solution)

Chris hand-identifies which TPDB studios are creator studios whose tube presence lives under
the "Onlyfans" bucket. The map is data, not code - same bespoke-list principle as trusted
uploaders:

```json
{
  "Maximo Garcia": { "tube_studio_labels": ["Onlyfans"], "notes": "surfaces under female performer alias" }
}
```

For a studio in the map:

1. **Retrieval** queries performer aliases, never the TPDB studio name and never the tube
   studio label.
2. **Duration enrichment first.** When TPDB lacks a duration, scrape it from the studio's own
   release page (watchlist release URL; sexlikereal/analvids pages embed ISO-8601 durations)
   or backfill it from a matched tube card. Then the normal cascade (#40) runs unchanged.
3. **Duration-less admission does not exist.** Chris ruling 2026-09-25: no manual review in
   the end UX. A scene either matches on auto-link-grade signals (duration gate + name/code)
   or stays unmatched and is retried silently on later passes as pools, aliases, and
   enrichment improve. Measured basis: alias queries return the performer's whole catalog
   (8/8 name-bearing but wrong scenes for Lola Bratz and Medusa) - without a duration there
   is no auto-grade identity separator, so duration-less candidates are dropped, not queued.
   This makes duration enrichment (step 2) the whole game for creator studios.
4. **Coverage expectation is low.** 3/6 tested Maximo aliases returned zero name-bearing
   sxyprn cards - many creator scenes are simply not on the tubes. Absence is the normal
   outcome, not a pipeline bug.
