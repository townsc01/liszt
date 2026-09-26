# Load: #105 — FC2 sellers as first-class studios in the UI

- **Issue:** #105 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §4, §11.3.
- **Wave:** 4. **Depends on:** #104 (admitted sellers) and #113 (scene records carrying
  `seller`).
- **Branch:** `fc2-105-seller-studios`
- **Owns:** `public/app.js`, `src/sync.js`, `src/studios/fc2.js`, `test/fc2-studios.test.js`

**Do not run this load concurrently with #106** — both edit `public/app.js`. #107 may run
alongside it.

## Scope

§11.3 **supersedes §4's single `FC2 - uncensored (M/F)` registration.** There is still one
adapter (`src/studios/fc2.js`) doing the fetching, but it emits one logical studio per
admitted seller, and the seller rides on the scene record.

- Studio id: `fc2:<writer.slug>`
- Display name: `FC2 / <writer.name>`, with a romanised subtitle where known — e.g.
  `FC2 / 大人仮面Z (Otona Kamen Z)`
- Studio ordering in the watchlist follows latest release, same as the existing lanes.

This is **not** a shared-schema change. The generic per-scene studio support already
landed in PR #111 (#65): `validateResult` honours a scene's own `studioId`/`studio`
(`src/catalogue.js:18-19`), and `src/sync.js` publishes one status per label
(`src/sync.js:19-23`, `50-55`). This load is the FC2 seller display on top of that.

## Two things to get right

1. **Pick one id separator and use it everywhere.** The id form has to agree with #107's
   prefix resolution in `src/matching-config.js` and with the retention clause below. If
   #107 has landed,    match what it did; if not, choose the form, record it in a comment on this issue, and
   tell #107 so the two loads agree.
2. **Retention must cover the id form you emit.** The failed-refresh path keeps prior
   scenes with:
   ```js
   scene.studioId === adapter.id || scene.studio === adapter.name
     || String(scene.studioId || "").startsWith(`${adapter.id}-`)
   ```
   (`src/sync.js:58`). That third clause is prefix-**dash** against the adapter id. If
   your per-seller ids are `fc2:<slug>`, they are **not** covered by it, and a single
   failed refresh would drop every seller label from the watchlist. Either align the id
   form with the existing clause or extend it deliberately — with a test that proves
   retention works for a per-seller id.

## What the UI needs

- The watchlist filter dropdown is built from `data.studios` (`public/app.js`), and rows
  are grouped by `studioId`. Confirm the seller labels render, group and filter with the
  existing code path rather than a new branch.
- Ordering by latest release, consistent with the other lanes.
- Romanised seller names come from the background label namer
  (`src/translate.js`, `createLabelNamer`), which renames labels once and caches them on
  the studio record. The watchlist renders `scene.studio` per row, and
  `src/translate-run.js:64-65` propagates a renamed label to the rows. Confirm a renamed
  seller reaches both the status entry and its scenes, and that the rename is durable
  across the next sync (the prior name wins — `src/sync.js:19-22`).
- Display name format: `FC2 / <writer.name>` with the romanised subtitle appended when
  known. Unmapped sellers keep their Japanese name; **never guess a romanisation.**

## Tests — `test/fc2-studios.test.js`

Using the temp-catalogue `sync()` pattern from `test/madouqu.test.js`:

- a scene from an admitted seller publishes its own studio status, not one flat FC2 entry;
- the display name is `FC2 / <writer.name>` and the romanised subtitle appears when known;
- **retention through a failed refresh keeps per-seller labels** (the clause above);
- two sellers produce two statuses; a seller that goes dormant keeps its existing rows;
- an LLM-renamed label survives the next sync and reaches its rows;
- ordering by latest release.

## Acceptance

- `npm test` green.
- No change to how western studios or the madouqu labels are displayed — confirm by
  running the app and checking the existing lanes.
- PR body: `Part of #64`, agent + model, the id form you chose, the retention fix (or the
  reason none was needed), and the evidence that seller labels survive a failed refresh.
