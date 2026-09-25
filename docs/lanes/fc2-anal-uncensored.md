# Lane spec: FC2 (anal, uncensored) via fc2cmadb.com

> **Status: implementation spec for Codex, not working code.** Written 2026-09-25 from a
> full live crawl completed 2026-09-24. Chris reviews this document; Codex implements from it.
> Nothing in this branch changes production behaviour - the only runnable artefacts are seed
> data and fixtures.

## 1. Goal

Add an **FC2 lane** to Liszt: FC2-PPV releases that match Chris's interest filter, kept
current by ongoing sync, shown in the existing watchlist UI with English display titles.

The filter, in Chris's words (2026-09-25): the FC2 scenes he is interested in are
**anal + uncensored + no trans** - exactly the cut produced by the 2026-09-24 catalogue run
(318 rows, committed to this branch as `data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv`).
The lane must keep pulling new matching releases after the initial import - this is a watchlist,
not a one-off import.

## 2. The source: fc2cmadb.com

A third-party, Japanese-language database of FC2 content (FC2-PPV fan-uploaded videos).
Laravel + Inertia + Vue. No official API, but every page embeds its full data as JSON, which
makes scraping deterministic:

- Each HTML page carries `<script data-page="app">{...}</script>` containing the Inertia page
  object: `{ component, props, url, version, sharedProps, deferredProps }`.
- Route table is exposed in-page as `const Ziggy = {...}`. Relevant routes:
  - `tags.show` -> `GET /tags/{tag_name}` - paginated list of articles carrying a tag.
  - `article.show` -> `GET /articles/{video_id}` - one article with full detail.
  - `article.latest` -> `GET /articles/latest` - newest articles across all tags (deferred props).
- **Tag listing** (`/tags/アナル`): props.articles is a cursor-paginated list, 30 items/page.
  Each item already includes `video_id`, `title`, `release_date`, `image_url`, `duration`,
  `writer { id, slug, name }`, and a `pivot.tag_id` (アナル = tag 47). `next_page_url` is a
  cursor URL (`?cursor=<base64 JSON {"video_id":...,"_pointsToNextItems":true}>`); null at the end.
  As of 2026-09-24 the アナル listing held **8,891 items over 297 pages**.
