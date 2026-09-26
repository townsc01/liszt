# FC2 lane (#64) — execution order for the 9 open issues

## Goal

Land the FC2 lane (fc2cmadb.com, uncensored M/F) as 8 scoped PRs under tracker **#64**, keeping `main` green and the running app correct at every merge. All DECIDED spec items (`docs/specs/fc2-anal-uncensored.md` §3–§7, §11) are fixed; this plan only fixes *order, file ownership, and merge gates*.

## Current state (verified 2026-09-26, read-only checks)

- Parent tracker **#64** (milestone Phase 4 – New lanes) is the only umbrella; close it from the last sub-PR.
- Sub-issues: **#103** crawler+fixtures, **#104** filter+admission, **#113** adapter+sync, **#105** seller studios UI, **#112** matcher contract, **#107** exact-PPV matching, **#106** translation, **#108** seed acceptance baseline.
- **#111 (madouqu, #65) is merged on main** (`d3390a2`), so `src/translate.js` / `src/translate-run.js` exist — #106's shared-module dependency is satisfied.
- **#89 is done** (PR #109) — `data/translations.json` is the durable translation store, committed by `.github/workflows/catalogue-refresh.yml` every 6h. Do not build a second store.
- **Seed + fixtures are recoverable, not lost**: `refs/pull/32/head` = `0a74970` contains `data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv` and `fixtures/fc2cmadb/`. Confirmed by browsing that tree on GitHub. No blocker.
- No FC2 code, seed, or fixture exists on `main` yet. `windowDays` is declared by madouqu but ignored (`src/sync.js:45` hardcodes `days: 90`) — no change needed for FC2 (spec keeps the 90-day default).
- Only automated PR gate: `npm test` (`node --test test/*.test.js`). No lint script. Tests must be fixture-driven, no network, no LLM key.

## Decisions taken (with you, 2026-09-26)

1. **#108 acceptance is re-baselined, not literal row-for-row.** The 318-row seed is a tag-47-only, §3-only cut; #103/#104 add the 8-tag union crawl (§11.5) and the orientation/blocklist filters (§11.1a/§11.2) that were derived *from* those 318 rows. Strict equality is unreachable. #108 instead asserts: every seeded `fc2_video_id` is accounted for with the same keep/exclude reason; kept-minus-documented-blocklist reproduces the ledger buckets; a refreshed union-crawl CSV becomes the live baseline.
2. **Two parallel tracks, serialised on shared files** (below). `src/catalogue.js`, `src/sync.js`, `src/matching-config.js`, `public/app.js` each have exactly one owner at a time.
3. **The lane runs unattended.** No human gate, review, or approval. The mayor reviews and merges every PR, resolves every ambiguity, and records the decision as a comment on the issue before continuing; the issue tracker is the record. Dispatchable work orders are in `docs/loads/fc2/`, with the mayor's bootstrap prompt in `docs/loads/fc2/MAYOR-PROMPT.md`. Only three conditions stop the lane rather than proceeding: a failing safety screen or trans/crossdress backstop, an irreversible/destructive git action, or a change that must leave the lane's file ownership.

## Order

```
Track A (disjoint files)          Track B (shared plumbing, serial)
  #103 crawler + fixtures   ─┐
  #104 filter + admission  ─┴─> #112 matcher contract ─> #113 adapter + sync ─┬─> #107 exact-PPV matching
                                                                        ├─> #105 seller studios (UI)
                                                                        └─> #106 translation (UI)  [#105 then #106: both touch public/app.js]
                                                                                        │
                                                                                        └─> #108 acceptance baseline (last)
```

### Wave 1 — Track A (start immediately, both on `main` HEAD `1f0946e`)

**#103 FC2: fc2cmadb union-tag crawler + fixtures** — no dependencies.
- Recover verbatim: `git fetch origin refs/pull/32/head` then `git checkout 0a74970 -- data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv fixtures/fc2cmadb/`.
- New `src/fc2/cmadb.js` (new dir — keeps lane logic out of shared files): Inertia `<script data-page="app">` extraction, `Ziggy` route table, tag-listing cursor pagination, article-detail partial reload (`X-Inertia-*`), 409 → re-read version → retry, measured pacing (detail ≥ 8s, listing ≥ 2s), configurable pacing/rate-limit for tests.
- Union tag set per §11.5: アナル (47), アナルファック, アナル中出し, 尻穴, ケツ穴, 肛門, 2穴, 二穴 (+ noisy アナルセックス, アナル拡張 for seller-activity only).
- Emit raw crawl records only. **No filter logic here** (safety screen, trans backstop, orientation, blocklist all live in #104 — implement each lexicon once).
- Exports named helpers for tests. Tests: listing parser (30 items, `next_page_url` cursor, null-cursor final page), detail parser (`censored` 無/有/null, tags, sale fields, `not_found`), 409 retry, pacing ≥ 8s and 429 stop, fixture-driven.
- Check the seed CSV's quoting while recovering it — FC2 titles may contain commas; the existing naive `split(",")` test parser convention (`test/madouqu.test.js:20`) only holds if no field contains a comma. If it does, add a minimal quoted-field parser in the FC2 test helper only (do not change madouqu's).

