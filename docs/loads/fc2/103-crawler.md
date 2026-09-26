# Load: #103 — FC2 union-tag crawler + fixtures

- **Issue:** #103 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §2, §3 (crawl mechanics), §9, §11.5.
- **Wave:** 1. **Depends on:** nothing. This is the foundation cut.
- **Branch:** `fc2-103-union-tag-crawler`
- **Owns:** `src/fc2/cmadb.js` (new dir), `fixtures/fc2cmadb/`, `data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv`, `test/fc2-crawler.test.js`

## Task 0 — recover the seed and fixtures (do this first)

The spec calls them committed; they are not on `main`. They live on the closed PR #32
branch at `refs/pull/32/head` = `0a7497064c56d3ad75abd5cfb7858d2aecb238e4`, confirmed to
contain both paths.

```bash
git fetch origin refs/pull/32/head
git checkout 0a7497064c56d3ad75abd5cfb7858d2aecb238e4 -- \
  data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv fixtures/fc2cmadb/
```

Recover verbatim. Do not re-derive, do not "fix" the CSV, do not edit captured fixture
HTML (see `fixtures/README.md`).

While you are there: check whether any CSV field contains a comma or a quote. The
existing test CSV parser convention is a naive `split(",")` (`test/madouqu.test.js:20`).
If FC2 titles contain commas, add a minimal quoted-field parser **in the FC2 test
helper only** — do not change madouqu's parser or the CSV.

## Task 1 — the crawler

`src/fc2/cmadb.js`. Exported named helpers so tests can drive it without a network.

- Inertia page object: parse `<script data-page="app">` from the HTML.
- Route table: parse `const Ziggy = {...}` in-page; the three routes that matter are
  `tags.show` (`GET /tags/{tag_name}`), `article.show` (`GET /articles/{video_id}`),
  `article.latest` (`GET /articles/latest`).
- Tag listing: 30 items/page, cursor pagination via `next_page_url`
  (`?cursor=<base64 JSON>`), `null` on the final page. Each item carries `video_id`,
  `title`, `release_date`, `image_url`, `duration`, `writer { id, slug, name }`,
  `pivot.tag_id`. The `censored` badge is **absent** on listing rows.
- Article detail: full record incl. `censored` (無 / 有 / null), `tags[]` with pivot
  ids, `sale_percentage`, `sale_limite_date` (sic, the API's typo), `not_found`,
  `status`, `bookmark_count`, `like_count`. The `actresses` prop is deferred — fetch it
  only with `X-Inertia: true`, `X-Inertia-Version: <version>`, and the
  `X-Inertia-Partial-*` headers for component `Articles/Show` / data `actresses`. For
  FC2 amateur uploads it is almost always empty; never block on it.
- **Inertia 409:** the `version` hash changes on deploy. On 409, re-fetch the HTML page,
  read the new version, retry. Do not hardcode a version.

### Union tag set (§11.5)

Core: アナル (tag id 47). Aliases: アナルファック, アナル中出し, 尻穴, ケツ穴, 肛門, 2穴,
二穴. Noisy aliases crawled for seller-activity data only: アナルセックス, アナル拡張.
Export the tag set as a named constant.

### Pacing and rate limits (§2, measured 2026-09-24)

- Detail pages: **one per 8-9 seconds**. Faster returns HTTP 429 with a 30-60 minute ban.
- Listing pages: **at least 2 seconds** between fetches.
- The pacing must be **injectable** (a sleep function and a clock) so tests assert the
  spacing without waiting. Model it on `createJsonFetcher` in `src/studios/madouqu.js`.
- Any non-429 non-OK response throws, so the caller keeps last-good data.

## Scope boundary

**Raw extraction only.** No filter logic in this load — no safety screen, no
censorship gate, no trans backstop, no orientation filter, no blocklist. Each lexicon
is implemented exactly once, in #104. You may parse and surface the raw fields the
filter will need (all tags, the badge, the writer).

## Tests — `test/fc2-crawler.test.js`

Fixture-driven, injected `fetchImpl`, no network:

- listing parser: 30 items, `next_page_url` cursor extracted, final page's `null` cursor.
- detail parser: `censored` 無 / 有 / null, tags with pivots, sale fields, `not_found`.
- 409 on the partial reload → page re-fetched, new version used, request retried once.
- pacing: detail fetches are spaced at least the configured 8s (assert on recorded
  request times with an injected clock; no real waiting).
- 429 → the fetcher stops the tier and surfaces the error rather than retrying hot.
- a full listing walk over the fixtures terminates and never loops on a repeated cursor.

## Acceptance

- `npm test` green; new file included by the existing glob.
- Seed and fixtures present in the PR, byte-identical to `0a74970`.
- No filter logic, no adapter, no registration in `src/studios/index.js`.
- PR body states: `Part of #64`, the recovery commit for seed/fixtures, agent + model
  name, and the test counts you verified.

## Comment on the issue at start

> Claiming #103. Branch `fc2-103-union-tag-crawler` off latest main. Recovering the seed
> and both fixtures verbatim from `refs/pull/32/head` (0a74970), then building
> `src/fc2/cmadb.js` as raw extraction only — filter logic stays in #104 so each lexicon
> is implemented once. Working as <agent> / <model>.
