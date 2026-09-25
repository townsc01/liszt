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
4. **Trans / crossdress exclusion (hard rule, confirmed by Chris 2026-09-25: no crossdressing
   or trans content at all).** Exclude when title or tags contain:
   ニューハーフ, 女装子, 女装, 男の娘, シーメール, ペニ子, ペニクリ, or English shemale/trans.
   The 2026-09-24 run excluded 2 items: 4362199 (title says ニューハーフ) and 2229202
   (no trans wording in the title, but tagged 女装子 - excluded on the tag).
   Chris ruled on 2026-09-25: no crossdressing or trans content at all - both stay excluded,
   this is a hard block with no reinstatement path.

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
2. **Crossdresser tags:** RESOLVED 2026-09-25 - Chris: no crossdressing or trans content at
   all. 女装子 and related terms are hard exclusions (section 3, rule 4).
3. **Sellers as studios:** RESOLVED 2026-09-25 - each whitelisted seller is its own studio
   (section 11.3).
4. **Translation provider:** RESOLVED 2026-09-25 - glossary + LLM from day one (section 11.4).

## 11. Revision 2026-09-25 (evening): Chris's decisions applied

Chris reviewed the seed cut and gave four directions. This section overrides the noted earlier
text; the mechanics elsewhere (rates, fixtures, contract) are unchanged.

### 11.1 Activity-based seller admission (REVISED 2026-09-25 late evening - replaces the fixed whitelist)

Chris reviewed the whitelist design and rejected the hand-seeded gate: alias-tag items must NOT
require a whitelisted seller. The lane instead **auto-admits sellers by measured activity across
the union of the anal tag and its aliases**.

Measured basis (2026-09-25): 5-page crawl of each of アナルファック, 尻穴, ケツ穴, 2穴, 二穴,
肛門 = 728 items, 123 distinct sellers, only 8 overlapping the アナル seed's sellers. The alias
tags carry whole active studios the tag-47 crawl was blind to (table below).

**Admission rule.** A seller (fc2cmadb `writer`) is admitted as a studio when it has
**>= 3 releases in the trailing 90 days across the union** of the crawled tags (アナル +
aliases). It goes dormant after 180 days without an in-union release: existing rows stay,
polling for that seller stops. A single new release re-activates it. Admission is recomputed
every sync from the listing tiers - no hand-maintained list.

**Alias listings are polled in the cheap tier for ALL sellers** (supersedes the earlier
"whitelist-only admission" for alias items). An item enters the pipeline from any in-union
listing regardless of seller, then passes the orientation filter (11.1a), safety screen,
censorship gate, and blocklists unchanged.

Active sellers the union admits on day one (in-crawl counts over 5 pages/tag, latest release):

| Seller | Items seen | Latest | Notes |
| --- | --- | --- | --- |
| 大人仮面Z (Otona Kamen Z) | 122 (seed) | 2026-09-22 | tag-47 heavyweight |
| 憐憫女々 | 62 | 2026-09-21 | NET-NEW from 二穴/肛門 |
| 志操堅固。 | 61 | 2026-09-23 | NET-NEW from 肛門 |
| エロタウロス (EroTauros) | 58 (seed) | 2026-09-18 | tag-47 |
| 豊満マゾ熟女ハンター | 44 | 2026-09-19 | NET-NEW, spans 5 alias tags; titles verified clean M/F anal |
| スーパー女神ちゃん | 34 | 2026-09-03 | NET-NEW |
| ちぃたんは肉便器になりました。 | 32 | 2026-09-02 | NET-NEW |
| うらあかじょし＠丸の内 | 6 | 2026-09-25 | NET-NEW, released same day as the crawl |

### 11.1a Orientation filter - no pegging, no M/M, no M/T, no solo (Chris's constraint)

Chris: "I don't want pegging/m+m/m+t/solo scenes." Three tiers, cheapest first; every exclusion
is logged with the matched term/seller for human review - nothing silent.

