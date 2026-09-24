# Liszt

Liszt is a personal project for building a reliable watchlist of recently released studio scenes. It is currently in the planning stage.

The first version will check Lancelot Styles Evolution's web portal and The Porn Database (TPDB) each day, reconcile records for scenes released in the past 90 days, and present one canonical list in a dashboard.

## First milestone

Prove the end-to-end workflow for **Lancelot Styles Evolution**:

1. Poll Lancelot Styles Evolution's web portal and TPDB API daily.
2. Match records that refer to the same scene.
3. Use the studio's own listing as the source of truth when sources disagree.
4. Maintain a rolling 90-day list without duplicate scenes.
5. Show each scene's **release date**, **studio**, and **female performers** in a dashboard.

A scene should appear once in the list, even if it is found through more than one source. TPDB can add useful coverage and metadata, but it does not override the studio's own release information.

## Direction

Liszt starts with the watchlist. Later stages may add more studios and check whether listed scenes are already present on disk. Acquisition and other automation may follow gradually, once the scene list is dependable.

## Status

Planning. The implementation and setup instructions have yet to be chosen; this README describes the intended first version rather than a working release.
