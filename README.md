# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. The first live version tracks Lancelot Styles Evolution.

For this project, the [Lancelot Styles Evolution listing on AnalVids](https://www.analvids.com/studios/lancelotstylesevolution) and its linked scene pages are the **authoritative catalogue**. Liszt uses their release information as the source of truth. AnalVids is the authority for this watchlist even though it is a third-party site, rather than the studio's own website.

## First milestone

Show one canonical, rolling 90-day list of Lancelot Styles Evolution releases:

1. Poll the AnalVids listing's relevant month pages each day and follow their scene pages.
2. Record each scene's title, release date, studio, female performers, thumbnail, and link to its AnalVids scene page.
3. Deduplicate scenes and keep only releases within the past 90 days.
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

The sync command fetches the relevant AnalVids month listings, follows scene pages for their release dates and linked performers, and writes the rolling 90-day catalogue to both the local server and GitHub Pages data files. A scheduled GitHub Actions workflow refreshes and commits that data every day; it can also be run manually from the Actions tab.

## Status

Live AnalVids catalogue adapter and daily scheduled publishing are implemented. TPDB integration and on-disk presence checks are future work.
