# Load: #106 — FC2 Japanese to English title translation

- **Issue:** #106 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §5, §11.4,
  plus the boot-path contract in #64.
- **Wave:** 4. **Depends on:** #113 (FC2 scene records). The shared module dependency
  (#111 / madouqu, `src/translate.js`) is **already merged on main** — `d3390a2`.
- **Branch:** `fc2-106-translation`
- **Owns:** `src/translate.js`, `src/translate-run.js`, `src/studios/fc2.js`, `public/app.js`, `test/translate.test.js`

**Do not run this load concurrently with #105** — both edit `public/app.js`. #107 may run
alongside it.

## The contract, verbatim from #64 (Chris, 2026-09-26)

> Translation is NEVER in the boot or sync path. Boot/sync serves untranslated titles
> immediately; translation backfills in the background, batched (many titles per LLM
> call, not one call per title) and glossary-first (glossary hits never touch the LLM).
> Boot must not take 13 minutes querying an LLM 400 times for Japanese and Mandarin
> translations. Translations must also persist DURABLY — committed catalogue data or an
> external store, never only Render's ephemeral disk — or every cold boot re-derives them.

Clean degradation is contractual: **missing `OPENROUTER_API_KEY` → glossary-only pass,
provider `untranslated`, no error banner, no sync failure.**

## Two things in the shared module are currently Chinese-specific

1. **The prompt is hardcoded to Chinese** — `src/translate.js:54-62` opens with "Translate
   these Chinese adult-content genre titles into English", and the system message at
   `src/translate.js:111` is generic. Parameterise the prompt by the source language so
   the madouqu behaviour is byte-identical and FC2 gets Japanese.
2. **The default glossary is madouqu's.** `src/translate-run.js:11` imports
   `TITLE_GLOSSARY` from `./studios/madouqu.js` and uses it as the default at
   `src/translate-run.js:33` and `:73`. Make the default lane-aware, deriving the glossary
   from the scene's own studio prefix, without changing madouqu's results.

The glossary itself is already injectable per call, so the FC2 dictionary goes in
`src/studios/fc2.js` (or a module it owns) and is supplied by the lane.

## Task 1 — the FC2 glossary

§5 stage 1, the offline pass that always runs. FC2 titles are formulaic, so the
dictionary is the functional filter vocabulary, not prose. The spec's examples:
【個人撮影】 = amateur shoot, 無修正 = uncensored, 初アナル = first anal, アナルSEX = anal
sex, 中出し = creampie, 素人 = amateur, 人妻 = married woman, ・25歳・ = age 25, Cカップ = C
cup.

Tags get a fixed Japanese-to-English map (§5): アナル → anal, 中出し → creampie,
素人 → amateur, 個人撮影 → amateur shoot, フェラ → blowjob, 巨乳 → big tits, 美乳 → nice
tits, パイパン → shaved, 潮吹き → squirting, 3P → threesome, ハメ撮り → POV/gonzo, …
**Unknown tags pass through in Japanese so no information is lost.** The safety lexicon
in §3 runs on the *original* tags, before mapping — do not reorder that.

## Task 2 — the LLM pass

Behind the env flag, one batched call per run (the existing `DEFAULT_BATCH_SIZE = 20`
batching already does this), strict prompt: translate, keep ages/numbers/codes exact, no
emblemishment, output JSON. Cache by `video_id` forever. **On any failure fall back to
the glossary output, then to the Japanese title.** Translation must never block or fail a
sync.

## Task 3 — the record and the UI

- `titleTranslated: true|false` and `translationProvider` (`glossary` | `llm:<model>` |
  `none`) on the scene record. Machine output is always marked.
- `originalTitle` is the canonical text, never overwritten. `title` holds the English
  rendering when one exists. **Identity is always `video_id`** — translation never
  affects identity, dedupe, or change detection.
- The durable store is `data/translations.json`, committed by
  `.github/workflows/catalogue-refresh.yml` (PR #109, issue #89 done). **Reuse it. Do
  not build a second store.** A new file would live only on Render's ephemeral disk.
- `public/app.js`: render `originalTitle` as a secondary line with `lang="ja"` when it
  differs from `title`, so a translation can be sanity-checked against the source.
  **Search must match both fields.** No other UI change.
- Change detection from #113: a changed title updates `originalTitle` and invalidates
  the cached translation.

## Tests — `test/translate.test.js`

No network, no API key. Inject a fake `fetchImpl` (the existing pattern in that file).

- the FC2 glossary renders the formulaic patterns and is a pure offline pass — **zero LLM
  calls** for a fully-glossary-resolved title;
- a title with residual Japanese goes to the LLM and comes back marked `llm:<model>`;
- an LLM failure degrades to glossary output, then to the Japanese original, and never
  throws;
- **missing `OPENROUTER_API_KEY`**: glossary-only, provider `untranslated`, no throw, and
  the scene is not cached as translated so adding a key later retries;
- **the boot path**: `sync()` with FC2 scenes never issues an LLM request — assert on the
  fake fetch's recorded calls;
- **durability**: a second `translateStoredCatalogue` run over the same temp catalogue
  issues no further LLM calls, and the cache survives a fresh read from
  `data/translations.json`;
- madouqu's existing translation results are unchanged by the prompt/glossary
  parameterisation.

## Acceptance

- `npm test` green, with madouqu coverage passing unmodified.
- Translation demonstrably off the boot and sync path; evidence in the PR body (recorded
  LLM call counts during a `sync()` run).
- PR body: `Part of #64`, agent + model, the glossary source, the prompt parameterisation
  you made, and the degradation behaviour you verified with the key absent.