- **Article detail** (`/articles/{video_id}`): props.article carries everything the listing has
  plus `censored` (無 / 有 / null - see below), full `tags[]` (Japanese names with pivot ids),
  `sale_percentage`, `sale_limite_date` *(sic - the API's typo)*, `not_found`, `status`,
  `bookmark_count`, `like_count`. An `actresses` prop exists but is *deferred*: fetch the same URL
  with headers `X-Inertia: true`, `X-Inertia-Version: <version from the page>`,
  `X-Inertia-Partial-Component: Articles/Show`, `X-Inertia-Partial-Data: actresses`.
  For FC2 amateur uploads it is almost always empty; do not block on it.
- **Censorship badge.** `censored` is an editorial field: 無 = uncensored, 有 = censored,
  null = not yet marked by the site. Recent items are usually null. The badge is **only present
  on the article detail page** - listing items carry `censored: null` even for marked items.
  Every candidate therefore needs one detail-page fetch before it can be accepted.
- **Inertia version.** The `version` hash in the page object changes on deploys. If a partial
  reload or subsequent request returns HTTP 409, re-fetch the HTML page, read the new version,
  and retry.

### Rate limits (measured 2026-09-24)

- Detail pages: **about one page per 8-9 seconds** is the ceiling. Faster than that returns
  HTTP 429 "Too Many Attempts" and the ban lasts roughly 30-60 minutes.
- Listing pages are far cheaper, but stay polite: >= 2 seconds between page fetches.
- The full-history crawl (8,891 detail fetches) takes ~20 hours at the safe rate. That is a
  one-time cost; ongoing sync only fetches details for newly listed video_ids (see section 6).

## 3. The filter (exact rules)

Apply in this order. Every excluded item is logged with the reason; nothing is silently dropped.

1. **Tag gate.** Item appears on the アナル tag listing (site-side tagging, tag id 47).
2. **Safety screen (hard block, applies before anything is shown).** Title and tags are checked
   against the minor/non-consent lexicon below. Any match -> exclude and log for human review.
   This screen is mandatory on every sync, not just the initial crawl.
   - Japanese: JK, 女子校生, 女子高生, 高校生, ロリ, 未成年, 監禁, 昏睡, 盗撮, レイプ
   - English: loli, underage, schoolgirl variants
   - The 2026-09-24 run excluded 5 items this way (4617344, 4620082, 4618128, 4584815, 4558028).
   - Note: 18歳/19歳 stated ages are legal adults and stay; genre words like 人妻, 素人, 個人撮影
     are normal FC2 vocabulary and stay.
3. **Censorship gate.** Keep only `censored == 無`.
   - `censored == 有` -> exclude (950 items in the 2026-09-24 crawl).
   - Mixed badge `通常版：有 特典版：無` (regular censored, bonus uncensored) -> exclude, log (32 items).
   - null badge -> **pending**, not rejected: hold the item and re-check on later runs (see sync design).
     7,583 items were unbadged in the full-history crawl; most old items are never marked. For the
     ongoing lane, re-check pending items for up to 7 days, then drop them.
4. **Trans / crossdress exclusion.** Exclude when title or tags contain:
   ニューハーフ, 女装子, 女装, 男の娘, シーメール, or English shemale/trans.
   The 2026-09-24 run excluded 2 items: 4362199 (title says ニューハーフ) and 2229202
   (no trans wording in the title, but tagged 女装子 - excluded on the tag).
   *Open question for Chris (section 10): the second one is a male-crossdresser tag, not a
   trans woman - reinstate it if his "no trans" meant trans performers only.*

### 2026-09-24 crawl ledger (the acceptance baseline)

| Bucket | Count |
| --- | --- |
| アナル-tagged items walked | 8,891 (297 listing pages) |
| **Kept (the seed CSV)** | **318** |
| Excluded: censored (有) | 950 |
| Excluded: trans/crossdress | 2 |
| Excluded: safety screen | 5 |
| Skipped: badge null | 7,583 |
| Skipped: mixed badge 通常版：有 特典版：無 | 32 |
| Skipped: badge empty | 1 (video 4867926) |

All 318 kept rows had their detail-page tags fetched and checked (`tags_checked = yes`).

## 4. Data model

One new adapter, `src/studios/fc2.js`, implementing the existing contract
(`id`, `name`, `authority`, `fetchScenes`). Scene mapping:

| Liszt field | Source | Notes |
| --- | --- | --- |
| `id` | `fc2:<video_id>` | Stamped by the shared normaliser. |
| `sourceSceneId` | `video_id` (number as string) | The FC2-PPV number. |
| `title` | English display title when translated, else the Japanese original | See section 5. |
| `originalTitle` *(new optional field)* | Japanese title verbatim | Canonical text; never overwritten. |
| `releaseDate` | `release_date` from the listing | JST calendar date; keep as YYYY-MM-DD. |
| `performers` | `[]` | fc2cmadb has no reliable performer field for these items (the deferred `actresses` prop is almost always empty). The seed CSV's actress column is blank for all 318 rows. Do not guess from titles. |
| `thumbnailUrl` | `image_url` | FC2 CDN thumbnail. |
| `releaseUrl` | `https://fc2cmadb.com/articles/<video_id>` | The database record, not the FC2 store page. |
| `source` / `provenance` | FC2CMADB + listing URL + record URL + video_id | Per the existing provenance shape. |
| `seller` *(new optional field)* | `writer.name` (and `writer.slug`) | FC2 is a marketplace: the seller (サークル) is the closest thing to a studio. |
| `tags` *(new optional field)* | English-mapped tags + original Japanese tags | See section 5. |
| `censorship` *(new optional field)* | `無` | Kept for debugging; always 無 post-filter. |

**Studio/display naming.** Register the adapter as `id: "fc2"`, `name: "FC2 - anal (uncensored)"`.
Do not create one adapter per seller (thousands of sellers); the seller rides on the scene record.

**The 90-day window needs a decision.** The shared sync drops scenes older than 90 days, but
Chris's watchlist rules say the Asian lanes are *all* anal scenes, and the seed cut spans
2017-05-25 to 2026-09-22. Proposal: add an optional `windowDays` to the adapter contract
(default 90, `null` = no window) and set `windowDays: null` for this lane. If Chris would rather
keep the rolling window, set it to 90 and the lane behaves like the western studios.
**Flagged as open question #1 - Codex should implement the `windowDays` hook either way.**

## 5. Japanese -> English titles

The UI is English-first; FC2 titles are Japanese. Design:

- **Canonical text stays Japanese.** `originalTitle` always holds the verbatim title.
  `title` holds the English rendering when one exists. Identity is always `video_id` - translation
  never affects identity, dedupe, or change detection.
- **Two-stage translation, at sync time (server-side only):**
  1. **Glossary pass (offline, always runs).** FC2 titles are highly formulaic. A maintained
     dictionary normalises the boilerplate: 【個人撮影】 = [amateur shoot], 無修正 = uncensored,
     初アナル = first anal, アナルSEX = anal sex, 中出し = creampie, 素人 = amateur,
     人妻 = married woman, ・25歳・ = age 25, Cカップ = C cup, etc. The pass emits a partial
     English rendering plus `translationConfidence`.
  2. **LLM pass (optional, behind env flag).** For titles the glossary can't fully render, one
     batched LLM call per sync (the cloud0 stack already has OpenRouter credentials) with a strict
     prompt: translate, keep ages/numbers/codes exact, no embellishment, output JSON.
     Cache by `video_id` forever. On any failure, fall back to the glossary output, then to the
     Japanese title. Translation must never block or fail a sync.
- **Record keeping.** Add `titleTranslated: true|false` and `translationProvider`
  (`glossary` | `llm:<model>` | `none`) to the scene record. Machine output is always marked.
- **Tags.** Map common Japanese tags to English with a fixed dictionary
  (アナル -> anal, 中出し -> creampie, 素人 -> amateur, 個人撮影 -> amateur shoot,
  フェラ -> blowjob, 巨乳 -> big tits, 美乳 -> nice tits, パイパン -> shaved, 潮吹き -> squirting,
  3P -> threesome, ハメ撮り -> POV/gonzo, ...). Unknown tags pass through in Japanese so no
  information is lost. The safety lexicon in section 3 runs on the *original* tags, before mapping.
- **UI.** `public/app.js` shows `title` as today; render `originalTitle` as a subtitle/secondary
  line (with `lang="ja"`) when it differs, so Chris can sanity-check translations. Search matches
  both fields. No other UI changes required.

## 6. Video links: acknowledged gap, and the way forward

**Sxyprn matching, as built, will not work for this lane.** The current matcher
(`src/sxyprn.js`) keys on western-studio signals: performer names (FC2 has none) and
English title words (FC2 titles are Japanese). Expect a near-zero hit rate.

Direction, in order of preference:

1. **Match on the PPV code first (cheap, high precision).** Sxyprn hosts a lot of FC2 uploads,
   and uploaders put the code in the title (`FC2-PPV-<video_id>`). Extend the existing
   `sceneCode()` mechanism (today special-cased to Mambo Perv's OB codes) to emit
   `fc2-ppv-<video_id>` for fc2 scenes and require an exact code match instead of the 0.75
   title-score threshold. Code matches are effectively unambiguous; keep the verified-details
   step unchanged. This needs no new infrastructure and should be tried first.
2. **Revive the Lustpress/Eporner combo as the fallback.** It was built in #21 and removed in
   #25 (commit 7272a85); the code is in git history (`src/eporner.js`,
   `test/eporner.test.js`, the `vendor/lustpress` submodule). Eporner indexes FC2 uploads and its
   search tolerates the PPV code as a query. If the Sxyprn code search proves thin, port the
   Eporner matcher behind the same per-lane interface rather than restoring it globally - the
   western lanes are happy on Sxyprn.
3. **FC2 itself is the canonical store but out of scope** (paid, region- and login-restricted).

Whatever the matcher: server-side only, verified before display, never auto-link below the
confidence threshold, and keep `sxyprnUrls`-style storage generic (`videoUrls` with a source tag)
so an Eporner revival doesn't need another schema migration.

## 7. Sync design (ongoing)

Two tiers, per run (triggered by the existing manual refresh and/or a future schedule):

1. **Listing poll (cheap).** Walk `/tags/アナル` pages newest-first until reaching a
   `video_id` already in the store (plus one page of overlap for safety). Usually 1-2 pages.
2. **Detail fetch (expensive, budgeted).** For each new or pending video_id, fetch the detail
   page at one per 8-9 seconds. Budget per run (e.g. `FC2_DETAIL_BUDGET`, default 60 fetches
   ~ 9 minutes); anything left over stays queued for the next run. Persist the queue
   (video_id + first-seen date) in the catalogue file so restarts don't lose it.
   - On HTTP 429: stop the tier immediately, mark the lane errored, back off 60 minutes.
   - Badge null -> keep in the pending queue; re-check up to 7 days from first seen, then drop.
   - `not_found` / `status` flags set -> mark the scene removed in the store (do not delete;
     the watchlist should show it went away).
3. **Change detection.** Titles and sale fields are edited by sellers. Key everything by
   `video_id`; if the title changed, update `originalTitle` and invalidate the cached translation
   and any code-matched video link (the PPV code doesn't change, so links are stable).
4. **Contract semantics.** Return `verifiedEmpty: true` only when the listing genuinely has no
   new items and the pending queue is empty. On any fetch failure, keep last-good scenes per the
   existing retention behaviour.
5. **Backfill command.** A `scripts/backfill-fc2.mjs` mirroring the 2026-09-24 manual run
   (walk all 297 listing pages, queue all unknown video_ids for detail checks) for rebuilds.
   Document that a full backfill takes ~20 hours at the safe rate.

## 8. Seed inventory

`data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv` - the 318-row cut from the 2026-09-24 crawl,
UTF-8, newest first. Columns: `fc2_video_id`, `release_date`, `title`, `actress` (blank - the site
exposes no performer data for these items), `censorship` (always 無), `seller`, `url`,
`tags_checked` (always yes). Codex should treat this as the expected output of the initial
backfill: row-for-row equality on `fc2_video_id` is the acceptance test for the filter logic.

## 9. Fixtures and test plan

Committed fixtures (real responses captured 2026-09-25):

- `fixtures/fc2cmadb/tag-anal-page-1.html` - page 1 of the アナル listing (cursor pagination,
  30 items, release_date present on listing rows).
- `fixtures/fc2cmadb/article-4981628-uncensored.html` - detail page of a kept seed row
  (`censored: 無`, 19 tags including アナル and 無修正).

Tests to write:

- Listing parser: extracts items + `next_page_url` cursor; handles the final page (null cursor).
- Detail parser: `censored` 無/有/null, tags, sale fields, `not_found`.
- Filter: trans lexicon (title hit and tag-only hit), safety lexicon, mixed badge, null badge
  -> pending (not dropped), badge flip from null to 無 on re-check.
- Inertia version 409 -> refetch-and-retry.
- Rate-limit: spacing >= 8s, 429 -> immediate stop + 60-minute backoff state.
- Translation: glossary rendering of the formulaic patterns, LLM failure fallback, cache
  invalidation on title change.
- Contract: `windowDays: null` keeps old scenes; default keeps 90-day behaviour for other lanes.
- End-to-end: seed CSV row-for-row reproduction from recorded fixtures.

## 10. Open questions for Chris

1. **Window:** whole-history FC2 lane (proposal: `windowDays: null`) or the standard rolling
   90 days? The rules say "all anal scenes" for Asian lanes; Liszt today enforces 90 days.
2. **Crossdresser tags:** reinstate items like 2229202 (tagged 女装子, no trans wording) or keep
   the broader exclusion?
3. **Sellers as studios:** RESOLVED 2026-09-25 - each whitelisted seller is its own studio
   (section 11.3).
4. **Translation provider:** RESOLVED 2026-09-25 - glossary + LLM from day one (section 11.4).

## 11. Revision 2026-09-25 (evening): Chris's decisions applied

Chris reviewed the seed cut and gave four directions. This section overrides the noted earlier
text; the mechanics elsewhere (rates, fixtures, contract) are unchanged.

### 11.1 Seller whitelist - the lane watches active sellers, not the whole tag

Measured seller concentration and activity over the 318-row seed (40 distinct sellers, top 5 = 72%):

| Seller | Rows | Latest in-tag release | Status |
| --- | --- | --- | --- |
| 大人仮面Z (Otona Kamen Z) | 122 (38.4%) | 2026-09-22 | active |
| エロタウロス (EroTauros) | 58 (18.2%) | 2026-09-18 | active |
| Kerberos | 26 (8.2%) | 2026-07-13 | quiet ~10 weeks |
| エロスエ リョーコ。 | 13 (4.1%) | 2026-06-14 | quiet ~3.5 months |
| ハメ撮りランキング | 9 (2.8%) | 2024-06-18 | inactive ~15 months |

Rules:

- **Seed whitelist: 大人仮面Z and エロタウロス** - the two demonstrably active heavyweights
  (57% of the cut between them).
- **Auto-promotion:** a seller with >= 3 in-tag releases in the trailing 90 days joins the
  whitelist during sync. A whitelisted seller with no in-tag release for 180 days goes dormant:
  its existing rows stay in the catalogue but it is no longer polled for new items.
- Kerberos and エロスエ リョーコ。 start **dormant-watch**: existing rows kept, a single new
  release promotes them back. ハメ撮りランキング starts **excluded** (inactive, and a mistag
  source - see 11.2).
- Non-whitelisted sellers never enter the watchlist UI. The full tag listing is still walked
  every sync (cheap tier) so promotion/dormancy decisions have data; only whitelisted sellers'
  items consume detail-fetch budget.

### 11.2 Precision blocklist (from the manual mistag review of all 318 seed rows)

The review flagged 26 titles with a broad suspect lexicon and manually read every flag:
~97-98% of the cut is genuine M/F anal; true mistags are 5-8 rows. Encode as v1:

- **Seller-level:** ハメ撮りランキング is excluded wholesale (11.1) - removes its solo
  anal-training row. Kerberos rows carry a femdom-leaning risk: exclude when the title matches
  the femdom lexicon (女王様, ペニバン, M男, フィスト, 逆アナル); other Kerberos rows pass.
- **Softcore lexicon:** exclude rows whose titles match solo/shower patterns (オナニー, シャワー,
  入浴, 自撮り) UNLESS an M/F co-occurrence term is also present (中出し, チンポ, ハメ, 貫通,
  挿入, アナルSEX). Catches the ハメンタル shower/masturbation rows and the エロタウロス
  balcony-exposure solo without touching M/F scenes that merely mention toys.
- **Every blocklist exclusion is logged with the matched term and seller for human review** -
  nothing is silently dropped. Lexicon v1 was derived from one manual pass; expect one or two
  tuning rounds on live sync data.

### 11.3 Sellers as first-class studios in the UI (resolves open question #3)

- Each whitelisted seller surfaces as its own studio entry: `id: fc2:<writer.slug>`,
  display name `FC2 / <writer.name>` with a romanised subtitle where known
  (e.g. "FC2 / 大人仮面Z (Otona Kamen Z)").
- This **supersedes section 4's single "FC2 - anal (uncensored)" registration**. There is still
  one adapter (`src/studios/fc2.js`) doing the fetching, but it emits one logical studio per
  whitelisted seller; scenes carry `seller` metadata exactly as section 4 specifies.
- Studio ordering in the watchlist follows latest release, same as existing lanes.

### 11.4 Title translation is required (resolves open question #4)

Ship the section 5 design complete from day one: glossary pass always, LLM pass (OpenRouter,
batched, cached by `video_id`) enabled, fallback order glossary -> LLM -> Japanese original.
The UI shows the English `title` with the Japanese `originalTitle` as a secondary line
(`lang="ja"`) so translations can be sanity-checked; `translationProvider` is recorded on
every scene.

### 11.5 Alias tags - measured coverage note

Chris asked whether other fc2cmadb tags alias for anal. Page-1 inspection of nine candidates
(2026-09-25): whitelisted sellers file some releases under alias tags WITHOUT the アナル tag
(大人仮面Z had 4 items on page 1 of アナル中出し alone), so a tag-47-only crawl misses real
whitelist releases. But the alias tags are noisy as sources in their own right:
アナルセックス skews M/M (top writer 2丁目ギルド), アナル拡張 skews femdom, アナル中出し
carries heavy trans/crossdress content.

Spec: the cheap listing tier also polls the alias listings
(アナルファック, アナル中出し, 尻穴, ケツ穴, 肛門, 2穴, 二穴), but an item from an alias
listing is admitted ONLY when its `writer` is on the seller whitelist - writer identity is
present on listing rows, so this costs no extra detail fetches. Censorship, safety, and
blocklist filters then run unchanged. Alias-tag items from non-whitelisted sellers are dropped
at the listing tier and counted in the sync ledger.

### 11.6 Still open

- **#1 windowDays** (whole history vs rolling 90 days) - with seller whitelisting the
  practical volume is small either way; implement the `windowDays` hook and let Chris flip it.
- **#2 the 女装子 tag** (male crossdresser, not trans woman) - keep excluded unless Chris says
  otherwise.
