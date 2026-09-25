# Roadmap

Build order, with what each phase unlocks. Specs live in `docs/specs/`; each names its own prerequisites in its `Depends on` header. Statuses: **implemented** (merged and live), **in progress** (PR open), **spec'd** (ready for implementation), **queued** (not yet spec'd).

## Phase 1 - Foundations: links and metadata (DONE)

- [Playback link sources](docs/specs/link-sources.md) - **implemented** (#46). Two tube sources (sxyprn primary, eporner supplement), links stored source-tagged on the scene record.
- [Studio-site metadata scraper](docs/specs/studio-site-scraper.md) - **implemented** (#50). Missing TPDB fields scraped from the studio's own release page; provenance-tracked.

Unlocks: playback links as data, complete scene metadata. Everything else builds on these.

## Phase 2 - Matching (IN PROGRESS)

- [Matching algorithm](docs/specs/matching-algorithm.md) - **in progress** (PR #52). The measured identity gate: duration ±2s AND (performer-name OR MMDD-code), trusted-uploader pools for obfuscated titles. 100% precision measured on both tubes.

Unlocks: automatic linking at production precision; the per-lane matcher interface the new lanes need (see cross-cutting note below).

## Phase 3 - Playback UX

- [Sxyprn embed](docs/specs/sxyprn-embed.md) - **spec'd** (proxy mechanism shipped in #38). Server-side mint-and-stream proxy; IP-bound CDN URLs never reach the browser.
- [Eporner embed](docs/specs/eporner-embed.md) - **spec'd**. Iframe playback from the API's embed field; no proxy.

Unlocks: in-app playback for every linked scene, with source fallback.

## Phase 4 - New lanes

- [FC2 lane](docs/specs/fc2-anal-uncensored.md) - **spec'd**. Japanese FC2-PPV releases (anal, uncensored): union tag crawl, activity-based seller admission, orientation filter, glossary+LLM title translation. Playback via exact PPV-code matching against the existing global eporner/sxyprn matchers.
- [Madouqu lane](docs/specs/madouqu-mainland-taiwan-anal.md) - **spec'd, metadata-only**. Mainland/Taiwan label catalogue via the madouqu.com WordPress API. Measured 0/20 findable on both tubes, so no playback ships with this lane; a Chinese-content playback source is a separate later decision.

## Maintenance queue (current)

Issues [#53-#59](https://github.com/townsc01/liszt/issues?q=is%3Aissue+label%3Ainstinct), filed from the merged-PR review sweep. Invocation order: **#54** (92 scenes lost playback in the videoUrls migration - live breakage) alone, then **#56+#57+#58+#59** (scraper cluster) as one task, then **#53+#55** (proxy timeout + pool cache) as one.

## Cross-cutting (from the 2026-09-26 cross-spec audit)

- **Per-lane matcher interface** - assumed by FC2 and madouqu, owned by no spec yet. To be defined in link-sources.md before Phase 4: each lane's adapter declares its matcher and identity rule; sync consults it (today sync matches every scene against the western tubes).
- **Dead-link spot-check** - eporner-embed.md assumes sync re-verifies links; nothing implements it. Owned by link-sources.md, pending.
- **Shared translation module** - FC2 and madouqu both spec a glossary+LLM pipeline; first implementer builds it shared.
- **Single gate** - the matching cascade replaces the legacy 0.75 title-score first pass; passes differ in query breadth, never in the gate (pending Chris's call, audit finding #3).
