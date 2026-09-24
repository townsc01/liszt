# Liszt

Liszt is a personal hobby project for keeping a rolling 90-day watchlist of scenes released by selected studios. The aim is a useful, reasonably complete, accurate, regularly updated list showing each scene's studio, title, release date, performers, thumbnail, and link to its release page.

## Sources and adapters

Each studio has one configured source of release information. The source and extraction method can differ by studio: a studio website, primary storefront, third-party API such as TPDB, or another suitable source. Source URLs and record details are kept for debugging and traceability. The current code uses TPDB for **Lancelot Styles Evolution**, **Mambo Perv**, **Tushy**, and **Maximo Garcia** (restricted to scenes with female performers), and Bang! Originals' anal-filtered listing with linked video metadata for **Bang! Originals**. These adapters are registered in `src/studios/index.js`.

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

To add another studio, implement and register an adapter for its chosen source, add representative fixtures and parsing tests, then run `npm test` and `npm run sync`. Inspect `data/catalogue.json` and the studio's refresh status. A source shared by several studios could instead be implemented as a reusable adapter.

## Run and deploy

Use Node.js 20 or newer. Initialise the pinned Lustpress submodule before installing dependencies:

```sh
git submodule update --init --recursive
npm install
npm test
npm run sync
npm start
```

Open <http://localhost:10000>. `npm run sync` writes `data/catalogue.json`; `LISZT_DATA_PATH` overrides that path, and `PORT` overrides the server port. Deploy the Node server on Render using the same start command. The server serves the dashboard and `GET /api/scenes`; `POST /api/refresh` runs the registered adapters and returns the updated catalogue. The dashboard has a searchable, sortable release ledger, a studio filter, source status, scene links, and a **Refresh data** button. Concurrent refresh requests share one sync.

Fetching is server-side. The [watchlist mockups](docs/mockups/watchlist.html) are illustrative and contain no live scene data.

## Eporner links with Lustpress

Lustpress is pinned as a Git submodule at `vendor/lustpress`. Run `git submodule update --init --recursive` after cloning Liszt. To update it deliberately, run `git -C vendor/lustpress fetch origin`, check the upstream changes, check out the chosen commit inside the submodule, then commit Liszt's changed submodule pointer. Lustpress requires Bun 1.4.2 or newer.

`npm start` runs Liszt and the bundled Lustpress together, setting `LUSTPRESS_URL` to `http://127.0.0.1:3001` for Liszt. Set `LUSTPRESS_URL` yourself before standalone `npm run sync`; without it, automatic Eporner enrichment is disabled. The public Lustpress API was discontinued, so a self-hosted instance is required. `npm run sync` searches Eporner's official video API by performer name and distinctive title words, then asks Lustpress to verify promising video pages. Lustpress's own Eporner search endpoint reads tag pages, so it is not used for scene discovery. Browser clients never call either API. A scene gets an `epornerUrls` array only when the Eporner title closely matches the release title, a named performer appears in Eporner's title or keywords, and the result is unambiguous. For this prototype, Eporner matching runs only for releases from the past 14 days, and results are checked at most once per day for unchanged scenes. Older catalogue rows retain their source links without Eporner links. The final product is intended to link the full catalogue; that will require persistent enrichment state and a separate bounded processing strategy. Unverified scenes keep their source link without an Eporner link. Search or Lustpress outages cannot discard a studio's catalogue.

For user-confirmed matches with translated or opaque Eporner titles, add the scene ID and direct URLs to `src/eporner-overrides.js`. The Naty Heat debut has two such uploads, identified by ThePornDB scene 11569889 and the current AnalVids scene 4683299; both links are shown. Do not infer these associations from a performer name or matching duration alone.

The existing `liszt` Render service remains a single Node web service. Its `yarn` build installs pinned Bun and builds Lustpress from the pinned Git submodule; `yarn start` runs both processes, with only Liszt on Render's public port. The optional `Dockerfile` packages the same two apps if a container runtime is preferred later. Render clones public Git submodules during builds. The local catalogue is bundled with the deployment; updates written by Refresh data are lost on a fresh deploy or instance restart unless `LISZT_DATA_PATH` points to persistent storage.

## Possible next steps

A future dashboard flow could accept a studio name or website URL and add it to the watchlist. Studios with unusual sources may still need dedicated adapters. Studio discovery, browser-based ingestion, and checks for scenes already on disk are not implemented on the current branch.
