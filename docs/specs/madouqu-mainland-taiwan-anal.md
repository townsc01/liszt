# Lane spec: Taiwan/mainland releases (male-on-female anal) via madouqu.com

> **Status: FINAL spec, 2026-09-26.** Scope: metadata/catalogue lane only - no playback
> links, no video embeds (see section 6; the playback-source question is a separate later
> decision). Written 2026-09-25 from the full-site recon (2026-09-23), the filtered catalogue
> run (2026-09-24), and the tube-findability measurement (2026-09-25). Codex implements from
> this document.

## 1. Goal

Add a **mainland/Taiwan lane** to Liszt: releases from the Chinese-studio aggregator
madouqu.com that match Chris's interest filter, kept current by ongoing sync, shown in the
existing watchlist UI with English display titles.

The filter, in Chris's words (2026-09-25): **male-on-female anal penetrative sex only.**
Not anal play (toys, plugs, fingering, enemas, fisting without penetration); no trans content
(already excluded). This is exactly the `content_type = "anal sex"` cut of the 2026-09-24
catalogue run - **151 rows** of the 163-row v2 file (committed here as
`data/seeds/madouqu-anal-2026-09-24.csv`; the 12 play-only rows are kept in the CSV for
reference and must be filtered out by the lane). Ongoing sync keeps pulling new matching
releases after the initial import.

## 2. The source: madouqu.com

A WordPress aggregator cataloguing mainland Chinese and Taiwanese adult labels. The 2026-09-23
recon walked **~9,233 posts** through its **open WordPress REST API** - no scraping of HTML
needed, no auth, no rate-limit incidents at polite pacing.

- **Posts:** `GET /wp-json/wp/v2/posts?search=<term>&orderby=date&order=desc&per_page=100&page=N`
  - `per_page` maxes at 100; total counts come from the `X-WP-Total` / `X-WP-TotalPages`
    response headers; stop when a page returns fewer than 100 or empty.
  - Each post carries: `id`, `date` + `date_gmt`, `slug` (the studio's own release code,
    e.g. `xb6340`), `link` (canonical page, e.g. `https://madouqu.com/video/xb6340/`),
    `title.rendered` (Chinese), `content.rendered`, `excerpt.rendered`,
    `categories` (ids), `tags` (usually empty), `featured_media`, and
    `jetpack_featured_media_url` (a usable thumbnail URL).
  - **The `search` parameter matches title AND content.** Content mentions terms constantly
    (descriptions, magnet links), so every search result MUST be re-filtered against the title
    only. Search is just a pre-filter to keep the walk cheap; the title lexicon (section 3) is
    the actual gate.
- **Categories = labels:** `GET /wp-json/wp/v2/categories?per_page=100` returns the label list
  with `id`, `name` (Chinese), `slug` (pinyin-ish), and `count`. 43 categories as of 2026-09-25:
  杏吧传媒/xb (6,305 posts), 糖心VLOG/tx (4,425), 星空无限传媒/xk (1,141), 蜜桃传媒/peachmedia
  (1,080), 天美传媒/tm (731), 果冻传媒/gd (618), 精东影业/jd (550), 爱豆传媒/id (443),
  大象传媒/dx (259), 皇家华人/hjhr (410), 草莓视频/cm (158), JVID/jvid (100), HongKongDoll/hkd
  (87), plus a long tail. The category id on a post is the label attribution; the slug prefix of
  the post slug corroborates it (`xb6340` -> 杏吧).
- **The corpus spans 2021-02-15 to today.** Labels release near-daily; a nightly sync is plenty.

## 3. The filter (exact rules)

Apply in order; log every exclusion with its reason.

1. **Safety screen (hard block, before anything is shown).** Title checked against the
   minor/coercion lexicon on every sync; any match -> exclude and log for human review.
   - Chinese: 萝莉, 幼女, 未成年, 初中, 小学, 迷奸, 强奸, 昏迷, 偷拍
   - The v2 run verified the 163-row file contains zero 萝莉 titles (the one that existed was
     already removed in the plug-only cleanup). 人妻/调教/SM/母狗 vocabulary is genre convention
     for these labels and stays.
   - *Open question #3 (section 9): incest-roleplay titles (母女/姐妹/小姨子 etc.) exist in the
     corpus and are currently NOT filtered. Chris to rule.*