**#104 FC2: activity-based seller admission, orientation filter, precision blocklist** — after #103 merges (or stacked on its branch).
- New `src/fc2/filters.js`: §3 safety screen, censorship gate, trans/crossdress backstop; §11.1 admission (≥3 releases / trailing 90d across union, dormant at 180d, recomputed each sync); §11.1a tier 1 seller classification, tier 2 item lexicon with the load-bearing M/F co-occurrence rescue, tier 3 detail-tag check; §11.2 precision blocklist.
- Every exclusion logged with matched term + seller; nothing silently dropped.
- Tests per §9 filter list, driven off `fixtures/fc2cmadb/`, including the two historical trans cases (4362199, 2229202) and the five safety-screen video_ids as fixed regression rows.

### Wave 2 — Track B, shared plumbing (start now, merge first)

**#112 Per-lane matcher contract (opt-in half)** — independent of FC2 code, so it goes first and unblocks #107 without waiting for the crawl.
- `src/catalogue.js:23` currently only maps `matcher === null` → `videoMatching: false`. Add the declaration path: a lane-declared matcher/identity is stamped on the scene (e.g. `videoMatcher: "fc2-ppv"`) alongside the existing opt-out.
- Dispatch in the enrichment path (`src/sxyprn.js:181-186` skip point, `src/sxyprn.js:224-249` `enrichStoredCatalogue`, `src/server.js:138-147` where the eporner fallback lookup is built). A lane-declared matcher must not fall into the western sxyprn cascade first.
- Regression: `matcher: null` still skipped (existing `test/madouqu.test.js` coverage), no-declaration still gets the global cascade, declared matcher is consulted. Do not weaken any `src/matching.js` gate.

**Merge gate:** `npm test` green on main before #113 branches.

### Wave 3 — #113 the join point (needs #103 + #104 merged, #112 on main)

