# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. It is currently in the planning stage.

The first version will check Lancelot Styles Evolution's web portal and The Porn Database (TPDB) each day, reconcile records for scenes released in the past 90 days, and present one canonical list in a dashboard.

## First milestone

Prove the end-to-end workflow for **Lancelot Styles Evolution**:

1. Poll Lancelot Styles Evolution's web portal and TPDB API daily.
2. Match records that refer to the same scene.
3. Use the studio's own listing as the source of truth when sources disagree.
4. Maintain a rolling 90-day list without duplicate scenes.
5. Show each scene's **release date**, **studio**, **female performers**, **thumbnail**, and a **link to the studio's release page** in a dashboard.

A scene should appear once in the list, even if it is found through more than one source. The studio's release page and published details are authoritative. TPDB can add useful coverage and metadata, but it does not override the studio's own release information.

## Dashboard design

The [watchlist mockups](docs/mockups/watchlist.html) show two layouts: a release ledger and visual cards. The **release ledger** is the preferred starting point because it keeps dates and performers easy to scan while giving each scene a thumbnail and a route to its studio release page.

To view them, download or clone the repository and open `docs/mockups/watchlist.html` in a browser. The preview is self-contained and uses illustrative placeholders; it does not contain real scenes, imagery, or working studio links.

## Direction

Liszt starts with the watchlist. Later stages may add more studios and check whether listed scenes are already present on disk. Acquisition and other automation may follow gradually, once the scene list is dependable.

## Status

Planning. The implementation and setup instructions have yet to be chosen; this README describes the intended first version rather than a working release.
