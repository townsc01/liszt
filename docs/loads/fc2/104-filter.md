# Load: #104 — filter, admission, precision blocklist

- **Issue:** #104 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §3, §11.1, §11.1a, §11.2.
- **Wave:** 1. **Depends on:** #103 merged (its crawl output shape and fixtures).
- **Branch:** `fc2-104-filter-admission`
- **Owns:** `src/fc2/filters.js` (new), `test/fc2-filter.test.js`

## Input

The raw records from #103's `src/fc2/cmadb.js`. No adapter, no sync, no UI.

## Task 1 — section 3 gates (owned here, not in #103)

Apply in order, and **log every exclusion with its reason**. Nothing is silently
dropped.

1. **Safety screen — hard block, before anything is displayed, on every sync.**
   - Japanese: JK, 女子校生, 女子高生, 高校生, ロリ, 未成年, 監禁, 昏睡, 盗撮, レイプ
   - English: loli, underage, schoolgirl variants
   - 18歳 / 19歳 stated ages are legal adults and **stay**. Genre words (人妻, 素人,
     個人撮影) are normal FC2 vocabulary and **stay**.
   - The 2026-09-24 run excluded 5 items this way: 4617344, 4620082, 4618128, 4584815,
     4558028. Use them as fixed regression rows.
2. **Censorship gate.** Keep only `censored === 無`.
   - `有` → exclude.
   - Mixed badge `通常版：有 特典版：無` → exclude, log (32 in the 2026-09-24 run).
   - `null` → **pending, not rejected**. The item is held and re-checked; re-check for up
     to 7 days from first seen, then drop. 7,583 of the 8,891 walked items were unbadged;
     most old items are never marked.
   - empty badge → skipped (1 item: 4867926).
3. **Trans / crossdress backstop — hard block, no reinstatement path** (Chris, 2026-09-25).
   Exclude on title **or** tag: ニューハーフ, 女装子, 女装, 男の娘, シーメール, ペニ子,
   ペニクリ, or English shemale/trans. The 2026-09-24 run excluded 2: 4362199 (title says
   ニューハーフ) and 2229202 (innocuous title, tagged 女装子) — the tag-only case is the
   regression test that matters.

## Task 2 — section 11.1 activity-based seller admission

This replaces the earlier fixed whitelist. No hand-maintained list.

- A seller (`writer`) is admitted when it has **>= 3 releases in the trailing 90 days
  across the union** of tags.
- It goes dormant after **180 days** without an in-union release: existing rows stay,
  polling for that seller stops. One new release re-activates it.
- Recomputed every sync from the listing tiers.
- **All** sellers' alias listings are polled; an item enters the pipeline from any
  in-union listing regardless of seller, then passes every filter.

## Task 3 — section 11.1a orientation filter (no pegging, no M/M, no M/T, no solo)

Three tiers, cheapest first. Every exclusion is logged with the matched term and seller.

**Tier 1 — seller classification from listing data only, zero extra fetches.** From the
titles of a seller's crawled union items (minimum 3 titles), exclude the seller when
**> 50%** hit:
- M/M lexicon: ガチムチ, ラガーマン, ノンケ, ゲイ, ホモ, 男同士, 体育会, GMPD, ケツワレ, マッチョ
- M/T lexicon: ニューハーフ, 女装子, 女装, 男の娘, シーメール, shemale, ペニ子, ペニクリ,
  メス男子, 竿あり, 玉アリ, オトコノコ, 兜合わせ

Measured on the 728-item alias crawl this cleanly ejects イケメン専門美男倶楽部 (5/5 M/M),
アナール大佐 (21/22 M/T), コスプレ女装 Akina Films, ペニ子. All eight day-one studios
classify clean. Sellers with fewer than 3 titles are not classified at this tier.

**Tier 2 — item title lexicon, listing data.**
- M/M and M/T lexicons as above (M/T is identical to the hardened section-3 rule).
- Pegging / femdom: ペニバン, 逆アナル, 逆アナ, 女王様, M男, 前立腺, 男の潮吹き, フィスト.
  Note フィスト also fires on the in-scope F-receiving fisting case (e.g. ブロッケン) —
  Chris confirmed 2026-09-25: leave it as is.
- **Solo lexicon with the M/F co-occurrence rescue** (this rescue is load-bearing):
  オナニー, 自撮り, シャワー, 入浴, 風呂 are excluded **only when no** co-occurrence term
  is present — 中出し, チンポ, ハメ, 貫通, 挿入, セックス, ファック, 性交, AF, フェラ, 射精,
  3P, 二穴/2穴. Straight scenes routinely mention toys and shower.

Measured on the 728-item alias crawl: CLEAN 85.7%, excluded SOLO 4.9% / M/T 4.5% /
pegging-femdom 3.7% / M/M 1.2%. That distribution is your regression target.

**Tier 3 — detail-page tag check** on the already-budgeted detail fetch. Hard-exclude
when any article tag is in the orientation tag set (GMPD, ケツワレ, ガチムチ, 竿あり,
玉アリ, メス男子, オトコノコ, 女装, shemale). This catches innocuous-titled items from
mixed sellers.

## Task 4 — section 11.2 precision blocklist

- **Softcore lexicon:** exclude rows whose titles match the solo/shower patterns (オナニー,
  シャワー, 入浴, 自撮り) **unless** an M/F co-occurrence term is present (中出し, チンポ,
  ハメ, 貫通, 挿入, アナルSEX).
- **Seller-level:** no special case — ハメ撮りランキング fails the activity test anyway;
  Kerberos rows pass through the tier-2 lexicon like everything else.
- **Log every blocklist exclusion with the matched term and seller.**
- Lexicon v1 was derived from one manual pass over the 318 seed rows. Expect one or two
  tuning rounds on live sync data; do not tune it against the seed in this load.

## Tests — `test/fc2-filter.test.js`

Driven off `fixtures/fc2cmadb/` and the recovered seed CSV, no network:

- the five safety-screen video_ids and both trans video_ids, by id, as fixed rows.
- badge matrix: 無 kept, 有 excluded, mixed excluded, null → **pending (not dropped)**,
  empty → skipped; badge flipping null → 無 on re-check promotes the item.
- seller admission: 2 in 90d not admitted, 3 admitted, 181-day silence dormant, a new
  release re-activating.
- tier 1: a 5/5 M/M seller excluded, a 2/5 seller kept, a sub-3-title seller unclassified.
- tier 2: each lexicon bucket, plus the **co-occurrence rescue** in both directions (solo
  term alone excluded; solo term + 中出し kept).
- tier 3: tag-only orientation hit excluded even with a clean title.
- every exclusion path produces a log entry naming the matched term and the seller.

## Acceptance

- `npm test` green.
- The filter is a pure function of its input — no I/O, no clock, no global state. That is
  what lets #108 replay it over fixtures.
- No adapter, no sync change, no UI.
- PR body: `Part of #64`, agent + model, and the exclusion-bucket counts you measured
  against the fixtures, compared with the spec's numbers.

## Comment on the issue at start

> Claiming #104 on top of #103. Implementing §3 gates, §11.1 activity admission,
> §11.1a tiers 1-3 and the §11.2 blocklist as a pure, I/O-free filter module so #108 can
> replay it over fixtures. Every exclusion logs its matched term and seller. Working as
> <agent> / <model>.
