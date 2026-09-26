# Load: #108 — FC2 acceptance baseline

- **Issue:** #108 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §3
  (crawl ledger), §8, §9. **This load closes #64.**
- **Wave:** 5. **Depends on:** all seven other loads merged.
- **Branch:** `fc2-108-acceptance-baseline`
- **Owns:** `test/fc2-acceptance.test.js`, `data/seeds/fc2-*` (baseline CSV)
- **Reads (do not edit):** `src/fc2/*`, `src/studios/fc2.js`, the recovered seed

## The acceptance criterion changed, and the issue must be updated

The issue as written says "row-for-row equality on `fc2_video_id`". **That is
unreachable**, and the reason is structural, not a matter of effort:

- The 318-row seed is a **tag-47-only** cut, produced by the 2026-09-24 crawl under the
  §3 rules alone.
- The shipped pipeline **also crawls 8 alias tags** (§11.5), which by measurement carry
  whole active studios the tag-47 crawl was blind to (5 sellers net-new in the 5-page
  sample alone). It produces rows the seed cannot contain.
- The shipped pipeline **also applies the orientation filter and the precision blocklist**
  (§11.1a, §11.2) — and those lexicons were derived **from those same 318 rows**, by
  reading all 318 and flagging 26 for manual review. Applying them drops 5-8 of the seed
  rows by design.

Agreed with Chris 2026-09-26: **re-baseline against a refreshed union crawl.** Record the
change as a comment on #108 and on #64 before the PR, so the queue history carries it.

## Acceptance, as re-defined

An automated check that replays the committed fixtures through the whole pipeline — no
network, no live crawl, deterministic:

1. **Coverage.** Every `fc2_video_id` in the 318-row seed is accounted for with the same
   keep or exclude decision, and each exclusion carries a reason.
2. **Reconciliation.** The kept set equals the seed minus exactly the rows excluded by
   §11.1a / §11.2, with the drop list as a **committed data file** (`data/seeds/`), never
   an inline magic list inside the test. Each entry names the video_id, the matched term,
   and the reason, so a future lexicon change shows up as a diff on that file rather than
   as a mysteriously edited expectation.
3. **Ledger.** The §3 buckets reproduce from the recorded fixtures: censored (有) 950,
   trans/crossdress 2, safety screen 5, mixed badge 32, badge-empty 1 (video 4867926),
   and the tag-47 walked total 8,891 over 297 listing pages.
4. **A refreshed union-crawl baseline.** Once #103's crawler and #104's filter are merged,
   run the backfill over the union listings once, commit the result as the new baseline
   CSV, and make **that** the equality target going forward. Document in the CSV's
   accompanying notes how it was produced and when.
5. **Link resolution.** Using the sample of matched codes posted on #107, assert those
   scenes carry an eporner `videoUrls` entry with a source tag, and that a near-miss code
   carries none.

## Tests — `test/fc2-acceptance.test.js`

- Replay: walk the recorded fixtures through #103's crawler and #104's filter, in
  pipeline order, with a fixed clock and the recorded item set.
- Assert 1 with a per-id reason table, so a failure names the video_id.
- Assert 2 by comparing against the committed drop list, and fail with a readable diff
  when the two disagree.
- Assert 3 on the ledger buckets.
- Assert the 90-day window behaviour for the lane: `windowDays` keeps its default
  (`withinRollingWindow` is applied with 90 days by `src/sync.js`; note that
  `adapter.windowDays` is currently declared but **not read** by sync — do not "fix" that
  here, it is out of scope for this lane).

## Hard constraints

- **Never depend on a live crawl.** The full backfill is ~20 hours at the safe rate
  (8-9s per detail page). Nothing in CI may call fc2cmadb.
- Do not retune the filter to make the numbers match. If a bucket diverges from the
  spec, that is a finding: report it in a comment on #108, and decide the correction
  yourself — either the filter or the recorded expectation is wrong, and you say which
  and why. Never encode a divergence as a silent expectation.
- One new CSV plus a new test file. No production-code changes in this load — if the
  pipeline needs a seam to be replayable, raise it on the owning issue.

## Acceptance

- `npm test` green, with the replay deterministic across repeated runs.
- The refreshed baseline CSV is committed with a note on how and when it was produced.
- **Close #64** from this PR's description.
- PR body: `Part of #64`, `Fixes #64`, agent + model, the re-baselined acceptance and the
  reason for it, the ledger numbers you reproduced, and every load-bearing decision in
  this close-out.

## Comment on the issue at start

> Taking #108 as the integration cut. The stated criterion — row-for-row equality against
> the 318-row seed — is unreachable: that seed is a tag-47-only §3-only cut, while the
> shipped pipeline adds the 8-tag union crawl (§11.5, net-new sellers the tag-47 crawl
> could not see) and the orientation filter and blocklist (§11.1a/§11.2) that were
> derived from those same 318 rows and drop 5-8 of them by design. Per the 2026-09-26
> decision, #108 re-baselines: replay the committed fixtures, reconcile every seeded id
> against a committed drop list, reproduce the §3 ledger, and generate one refreshed
> union-crawl CSV as the live baseline. Closing #64 from this PR. Working as <agent> /
> <model>.