**Tier 1 - seller-level classification (listing data only, zero extra fetches).** Each sync
classifies every seller from the titles of its crawled union items (min 3 titles):
- exclude seller when > 50% of its titles hit the **M/M lexicon** (ガチムチ, ラガーマン,
  ノンケ, ゲイ, ホモ, 男同士, 体育会, GMPD, ケツワレ, マッチョ) or the **M/T lexicon**
  (ニューハーフ, 女装子, 女装, 男の娘, シーメール, shemale, ペニ子, ペニクリ, メス男子,
  竿あり, 玉アリ, オトコノコ, 兜合わせ).
- Measured on the 728-item crawl: cleanly ejects イケメン専門美男倶楽部 (5/5 M/M),
  アナール大佐 (21/22 M/T), コスプレ女装 Akina Films, ペニ子; all eight day-one studios
  above classify clean.

**Tier 2 - item-level title lexicon (listing data).** Hard-exclude items whose titles hit:
- **M/M lexicon** (as above).
- **M/T lexicon** (as above; identical to the hardened section-3 trans/crossdress rule).
- **Pegging/femdom lexicon**: ペニバン, 逆アナル, 逆アナ, 女王様, M男, 前立腺, 男の潮吹き,
  フィスト. Note: フィスト fires on F-receiving anal fisting too (e.g. ブロッケン) - grouped
  here as extreme content; tunable on review.
- **Solo lexicon** (オナニー, 自撮り, シャワー, 入浴, 風呂) **with M/F co-occurrence rescue**:
  excluded only when NO co-occurrence term is present (中出し, チンポ, ハメ, 貫通, 挿入,
  セックス, ファック, 性交, AF, フェラ, 射精, 3P, 二穴/2穴). The rescue is load-bearing -
  straight scenes routinely mention toys/shower.

Measured over the 728-item alias crawl: CLEAN 85.7%, excluded SOLO 4.9% / M/T 4.5% /
pegging-femdom 3.7% / M/M 1.2%. Every bucket was hand-verified on examples (ニューハーフ竿アリ
男の娘 -> M/T; ゲイ動画男同士 -> M/M; アナルオナニー個撮 -> solo; 前立腺/フィスト -> femdom).
Sellers whose catalogues are majority-solo (フェチ倶楽部マンジリ, 31/40 solo) are effectively
retired by tier 2 without a seller ban.

**Tier 3 - detail-page tag check (runs on the already-budgeted detail fetch).** fc2cmadb
article tags carry orientation vocabulary the title hides: sampled pages show M/M items tagged
GMPD / ケツワレ / ガチムチ and M/T items tagged 竿あり, 玉アリ, メス男子, オトコノコ, 女装,
shemale. Hard-exclude when any article tag is in the orientation tag set. This catches items
with innocuous titles from mixed sellers.

### 11.2 Precision blocklist (from the manual mistag review of all 318 seed rows)

The review flagged 26 titles with a broad suspect lexicon and manually read every flag:
~97-98% of the cut is genuine M/F anal; true mistags are 5-8 rows. Encode as v1:

- **Seller-level:** ハメ撮りランキング fails the activity test (11.1) anyway - no special
  case needed. Kerberos rows pass through the tier-2 femdom lexicon like everything else.
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

### 11.5 Alias tags - union crawl (REVISED 2026-09-25 late evening)

The alias listings (アナルファック, アナル中出し, 尻穴, ケツ穴, 肛門, 2穴, 二穴) are polled in
the cheap listing tier alongside アナル, for ALL sellers - no whitelist gate (see 11.1). Items
from any in-union listing enter the pipeline and pass the orientation filter (11.1a), safety
screen, censorship gate and blocklists like any アナル item. Noisy aliases (アナルセックス,
アナル拡張) are crawled for seller-activity data but their items pass the same filters; their
M/M/femdom content is removed by tiers 1-3, not by skipping the tag.
### 11.6 Still open

- **#1 windowDays** (whole history vs rolling 90 days) - with seller whitelisting the
  practical volume is small either way; implement the `windowDays` hook and let Chris flip it.
- ~~#2 the 女装子 tag~~ RESOLVED 2026-09-25: Chris ruled no crossdressing or trans content at
  all - hard exclusion, lexicon extended with ペニ子/ペニクリ.
