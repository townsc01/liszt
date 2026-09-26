# FC2 lane (#64) — dispatch manifest

Work orders for the eight sub-issues of the FC2 lane tracker. One load = one issue = one
scoped PR (AGENTS.md rule 5). Read `AGENTS.md` first, then this manifest, then your load.

Spec (DECIDED items are final): `docs/specs/fc2-anal-uncensored.md`.
Matcher contract: `docs/specs/link-sources.md` §"Per-lane matcher contract".
Execution plan with rationale: `.kilo/plans/1790426503788-fc2-lane-issue-order.md`.

## Loads

| Load | Issue | Wave | Depends on | Owns |
| --- | --- | --- | --- | --- |
| [103-crawler.md](103-crawler.md) | #103 crawler + fixtures | 1 | — | `src/fc2/cmadb.js`, `fixtures/fc2cmadb/`, `data/seeds/fc2-*` |
| [104-filter.md](104-filter.md) | #104 filter + admission | 1 | #103 | `src/fc2/filters.js` |
| [112-matcher-contract.md](112-matcher-contract.md) | #112 matcher contract | 2 | — | `src/catalogue.js`, `src/sync.js`, `src/sxyprn.js` |
| [113-adapter-sync.md](113-adapter-sync.md) | #113 adapter + sync | 3 | #103, #104, #112 | `src/studios/fc2.js`, `src/studios/index.js`, `src/sync.js` |
| [107-ppv-matching.md](107-ppv-matching.md) | #107 exact-PPV matching | 4 | #112, #113, #103 | `src/matching-config.js`, `src/matching.js`, `src/eporner.js` |
| [105-seller-studios.md](105-seller-studios.md) | #105 seller studios UI | 4 | #104, #113 | `public/app.js`, `src/sync.js` |
| [106-translation.md](106-translation.md) | #106 title translation | 4 | #113 (and #111, merged) | `src/translate.js`, `src/translate-run.js`, `public/app.js` |
| [108-acceptance.md](108-acceptance.md) | #108 acceptance baseline | 5 | all of the above | `test/fc2-*.test.js`, `data/seeds/fc2-*` |

## Dispatch order

```
wave 1   #103 ──> #104 ─────────────┐
                                    ├──> #113 ──> #107 ─┐
wave 2   #112 ─────────────────────┘           #105 ───┼──> #108
                                                        └──> #106
```

- Wave 1 and wave 2 may run **concurrently**: they touch disjoint files. #112 is
  independent of all FC2 code and is the long pole for #107, so start it first.
- Wave 3 is strictly serial: #113 is the join point and the only load that makes FC2
  run in production. **#113 must not merge before #104** — it is a one-line
  registration in `src/studios/index.js:9`, so merging it early admits the unfiltered
  union crawl to the real catalogue.
- In wave 4, #107 touches only matching files and may run beside #105 or #106.
  **#105 and #106 must not run concurrently** — both edit `public/app.js`.
- Wave 5 is the integration check; it starts when the other seven have merged.

## File ownership locks

One owner per file at a time. Take the lock, do not edit a file another active load
owns, and do not rebase onto an unmerged branch.

| File | Loads, in order |
| --- | --- |
| `src/catalogue.js` | #112, then #113 (lane-state), then #108 (read-only) |
| `src/sync.js` | #112 (dispatch), then #113 (lane state), then #105 (label retention) |
| `src/sxyprn.js` | #112, then #107 |
| `src/matching.js`, `src/matching-config.js`, `src/eporner.js` | #107 only |
| `src/translate.js`, `src/translate-run.js` | #106 only |
| `public/app.js` | #105, then #106 |
| `src/studios/fc2.js` | #113 creates; then #107, #105, #106, #108 in that order |
| `data/catalogue.json` | #113 only; never commit incidental local changes |

## Unattended operation

This lane runs with no human in the loop. The mayor reviews and merges every PR itself,
resolves every ambiguity itself, and records the decision as a comment on the issue before
continuing. A worker that cannot resolve something within its load **escalates to the
mayor, never to a waiting human** — the issue tracker is the record, and the mayor acts on
it. The only three things that stop the lane rather than proceeding are: a failing safety
screen or trans/crossdress backstop, an irreversible or destructive git action, or a
change that would have to leave this lane's file ownership. A missing
`OPENROUTER_API_KEY` is a contractual degradation path, not a stop.

## Invariants for every load

1. Branch from **latest `main`**, never from a spec branch or a stacked unmerged branch.
2. `npm test` green before requesting review. `npm test` is the only automated PR gate
   (`.github/workflows/test.yml`); there is no lint script.
3. Tests are `node --test` (`test/*.test.js`), fixture-driven, **no network, no
   `OPENROUTER_API_KEY`**. Follow `test/madouqu.test.js` for the conventions.
4. Do not weaken or bypass any gate in `src/matching.js` — code review watches those
   files (`.coderabbit.yaml`). Adding a lane is never a reason to relax admission.
5. Translation is never on the boot or sync path. Sync must not call an LLM.
6. Do not add a second durable store. The durable files are `data/catalogue.json` and
   `data/translations.json`, both committed by `.github/workflows/catalogue-refresh.yml`
   every 6h. A new data file would live only on Render's ephemeral disk.
7. Never run a live full-site crawl in CI. A 20-hour backfill is a manual operation.
8. PR title carries the issue number; the body carries `Part of #64`, the agent and
   model name (AGENTS.md rule 10), and what you verified.
9. Comment on the issue at start, at any load-bearing decision, and at handoff with the
   PR link.