**#113 FC2: lane adapter + two-tier sync integration** (§4, §7).
- `src/studios/fc2.js` implementing the existing contract (`id`, `name`, `authority`, `fetchScenes`, `windowDays: 90`), registered in `src/studios/index.js:9`. **Register with `matcher: null` initially; #107 flips it on** — the issue explicitly allows this and it decouples #113 from the matcher semantics.
- Field mapping per §4 including `originalTitle`, `seller`, `tags`, `censorship`, `provenance`, and **`durationSec` from the listing `duration`** — `src/matching.js:90` refuses to match a scene without a finite positive duration, so #107 is blocked if this is omitted.
- Two-tier sync: cheap listing poll newest-first with one page of overlap; budgeted detail tier (`FC2_DETAIL_BUDGET`, default 60), 429 → stop tier + 60-min backoff + lane errored, badge-null → pending re-check ≤7 days then drop, `not_found`/`status` → mark removed (never delete), change detection keyed on `video_id` with translation/link invalidation, `verifiedEmpty` only when genuinely no new items and no pending queue.
- **Pending-queue persistence decision:** store it as a top-level lane-state key in `data/catalogue.json` (added at `src/sync.js:75`), not a new file. Rationale: the spec says "in the catalogue file", and `reverify.js:163` / `translate-run.js:68` both write `{...catalogue}` so the key survives; a separate file would live only on Render's ephemeral disk because the 6-hourly refresh workflow only commits `catalogue.json` and `translations.json`.
- `scripts/backfill-fc2.mjs` mirroring `scripts/backfill-madouqu.mjs` (drive the walk via adapter exports, normalise through `validateResult`, replace only this lane's scenes/studios), plus a `backfill:fc2` script entry. Document the ~20h full backfill at the safe rate.
- Registering the lane makes it run in the production sync. Gate: this must not be merged until the admission filter (#104) is on main, or the first real sync pulls unfiltered rows.
- Tests: real `sync()` against a temp catalogue (madouqu test pattern), retention through a failed refresh, removed-not-deleted, pending queue survives restart, budget cut-off leaves the remainder queued.
- **Verify before merge:** the default 60-fetch budget is ~9 minutes of detail fetches, and `src/sync.js:40` fans all adapters out in one `Promise.all` with no per-adapter timeout — this stalls the whole sync. Either lower the default budget or confirm the Render/cron tolerance; record the choice in the PR.

### Wave 4 — three feature cuts off #113 (#107 touches only matching files; #105 then #106, both touching `public/app.js`)

**#107 FC2: exact PPV-code playback matching.**
- Extend the code mechanism: `src/matching-config.js:7` derives the code from `scene.title` (Japanese, code absent) and keys on `scene.studioId` (which will be per-seller `fc2:<slug>`). Build `fc2-ppv-<sourceSceneId>` instead and resolve per-seller ids by prefix.
- Identity = exact code-in-title on eporner (6,356 verbatim `FC2 PPV <code>` uploads measured), plus duration proximity when the source record carries one. sxyprn best-effort, not required. Reuse the cascade's gate; do not add an alternate admission path.
- Tests: exact-code match, near-miss code rejected, duration mismatch rejected, unmatched scene links to nothing, western lanes unaffected.

**#105 FC2: sellers as first-class studios in the UI** (§11.3).
- Generic per-scene `studioId`/`studio` support already landed in #111 (`src/catalogue.js:19-20`, `src/sync.js:19-23,50-55`): `fc2:<writer.slug>`, display `FC2 / <writer.name>` with romanised subtitle, ordering by latest release. Confirm the retention clause at `src/sync.js:58` (`startsWith(\`${adapter.id}-\`)`) covers the `fc2:`/`fc2-<slug>` form actually emitted — pick one id separator and use it consistently.
- Seeded seller-name romanisation comes from the label namer (`src/translate.js:193`), which is the background job, not the boot path.

**#106 FC2: Japanese → English titles.**
- Consume `src/translate.js`; supply the FC2 glossary and prompts. Two real code changes are implied: the LLM prompt/system message are Chinese-specific (`src/translate.js:56-57,111`) and must be parameterised by locale, and `src/translate-run.js:11,33` hard-imports madouqu's `TITLE_GLOSSARY` as the default — make the default lane-aware.
- `titleTranslated` / `translationProvider` on the scene record; `originalTitle` rendered as a `lang="ja"` subtitle in `public/app.js`; search matches both fields.
- Contract: never in the boot or sync path; batched (not per-title) LLM backfill; glossary hits never touch the LLM; durable via `data/translations.json`; missing `OPENROUTER_API_KEY` → glossary-only, provider `untranslated`, no banner, no sync failure. Translation never blocks a sync.

### Wave 5 — #108 acceptance baseline (last, after all of the above)

Per Decision 1: replay the committed fixtures through the whole pipeline and assert
- every seeded `fc2_video_id` is accounted for with the same keep/exclude reason;
- kept set == 318 minus the documented §11.1a/§11.2 drops, with the drop list as an explicit committed allow-file (never an inline magic list in the test);
- the §3 ledger buckets (censored 950, trans 2, safety 5, mixed 32, badge-null 7,583, empty 1) reproduce;
- a refreshed union-crawl CSV is generated once and becomes the live baseline, replacing row-for-row equality against the 318-row file.
Then close **#64** from the #108 PR description.

## Merge discipline (AGENTS.md)

- One issue per PR, branched from **latest `main`**, never from a spec branch or a stacked branch that has not merged.
- PR title includes the issue number; description carries `Part of #64`, agent + model authorship (rule 10), and a commit-message trailer naming the agent.
- Draft PRs; post the link in the issue; address coderabbitai review on the same PR.
- `npm test` green locally and in CI (`test.yml`) before requesting review. No network, no LLM key in tests.
- Comment on the issue at start, at each load-bearing decision, and at handoff. **Record Decisions 1 and 2 from this plan as comments on #108 and #64** so the queue history carries them.

## Risks

- **Rate-limit ban (highest).** 8-9s detail pacing is measured; a faster run means HTTP 429 and a 30-60 minute ban. #103's pacing must be testable (injectable clock/pacing) and #113 must stop the tier on the first 429.
- **Merge conflicts** if #112/#113 and #107 land out of order: `src/catalogue.js`, `src/sync.js`, `src/matching-config.js` each have one owner at a time per the waves above.
- **Unfiltered first sync:** registering the adapter in #113 before #104 merges would admit the full union crawl. Do not merge #113 ahead of #104.
- **`windowDays` is declared but ignored** (`src/sync.js:45`). Harmless for FC2 (90 is the spec's decision) — note it, do not fix it in this lane (scope).
- **No per-adapter timeout in sync**, so a full FC2 detail budget stretches the whole refresh; the 6-hourly cron absorbs it, but the first production run should use a small `FC2_DETAIL_BUDGET`.
- **~20h full backfill** is a one-time cost. The automated check must never depend on it; only `scripts/backfill-fc2.mjs` touches the live site.

## Validation

1. `npm test` green at every merge point (each wave's PR).
2. `LISZT_DATA_PATH=<tmp> node src/sync.js` with only the FC2 adapter and a stub fetch → no network, deterministic.
3. `node scripts/backfill-fc2.mjs` run once against the live site with a small page cap, output reviewed against the spec ledger; never in CI.
4. After #113 merges: trigger the manual refresh in the running app and confirm the FC2 lane appears, pending-queue state persists, and a second run is idempotent.
5. After #107: confirm a sample of FC2 scenes resolves eporner links by exact code and that no wrong-code link is stored.

## Open items to raise on the issues (not blocking)

- #108's stated acceptance ("row-for-row equality") must be edited to the re-baselined form, or #108 will be implemented against an impossible criterion.
- #112 has no owner comment yet; claim it first since Track B is the long pole for #107.
- #64's decomposition note still says "position 14 of 14, after #65" — stale; #103/#104/#112 are now unblocked by #65's merge.
