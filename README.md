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

The prototype is a dependency-free Node.js application. It provides a release ledger, search and sorting, and a rolling 90-day window populated from the live AnalVids listing.

```sh
npm test
npm run sync
npm start
```

Then open <http://localhost:3000>. Set `PORT` or `LISZT_DATA_PATH` to override the defaults.

The sync command runs every registered studio independently and writes the rolling 90-day catalogue to both the local server and GitHub Pages data files. A scheduled GitHub Actions workflow refreshes and commits those exact files every day; it can also be run manually from the Actions tab.

## Status

Live AnalVids catalogue adapters for Lancelot Styles Evolution and Mambo Perv and daily scheduled publishing are implemented. TPDB integration and on-disk presence checks are future work.
