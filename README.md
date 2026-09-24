# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. It is currently in the planning stage.

The first version will check the Lancelot Styles Evolution catalogue and The Porn Database (TPDB) each day, reconcile records for scenes released in the past 90 days, and present one canonical list in a dashboard.

## First milestone

Prove the end-to-end workflow for **Lancelot Styles Evolution**. The [supplied studio listing](https://www.analvids.com/studios/lancelotstylesevolution) is the starting URL for source discovery.

1. Determine what the supplied listing exposes, whether it is an authoritative studio catalogue, and how to reach individual release pages.
2. Poll the usable catalogue source and TPDB API daily.
3. Match records that refer to the same scene.
4. Use the studio's own published information as the source of truth when sources disagree.
5. Maintain a rolling 90-day list without duplicate scenes.
6. Show each scene's **release date**, **studio**, **female performers**, **thumbnail**, and a **link to the studio's release page** in a dashboard.

A scene should appear once in the list, even if it is found through more than one source. TPDB can add useful coverage and metadata, but it does not override the studio's own release information. If the supplied listing is a third-party index, treat it as a discovery source until an authoritative studio source is established.

## Dashboard design

The [watchlist mockups](docs/mockups/watchlist.html) show two layouts: a release ledger and visual cards. The **release ledger** is the preferred starting point because it keeps dates and performers easy to scan while giving each scene a thumbnail and a route to its studio release page.

To view them, download or clone the repository and open `docs/mockups/watchlist.html` in a browser. The preview is self-contained and uses illustrative placeholders; it does not contain real scenes, imagery, or working studio links.

## Direction

Liszt starts with the watchlist. Later stages may add more studios and check whether listed scenes are already present on disk. Acquisition and other automation may follow gradually, once the scene list is dependable.

## Run the prototype

The prototype is a dependency-free Node.js application. It demonstrates the release ledger, search and sorting, source reconciliation, and a rolling 90-day window with intentionally fictional fixture records.

```sh
npm test
npm run sync
npm start
```

Then open <http://localhost:3000>. Set `PORT` or `LISZT_DATA_PATH` to override the defaults.

The sync command currently reads `fixtures/studio.json` and `fixtures/tpdb.json`. This makes the pipeline repeatable while the supplied listing's authority and the upstream API access are verified. A production source adapter and scheduler are the next integration step; the displayed data is not presented as a real studio catalogue.

## Status

First local prototype. Catalogue discovery, live adapters, credentials, and scheduled polling remain to be implemented.
