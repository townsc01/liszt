# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. The live catalogue tracks Lancelot Styles Evolution and Mambo Perv.

For this project, the [Lancelot Styles Evolution listing on AnalVids](https://www.analvids.com/studios/lancelotstylesevolution) and its linked scene pages are the **authoritative catalogue**. Liszt uses their release information as the source of truth. AnalVids is the authority for this watchlist even though it is a third-party site, rather than the studio's own website.

## Studio adapters

Every integrated studio lives in one module under `src/studios/` and is registered in
`src/studios/index.js`. An adapter is deliberately small:

```js
{
  id: "stable-studio-slug",
  name: "Display name",
  authority: { name: "Source name", url: "https://…", role: "authoritative catalogue" },
  fetchScenes: async ({ now, days, fetchImpl }) => ({ scenes, verifiedEmpty })
}
```

The authority is a per-studio editorial decision, not a system-wide assumption. For
Lancelot Styles Evolution, the AnalVids studio listing and linked scene pages are the
authoritative catalogue. AnalVids is not merely a discovery source. TPDB is not
integrated.

The same decision applies specifically to **Mambo Perv**: Liszt treats the
[AnalVids Mambo Perv archive](https://www.analvids.com/studios/mambo-perv), including
its dated monthly listings and linked records, as the authoritative release catalogue
for this watchlist—not as a discovery source. The archive supplies the stable record
IDs, release dates, studio attribution, performers, and images that Liszt publishes;
no second source is used to infer or replace release dates. This is an explicit Liszt
editorial choice about catalogue provenance, not a claim that AnalVids is operated by
Mambo Perv.

Each normalised scene must contain `sourceSceneId`, `title`, `releaseDate`,
`performers`, `thumbnailUrl`, `releaseUrl`, `source`, and `provenance`. Provenance
records the source name, catalogue URL, record URL, and source scene ID. The sync
assigns the stable ID `<studio id>:<source scene id>`; it never deduplicates studios
by title or date. An adapter must explicitly return `verifiedEmpty: true` when it has
positively established that the authoritative catalogue is empty. A zero-record
parse without that signal is a failure and retains the studio's last good records.

### Add the next studio

1. Decide and document which website is authoritative and why. Do not assume the
   studio site, AnalVids, or any aggregator has the same role for every studio.
2. Add exactly one `src/studios/<studio-id>.js` adapter implementing the contract.
   Keep fetching and any credentials server-side; browser code only reads generated
   catalogue JSON.
3. Register it in `src/studios/index.js`.
4. Save small, representative source pages under `fixtures/<studio-id>/`.
5. Test listing and detail parsing, required fields and provenance, stable scoped
   IDs, a verified empty result, and suspicious extraction failure. Run `npm test`.
6. Run `npm run sync` and inspect both `data/catalogue.json` and the Pages-served
   `docs/catalogue.json`. Confirm real records and the studio refresh status before
   opening one studio-specific PR.

The sync isolates adapters. A failed studio retains only last-good records still in
the rolling 90-day window and publishes an error plus its last successful refresh;
other studios can still update.

## First milestone

Show one canonical, rolling 90-day list of registered studio releases:

1. Poll the AnalVids listing's relevant month pages each day and follow their scene pages.
2. Record each scene's title, release date, studio, female performers, thumbnail, and link to its AnalVids scene page.
3. Identify scenes by their studio-scoped AnalVids scene ID and keep only releases within the past 90 days.
4. Display the catalogue in a searchable, sortable dashboard.

The Porn Database (TPDB) may be added later for supplementary coverage or metadata. It is **not part of the current live sync** and will not override AnalVids when sources disagree.

## Dashboard design

The [watchlist mockups](docs/mockups/watchlist.html) show two layouts: a release ledger and visual cards. The **release ledger** is the preferred starting point because it keeps dates and performers easy to scan while giving each scene a thumbnail and a link to its AnalVids page.

To view the mockups, download or clone the repository and open `docs/mockups/watchlist.html` in a browser. The preview is self-contained and uses illustrative placeholders; it does not contain real scenes, imagery, or working scene links.

## Direction

Liszt starts with the watchlist. Later stages may add more studios and check whether listed scenes are already present on disk. Acquisition and other automation may follow gradually, once the scene list is dependable.

## Run the prototype

The prototype is a Node.js application. It provides a release ledger, search and sorting, and a rolling 90-day window populated from the live AnalVids listing.

```sh
npm test
npm run sync
npm start
```

Then open <http://localhost:3000>. Set `PORT` or `LISZT_DATA_PATH` to override the defaults.
The dashboard’s **Refresh data** button runs every registered source adapter immediately
and updates the ledger when the refresh finishes. Concurrent requests share the same sync,
so repeated clicks cannot start overlapping source fetches. On the static GitHub Pages
preview, the button instead checks for the latest catalogue published by the scheduled sync.

The sync command runs every registered studio independently and writes the rolling 90-day catalogue to both the local server and GitHub Pages data files. A scheduled GitHub Actions workflow refreshes and commits those exact files every day; it can also be run manually from the Actions tab.

## Status

Live AnalVids adapters, generic structured-data discovery, and daily scheduled publishing are implemented. Server deployment, TPDB integration, and on-disk presence checks are future work.

## Automatic studio discovery

The **Add studio** screen accepts an ordinary homepage. Crawlee runs on the server,
stays on the submitted hostname, visits at most 30 pages, and favours release, scene,
video, and watch links beyond the first level. Liszt accepts Schema.org `VideoObject`,
`Movie`, and `Episode` JSON-LD only when a publication date and stable scene URL are
present. It hashes the canonical URL (without query or fragment) into a stable,
studio-scoped ID and retains both homepage and record URL as provenance. Firecrawl is
not used.

This conservative generic path works for server-rendered sites with dated Schema.org
records and canonical scene URLs. JavaScript-only catalogues, bot/login/age gates,
dates embedded only in images or prose, and sites without individual stable URLs stay
**pending**. The preview states which evidence is missing and will not invent a date or
identity.

### Flow and safety

1. Open **Add studio**, enter a homepage and the admin token, then explore it.
2. Inspect the detected name, visited pages, recent dates, thumbnails, and links.
3. Add the supported preview. The API atomically persists `data/studios.json`,
   deduplicates by normalized origin, and reports `saving`, `syncing`, and `complete`.
4. Later `npm run sync` runs built-in and discovered studios. The existing 90-day
   window and last-good retention protect records from failed or suspiciously empty
   refreshes.

Submitted URLs must use HTTP(S), standard ports, and public DNS targets. Credentials,
localhost, private addresses, and off-origin crawl links are rejected. Crawling and
credentials never run in browser code.

## Deploying the authenticated service

GitHub Pages cannot accept submissions. Deploy this repository's small Node service
(for example as a single container) with Node 20, `npm ci`, and `npm start`, plus:

* `LISZT_ADMIN_TOKEN`: a long random secret required by preview, add, progress, and
  manual refresh APIs;
* `LISZT_ALLOWED_ORIGIN=https://<owner>.github.io` when the static UI is cross-origin;
* `LISZT_STUDIOS_PATH` and `LISZT_DATA_PATH` pointing into a persistent volume; and
* a daily scheduler running `npm run sync` against that same volume (or authenticated
  `POST /api/refresh`).

For Pages, set `data-api-base` in `docs/index.html` to the service's HTTPS origin and
`data-catalogue-url` to its `/api/scenes` URL. Alternatively serve `public/` directly
from the service. Never place the admin token in Pages, repository secrets output, or
source control. The existing Action continues publishing built-in sources; the volume,
service URL, Pages configuration, and service scheduler remain deployment work and are
not provisioned by this repository-only change.

## Deterministic end-to-end demonstration

`fixtures/generic-studio/home.html` is a previously unknown “Northstar Films” homepage.
The discovery test submits it to the generic pipeline and verifies its dated “Aurora”
scene, thumbnail, performer, and stable URL-derived ID. The server integration test
authenticates, previews, adds, polls first-sync progress, and checks the resulting
catalogue. This proves the complete flow without pretending a third-party site's live
markup or crawling policy will remain unchanged.