2. **Trans/gay exclusion.** Title contains 伪娘, 人妖, TS, ladyboy, 男男, 耽美 -> exclude.
   (This corpus is overwhelmingly male-on-female; the rule is a backstop. Chris confirmed trans
   is already excluded.)
3. **Anal gate.** Title matches at least one anal term:
   **肛交, 后庭, 屁眼, 肛门, 三通, 爆菊, 爆肛** (the exact set used in the 2026-09-24 run;
   hit distribution across the 163 rows: 肛交 72, 爆菊 40, 屁眼 33, 肛门 19, 后庭 11, 三通 10).
4. **Penetrative-only gate (Chris's 2026-09-25 narrowing).** Classify the match:
   - **Keep ("anal sex"):** the title signals penetrative anal intercourse - 肛交, 爆菊, 爆肛,
     三通 (triple penetration, includes anal by definition), or 后庭/屁眼/肛门 combined with sex
     verbs (操, 干, 插, 内射, 爆草...) rather than play nouns.
   - **Drop ("anal play"):** the only anal content is play/toys - 肛塞 (butt plug), 肛钩,
     灌肠 (enema), 指奸 (fingering), 拳交 (fisting), 跳蛋 (vibrator), 钢球 (balls), 扩张, 塞.
   - The 2026-09-24 run's judgment calls, kept as worked examples:
     - 68418 `母狗三通后的捆绑肛塞玩具震逼调教` - KEPT: 三通 implies anal sex despite the plug.
     - 64342 `肛塞调教大一蜜臀母狗羞耻屁眼跪着吞吐肉棒` - KEPT but borderline (possibly plug + oral
       only); the row to drop first if Chris wants a stricter cut.
     - 6 plug-only rows removed in v2 (90505, 75872, 75863, 74257, 69565, 46015).
   - Rule of thumb for Codex: when a title contains both a play term and 三通 or a clear
     penetration verb, keep; when only play terms, drop; log every borderline call.

### Acceptance baseline

The lane's initial backfill must reproduce the seed CSV's `content_type = "anal sex"` rows:
**151 rows** (杏吧传媒 116, 糖心VLOG 21, 麻豆传媒 9, 草莓视频 2, JVID 1, 精东影业 1, 大象传媒 1),
plus whatever new posts have appeared since 2026-09-24.

## 4. Data model

One new **lane adapter**, `src/studios/madouqu.js` - but note the contract gap below.

| Liszt field | Source | Notes |
| --- | --- | --- |
| `id` | `madouqu:<post id>` | Post ids are stable. |
| `sourceSceneId` | post `id` | |
| `title` | English display title when translated, else Chinese original | See section 5. |
| `originalTitle` *(new optional field)* | `title.rendered` verbatim | Canonical. |
| `releaseDate` | `date_gmt`, YYYY-MM-DD | Caveat: this is the aggregator's post date, close to but not always the label's release date. Accept the approximation; record both `date`/`date_gmt` in provenance. |
| `performers` | `[]` | The aggregator doesn't structure performer data; 麻豆女郎 names sometimes appear in `excerpt.rendered` - optional future parsing, never guessed. |
| `thumbnailUrl` | `jetpack_featured_media_url`, else resolve `featured_media` via `/wp-json/wp/v2/media/<id>` | |
| `releaseUrl` | post `link` | |
| `source` / `provenance` | madouqu + REST URL + post link + post id | |
| `studioCode` *(new optional field)* | post `slug` (e.g. `xb6340`) | The label's own release code - the corpus's most useful join key for future sources. |
| `tags` *(new optional field)* | English content labels derived from the lexicon match (`anal`) | The site doesn't tag usefully. |

**Per-label studios: DECIDED (Chris, 2026-09-25).** Chris ratified the per-label design: "tighten
up the watchlist population and have it name the individual studios instead of generic
'ModelMedia'." The generic label he cited IS the flattening bug - "ModelMedia" is the
romanisation of one category (麻豆传媒, slug `modelmedia`, 4,296 posts) being applied across the
lane. The fix: a scene carries its own `studioId`/`studio`, with `validateResult` defaulting to
the adapter's identity only when absent. The lane adapter emits one studio per category
(`studioId: "madouqu-" + category slug`, `studio:` English label name - see the romanisation
table in section 5). The categories endpoint grounds 43 labels with per-label post counts
(杏吧传媒 6,305; 糖心VLOG 4,425; 麻豆传媒 4,296; 星空无限 1,141; 蜜桃传媒 1,080; ...), so the
watchlist can group and filter by real label from day one. Small, backward-compatible change to
`src/catalogue.js`; the five existing adapters are unaffected.

**Same architecture as FC2, same source independence (Chris, 2026-09-25):** like the FC2 lane,
this lane polls its own database (the madouqu WP REST API), never TPDB. Studio identity,
release codes, and dates all come from the lane's own source; TPDB enrichment does not apply.

**Window: DECIDED (Chris, 2026-09-25) - 90 days.** The optional `windowDays` contract field
(default 90) applies with its default; no unlimited exception for the Asian lanes.

**Performers: DECIDED (Chris, 2026-09-25) - ship empty.** Performer lists stay `[]` in v1;
excerpt parsing for 麻豆女郎 names is a separate subsequent-release PR, not part of this lane.

**Label naming: DECIDED (Chris, 2026-09-25) - ad-hoc cheap LLM translation.** No fixed 43-row
romanisation table: label display names are produced on demand by a cheap LLM translation pass
when a new category id first appears, then cached on the studio record. The seed table in
section 5 stays as a cache warm-start for the top labels; unknown labels get LLM-named once and
logged, never silently guessed twice.

## 5. Chinese -> English titles and label names

Same architecture as the FC2 lane (canonical original + English display + provider marking);
only the language and dictionaries differ.

- **Title translation:** glossary pass for the heavy genre vocabulary (人妻 = wife/married woman,
  极品 = top-tier, 调教 = training, 淫荡 = slutty, 母狗 = "bitch" genre slang, 白丝 = white
  stockings, 黑丝 = black stockings, 空姐 = flight attendant, 约炮 = hookup, 内射 = creampie,
  吞精 = swallowing, 喷水 = squirting, 群交/4P/3P = group/foursome/threesome, 爆菊 = anal,
  三通 = triple penetration, ...) plus the optional LLM pass with the same failure fallbacks.
  Chinese genre titles compress heavily; when a rendering would be gibberish, prefer a plain
  faithful translation over a fluent invention, and mark it.
- **Label romanisation table** (for `studio` display names; extend as labels appear):

  | Chinese | slug | Display |
  | --- | --- | --- |
  | 杏吧传媒 | xb | Xingba Media |
  | 糖心VLOG | tx | Tangxin VLOG |
  | 麻豆传媒 | (madou) | Madou Media |
  | 蜜桃传媒 | peachmedia | Peach Media |
  | 星空无限传媒 | xk | Xingkong Infinite Media |
  | 天美传媒 | tm | Tianmei Media |
  | 果冻传媒 | gd | Jelly Media |
  | 精东影业 | jd | Jingdong Pictures |
  | 爱豆传媒 | id | AiDou Media |
  | 大象传媒 | dx | Elephant Media |
  | 皇家华人 | hjhr | Royal Chinese |
  | 草莓视频 | cm | Strawberry Video |
  | JVID | jvid | JVID |

  Note: 麻豆传媒 (the namesake "Madou") does not appear in the current categories endpoint page
  and its posts were attributed by the run through slug/title analysis - Codex should verify the
  category mapping live and log any label it cannot map instead of guessing.

## 6. Playback: OUT OF SCOPE for this lane (measured 2026-09-25)

**No playback links and no video embeds ship in this lane. Catalogue metadata only.** The
findability measurement settled it: 20 recent releases across 5 labels (xb, tx, m, xkty, pm)
were searched on both tubes - release codes, romanised label names (xingba, tangxin), and
Chinese names (麻豆/杏吧/糖心). Result: **0/20 on eporner, 0/20 on sxyprn**. The only hits were
stale generic noise (179 old PMV uploads under "madou", 7 under "jvid", none label releases).
Neither tube carries these labels in any matchable way, so there is nothing to link or embed.
Adding a playback source (a Chinese-content tube, the labels' own sites, JVID) is a separate
later PR after Chris picks a direction; the lane ships without one.

The one lead worth a follow-up issue (not this PR): `content.rendered` and `excerpt.rendered`
sometimes carry "下载地址：Magnet" with an actual `magnet:` URI in the post body. If Chris wants,
a later branch can extract and store magnet links as the scene's acquisition reference (that
feeds his download stack, not in-app playback). Nothing about playback blocks this lane: the
watchlist value is knowing what exists; rows render with their source-record link only.

Do **not** run the Sxyprn enrichment against this lane (zero expected hit rate, wasted requests);
the per-lane matcher interface from the FC2 spec should make video matching opt-in per lane.

## 7. Sync design (ongoing)

1. **Poll (cheap, hourly-to-nightly).** For each of the 7 anal terms, fetch
   `?search=<term>&orderby=date&order=desc&per_page=100` page 1 (page 2 only when page 1 is full
   of unseen ids). Union by post id. >= 1s between requests.
2. **Title-filter and classify** per section 3. New kept posts become scenes; changed titles
   (compare `modified_gmt`) re-run classification and translation.
3. **Categories refresh** weekly (labels come and go); log unmapped category ids.
4. **Contract semantics.** `verifiedEmpty` only when all 7 searches genuinely return nothing new
   and no error occurred. Last-good retention per the existing behaviour on failure.
5. **Backfill command.** `scripts/backfill-madouqu.mjs`: walk all pages of all 7 terms
   (recon order of ~10-15 minutes at polite pacing), then classify. Acceptance: reproduces the
   151-row strict cut plus delta.

## 8. Seed inventory

`data/seeds/madouqu-anal-2026-09-24.csv` - the 163-row v2 cut (BOM stripped, otherwise verbatim),
newest first. Columns: `date`, `studio` (Chinese label), `post_id`, `title`, `url`,
`content_type` (`anal sex` | `anal play (toy/plug/finger/enema/fisting)`), `matched_terms`.
The lane imports only the 151 `anal sex` rows; the 12 play-only rows are the negative test set -
the classifier must reject exactly them and no kept row.

## 9. Fixtures and test plan

Committed fixtures (real responses captured 2026-09-25):

- `fixtures/madouqu/posts-search-anal.json` - 5 real posts from `?search=肛交` (shape, fields,
  category ids, magnet-mentioning excerpt).
- `fixtures/madouqu/categories.json` - the 43-category label list.

Tests to write:

- REST walk: pagination stop conditions, `X-WP-TotalPages` handling, search-result union by id.
- Title gate: each of the 7 terms matches in titles; content-only mentions are rejected.
- Classifier: the 12 play-only seed rows are rejected; the two documented borderline keeps
  (68418, 64342) stay; 三通 beats a play term.
- Safety + trans lexicons on titles.
- Per-label studio mapping incl. unknown-category logging; contract defaulting unchanged for the
  five existing adapters.
- Translation dictionary + LLM fallback; studio romanisation table coverage for every label in
  the seed.
- End-to-end: backfill against recorded responses reproduces the 151-row cut.

## 10. Rulings and remaining questions

DECIDED (all Chris, 2026-09-25, applied in the sections above):

1. **Window:** 90 days (`windowDays` default, no exception).
2. **Performers:** ship empty; excerpt parsing is a separate later PR.
3. **Label naming:** ad-hoc cheap LLM translation, cached; the section-5 table is a warm start.
4. **Studios:** per-label studios, not a generic flattened label.

Still open (does not block implementation):

1. **Magnets:** worth the follow-up branch that extracts `magnet:` links from post content as
   acquisition references for the download stack? Deferred to a later PR either way.
2. **Incest-roleplay titles** (母女/姐妹-style genre titles): default is NOT filtered (current
   behaviour); Chris can rule later and the lexicon updates without re-architecture.
