# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. Each studio's own website is the authoritative catalogue. When a studio's primary storefront is hosted on another site, that storefront is used as the studio website; this currently applies to Lancelot Styles Evolution and Mambo Perv, whose primary storefronts are on AnalVids.

The [Lancelot Styles Evolution listing on AnalVids](https://www.analvids.com/studios/lancelotstylesevolution) and its linked scene pages are authoritative because AnalVids is the studio's primary storefront. Liszt reads release information from that storefront as the source of truth.

## Studio adapters

Every integrated studio lives in one module under `src/studios/` and is registered in
`src/studios/index.js`. An adapter is deliberately small:

```js
{
  id: "stable-studio-slug",
  name: "Display name",
  authority: { name: "Studio or storefront", url: "https://…", role: "authoritative catalogue" },
  fetchScenes: async ({ now, days, fetchImpl }) => ({ scenes, verifiedEmpty })
}
```

The authority rule is consistent: use the studio's own website and catalogue. A
studio's primary storefront may be hosted on a platform branded differently; for
Lancelot Styles Evolution and **Mambo Perv**, that storefront is AnalVids. The
[Mambo Perv archive](https://www.analvids.com/studios/mambo-perv) provides its dated
listings and linked records. For **Tushy**, the [official video catalogue](https://www.tushy.com/videos)
provides the release feed and linked scene records. TPDB and other aggregators are
not used to infer or replace studio release information.

Each normalised scene must contain `sourceSceneId`, `title`, `releaseDate`,
`performers`, `thumbnailUrl`, `releaseUrl`, `source`, and `provenance`. Provenance
records the source name, catalogue URL, record URL, and source scene ID. The sync
assigns the stable ID `<studio id>:<source scene id>`; it never deduplicates studios
by title or date. An adapter must explicitly return `verifiedEmpty: true` when it has
positively established that the authoritative catalogue is empty. A zero-record
parse without that signal is a failure and retains the studio's last good records.

### Add the next studio

1. Use the studio's official website or primary storefront as the authority. Do not
   substitute an aggregator for a studio catalogue.
2. Add exactly one `src/studios/<studio-id>.js` adapter implementing the contract.
   Keep fetching and any credentials server-side; browser code only reads generated
   catalogue JSON.
3. Register it in `src/studios/index.js`.
4. Save small, representative source pages under `fixtures/<studio-id>/`.
5. Test listing and detail parsing, required fields and provenance, stable scoped
   IDs, a verified empty result, and suspicious extraction failure. Run `npm test`.
6. Run `npm run sync` and inspect `data/catalogue.json`. Confirm real records and
   the studio refresh status before opening one studio-specific PR.

The sync isolates adapters. A failed studio retains only last-good records still in
the rolling 90-day window and publishes an error plus its last successful refresh;
other studios can still update.

## First milestone

Show one canonical, rolling 90-day list of registered studio releases:

1. Poll each studio's authoritative release listing and follow its scene records as needed.
2. Record each scene's title, release date, studio, performers, thumbnail, and link to the studio's scene page.
3. Identify scenes by a stable studio-scoped source ID and keep only releases within the past 90 days.
4. Display the catalogue in a searchable, sortable dashboard.

The Porn Database (TPDB) may be added later for supplementary coverage or metadata. It is **not part of the current live sync** and will not override the studio's website when sources disagree.

## Dashboard design

The [watchlist mockups](docs/mockups/watchlist.html) show two layouts: a release ledger and visual cards. The **release ledger** is the preferred starting point because it keeps dates and performers easy to scan while giving each scene a thumbnail and a link to its studio source page.

To view the mockups, download or clone the repository and open `docs/mockups/watchlist.html` in a browser. The preview is self-contained and uses illustrative placeholders; it does not contain real scenes, imagery, or working scene links.

## Direction

Liszt starts with the watchlist. Later stages may add more studios and check whether listed scenes are already present on disk. Acquisition and other automation may follow gradually, once the scene list is dependable.

## Run the prototype

The prototype is a dependency-free Node.js application hosted on Render. It provides
a release ledger, search and sorting, and a rolling 90-day window populated from each
studio's live catalogue. The Node server serves the dashboard and its API; source
fetching stays server-side.

```sh
npm test
npm run sync
npm start
```

Then open <http://localhost:3000>. Set `PORT` or `LISZT_DATA_PATH` to override the defaults.
The dashboard’s **Refresh data** button runs every registered source adapter immediately
and updates the ledger when the refresh finishes. Concurrent requests share the same sync,
so repeated clicks cannot start overlapping source fetches. Set `FLARESOLVERR_URL` to an
existing FlareSolverr service's `/v1` endpoint to retry HTTP 403 responses from studio
catalogue pages through FlareSolverr. Normal requests still go directly to the source;
Liszt does not start or install FlareSolverr.

The sync command runs every registered studio independently and writes the rolling
90-day catalogue to `data/catalogue.json`. Render serves the app and catalogue API;
manual refreshes fetch current source data through the server.

## Status

Live catalogue adapters for Lancelot Styles Evolution, Mambo Perv, and Tushy are implemented. TPDB integration and on-disk presence checks are future work.
