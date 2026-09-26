# Load: #113 — FC2 lane adapter + two-tier sync

- **Issue:** #113 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §4, §7.
- **Wave:** 3. **Depends on:** #103 and #104 merged, #112 merged.
- **Branch:** `fc2-113-adapter-sync`
- **Owns:** `src/studios/fc2.js` (new), `src/studios/index.js`, `src/sync.js`, `scripts/backfill-fc2.mjs`, `package.json`, `test/fc2-adapter.test.js`

**This is the join point and the only load that makes FC2 run in production.** The
registration is one line, so merging this ahead of #104 admits the unfiltered union
crawl to the real catalogue. Do not merge before #104 is on `main`.

## Task 1 — the adapter

`src/studios/fc2.js`, implementing the existing contract enforced at `src/sync.js:41-43`
(`id`, `name`, `authority.{name,url,role}`, `fetchScenes`). Model it on
`src/studios/madouqu.js` — the newest lane, and the one with the right shape (per-label
studio identity, a pacing fetcher, retention on throw).

`fetchScenes({ now, days, fetchImpl })` returns `{ scenes, verifiedEmpty }`. Compose it
from #103's crawler and #104's filter. **Register with `matcher: null` in this load** —
the issue explicitly allows this, and it decouples the adapter from the matcher
semantics. #107 flips it on.

Field mapping per §4:

| Liszt field | Source | Notes |
| --- | --- | --- |
| `id` | `fc2:<video_id>` | Stamped by the shared normaliser |
| `sourceSceneId` | `video_id` as a string | The PPV number. **Identity, always** |
| `title` | English when translated, else Japanese | §5; #106 owns the translation |
| `originalTitle` | Japanese verbatim | Canonical. Never overwritten |
| `releaseDate` | `release_date` | JST calendar date, `YYYY-MM-DD` — `withinRollingWindow` parses `${releaseDate}T00:00:00Z` |
| `performers` | `[]` | No reliable performer data. **Do not guess from titles** |
| `durationSec` | listing `duration` | See the warning below — this is load-bearing |
| `thumbnailUrl` | `image_url` | FC2 CDN |
| `releaseUrl` | `https://fc2cmadb.com/articles/<video_id>` | The database record, not the FC2 store page |
| `source` / `provenance` | FC2CMADB + listing URL + record URL + video_id | Per the existing shape |
| `seller` | `writer.name` (+ `writer.slug`) | FC2 is a marketplace; the seller is the studio |
| `tags` | English-mapped + original Japanese | §5. Unknown tags pass through in Japanese |
| `censorship` | `無` | Kept for debugging; always 無 post-filter |

**`durationSec` is not optional.** `src/matching.js:90` returns `null` for any scene
without a finite positive duration, so omitting it silently makes every FC2 scene
unmatchable and #107 will ship with a zero-hit rate that looks like a data problem.

Do not create one adapter per seller — thousands exist. One adapter, seller on the record
(#105 turns that into the UI).

## Task 2 — the two-tier sync (§7)

1. **Listing poll (cheap).** Walk the union listings newest-first until reaching a
   `video_id` already in the store, plus one page of overlap. Usually 1-2 pages.
2. **Detail fetch (expensive, budgeted).** For each new or pending `video_id`, fetch the
   detail page at one per 8-9 seconds. `FC2_DETAIL_BUDGET`, default 60 fetches
   (~9 minutes). The remainder stays queued for the next run.
   - **On HTTP 429: stop the tier immediately**, mark the lane errored, back off 60
     minutes. A 429 costs a 30-60 minute site-wide ban — this path is not advisory.
   - Badge null → stay in the pending queue, re-check for up to 7 days from first seen,
     then drop.
   - `not_found` / `status` set → mark the scene removed in the store. **Do not delete**;
     the watchlist should show it went away.
3. **Change detection.** Keyed on `video_id`. If the title changed, update
   `originalTitle` and invalidate the cached translation and any code-matched video link
   (the PPV code never changes, so links stay stable).
4. **Contract semantics.** `verifiedEmpty: true` only when the listing genuinely has no
   new items **and** the pending queue is empty. On any fetch failure, throw so sync
   keeps last-good scenes per the existing retention behaviour.

### Pending-queue persistence — decision already made

Persist the queue (video_id + first-seen date) as a **top-level lane-state key in
`data/catalogue.json`**, added where the catalogue object is built (`src/sync.js:75`).
Not a new file: the spec says "in the catalogue file", `src/reverify.js` and
`src/translate-run.js` both write `{ ...catalogue }` so the key survives, and
`.github/workflows/catalogue-refresh.yml` commits `catalogue.json` every 6 hours. A
separate file would live only on Render's ephemeral disk and lose the queue on restart.

State this decision in a comment on the issue so #108 and review can see it was chosen,
not overlooked.

## Task 3 — the backfill script

`scripts/backfill-fc2.mjs`, modelled on `scripts/backfill-madouqu.mjs`: re-import the
adapter's named exports rather than calling `adapter.fetchScenes`, drive the walk with a
page cap from an env var, normalise through `validateResult` so a backfilled scene is
identical to a synced one, then merge while replacing only this lane's studios and
scenes. Add a `backfill:fc2` script entry to `package.json`.

It mirrors the 2026-09-24 manual run: walk all 297 listing pages and queue every unknown
`video_id`. **Document that a full backfill takes roughly 20 hours at the safe rate.** It
is a manual, out-of-band operation — never a CI step, never slung in parallel with
another load that touches the same live site.

## Tests — `test/fc2-adapter.test.js`

Fixture-driven, injected `fetchImpl`, no network. Follow the temp-catalogue pattern in
`test/madouqu.test.js` (`mkdtemp` + `sync({ paths: [path], adapters: [adapter] })`):

- `validateResult` identity: `fc2:<video_id>`, the per-seller `studioId`/`studio`
  override the adapter identity, `videoMatching: false` while `matcher: null`.
- tier 1 stops at the known `video_id` plus one overlap page.
- the detail budget cuts off and leaves the remainder queued; the queue survives a
  restart read from the catalogue file.
- 429 stops the tier and marks the lane errored.
- badge-null stays pending, promotes on re-check, drops after 7 days.
- `not_found` marks the scene removed rather than deleting the row.
- a failed refresh keeps last-good scenes (retention).
- change detection updates `originalTitle` and invalidates the cached translation.

## Before you merge — verify the sync budget

`src/sync.js:40` fans every adapter out in one `Promise.all` with **no per-adapter
timeout**. A default budget of 60 detail fetches at 8-9 seconds each is ~9 minutes of
FC2 work inside the shared sync, and the enrichment pass at `src/sync.js:74` runs after
it. Either lower the default budget or confirm the 6-hourly cron and the Render timeout
tolerate it. Record the choice and its evidence in the PR body.

## Acceptance

- `npm test` green.
- `src/studios/index.js` registration present; the lane appears in the running app.
- PR body: `Part of #64`, agent + model, the queue-persistence decision, the sync-budget
  evidence, and what you verified.
