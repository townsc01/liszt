# Liszt

> **Content note:** personal adult-content catalogue project - specs and fixtures contain adult titles.

**[Roadmap](https://github.com/townsc01/liszt/milestones)** (milestones - status + build order) - **[ROADMAP.md](ROADMAP.md)** (the map, linked).

Liszt is a personal hobby project for keeping a rolling 90-day watchlist of scenes released by selected studios. The aim is a useful, reasonably complete, accurate, regularly updated list showing each scene's studio, title, release date, performers, thumbnail, and link to its release page.

## Specs

Feature specs live in `docs/specs/`; each names its prerequisites in its `Depends on` header. **Build order and status live in [GitHub milestones](https://github.com/townsc01/liszt/milestones)** (API-readable: `/repos/townsc01/liszt/milestones`) - not in this file.

[Playback link sources](docs/specs/link-sources.md) - [Studio-site metadata scraper](docs/specs/studio-site-scraper.md) - [Matching algorithm](docs/specs/matching-algorithm.md) - [Sxyprn embed](docs/specs/sxyprn-embed.md) - [Eporner embed](docs/specs/eporner-embed.md) - [FC2 lane](docs/specs/fc2-anal-uncensored.md) - [Madouqu lane (metadata-only)](docs/specs/madouqu-mainland-taiwan-anal.md)

## Sources and adapters

Each studio has one configured source of release information. The source and extraction method can differ by studio: a studio website, primary storefront, third-party API such as TPDB, or another suitable source. Source URLs and record details are kept for debugging and traceability. The current code uses TPDB for **Lancelot Styles Evolution**, **Mambo Perv**, **Tushy**, and **Maximo Garcia** (restricted to scenes with female performers), and **Bang! Originals**' configured listing with linked video metadata. These adapters are registered in `src/studios/index.js`.

The current adapter contract is a module in `src/studios/` registered in `src/studios/index.js`:

```js
{
  id: "stable-studio-slug",
  name: "Display name",
  authority: { name: "Source name", url: "https://…", role: "Catalogue source" },
  fetchScenes: async ({ now, days, fetchImpl }) => ({ scenes, verifiedEmpty })
}
```

The field is currently named `authority` in code; it identifies the configured source and does not require the studio's own website. Scene records include `sourceSceneId`, `title`, `releaseDate`, `performers`, `thumbnailUrl`, `releaseUrl`, `source`, and `provenance`. The latter records the source name, catalogue URL, record URL, and source scene ID. Validation requires a source scene ID, date, and title, and normalisation assigns `<studio id>:<source scene id>` as the stable scene ID. The sync keeps only releases in the rolling 90-day window.

An adapter returning no scenes must set `verifiedEmpty: true` after checking that the source really has no matching records. An unexpected empty extraction is treated as a failure. Each studio refresh runs independently: if one fails, its last-good records within the 90-day window remain available, with an error and the last successful refresh time, while other studios can update.

The TPDB adapters resolve each matching site record, then call `/scenes` with its site ID and the 90-day cutoff. They send `TPDB_API_KEY` as a Bearer token and follow paginated results. Keep this key in the server environment; it is never sent to the browser or written into catalogue data. As with the other adapters, the shared sync retains only the rolling 90-day window and preserves last-good records on a failed refresh.

When a TPDB record is missing duration, release date, or performers, Liszt immediately fetches its stored studio release URL. Structured JSON-LD and meta tags are preferred, with small host recipes for SexLikeReal and AnalVids as fallbacks. Enriched fields retain `studio-site` provenance; dead or unparseable pages are marked metadata-poor. A recent scene that completes Sxyprn matching with no results is scraped once per performer-naming version so the next matching pass can use the studio's canonical names. Creator studios, currently Maximo Garcia, use performer-only retrieval queries instead of noisy studio-name queries.

To add another studio, implement and register an adapter for its chosen source, add representative fixtures and parsing tests, then run `npm test` and `npm run sync`. Inspect `data/catalogue.json` and the studio's refresh status. A source shared by several studios could instead be implemented as a reusable adapter.

## Run and deploy

Use Node.js 20.18.1 or newer:

```sh
npm ci
npm test
npm run sync
npm start
```

Open <http://localhost:10000>. `npm run sync` writes `data/catalogue.json`; `LISZT_DATA_PATH` overrides that path, and `PORT` overrides the server port. Deploy the Node server on Render using the same start command. The server serves the dashboard and `GET /api/scenes`; `POST /api/refresh` runs the registered adapters and returns the updated catalogue. The dashboard has a searchable, sortable release ledger, a studio filter, source status, scene links, and a **Refresh data** button. Concurrent refresh requests share one sync.

The **Sources** dialog is a per-studio health view drawn from data the API already serves: sync status (ok / failing / not configured) with the error text, last successful refresh, scene count, and match rate (the share of that studio's scenes with a live playback link, computed client-side). Failure classes are shown separately: a missing or invalid credential (for example `TPDB_API_KEY is not configured`) is deploy configuration, not a source outage, and says so. The watchlist no longer carries per-studio error banners; it shows at most one compact pointer such as "1 source failing - see Sources", and the full error text lives in Sources.

The server also syncs once on boot, in the background: the port binds first and serves the bundled catalogue immediately, and the sync runs behind it so a waking instance heals its own data instead of waiting for a visitor to click Refresh. A boot sync and a refresh click share the same in-flight guard, so only one sync runs at a time. Failure is inherited from the refresh path: an adapter that fails records its own per-studio error while the other studios still update, and a top-level `syncCatalogue()` rejection (for example an unreadable store) logs the failure and keeps the retained catalogue and existing status untouched. Either way the server stays up and enrichment still runs over the retained scenes. This boot-only cadence is the prototype behaviour; a periodic 6-hour sync is planned for permanent hosting.

Fetching is server-side. The [watchlist mockups](docs/mockups/watchlist.html) are illustrative and contain no live scene data.

## Playback links

Liszt resolves playback against Sxyprn first and Eporner second. Verified links use the source-neutral `videoUrls` list; each entry records its source, watch URL, optional embed URL, and verification time. Sxyprn uses title matching first, then the same duration-and-identity gate as Eporner. Eporner is queried only for duration-bearing scenes that Sxyprn missed, with one cached studio-keyword pool per run. An unchanged scene is checked at most once per day. Automatic Sxyprn checks cover releases from the past 14 days; older verified links remain visible. `npm run backfill:sxyprn` performs a one-time check across the full 90-day catalogue. User-confirmed Sxyprn matches with opaque titles can be placed in `src/sxyprn-overrides.js`.

The dashboard's **Refresh data** action updates studio records first, then starts playback matching in the server process. Matching saves the batch after it finishes and never removes a studio record when a video source is unavailable. A linked thumbnail opens Liszt's watch page. Sxyprn stream URLs are bound to the requesting IP, so the server caches the short-lived URL and proxies range requests to the HTML video element. Eporner links use the API-provided iframe embed directly. The page retains a direct source link if playback fails.

### Link lifecycle: dead-link re-verify

Every enrichment pass re-verifies the 25 stalest stored links (oldest `verifiedAt` first), so the ~97-link catalogue rotates about every four syncs. Sxyprn links are checked by fetching the watch page; Eporner links by the API's `video/id` lookup. Only definitive non-existence counts as a strike - an sxyprn 404/410 or an eporner lookup that finds no record. Timeouts, 403 anti-bot walls, 5xx responses and network errors are inconclusive: the link is left untouched and retried next cycle. After two consecutive definitive failures the link moves out of `videoUrls` into `deadVideoUrls` (each entry keeps `verifiedAt` plus `deadAt` and `deadReason`), so `videoUrls` stays live-links-only and the UI needs no change. A successful verify resets the strike count and refreshes `verifiedAt`. When a scene's last live link dies, `videoCheckedAt` is cleared so the scene re-enters normal resolution on the next pass. Re-verify runs through the same bounded fetch pool as the rest of the sync - no new fan-out.

The existing `liszt` Render service remains a single Node web service. Its build runs `npm ci`; `npm start` runs only Liszt. The optional `Dockerfile` packages the same app. The local catalogue is bundled with the deployment. Updates written by Refresh data are lost on a fresh deploy or instance restart unless `LISZT_DATA_PATH` points to persistent storage.

## Possible next steps

A future dashboard flow could accept a studio name or website URL and add it to the watchlist. Studios with unusual sources may still need dedicated adapters. Studio discovery, browser-based ingestion, and checks for scenes already on disk are not implemented on the current branch.
