# Load: #112 — per-lane matcher contract (the opt-in half)

- **Issue:** #112. Spec: `docs/specs/link-sources.md` §"Per-lane matcher contract".
- **Wave:** 2. **Depends on:** nothing. Independent of all FC2 code.
- **Branch:** `112-lane-matcher-contract`
- **Owns:** `src/catalogue.js`, `src/sync.js`, `src/sxyprn.js`, `test/matching.test.js`

**Start this load first in wave 2.** It is small, it is independent, and it is the long
pole for #107: without it FC2 can only opt out of matching, never declare its own rule.

## What exists today

`src/catalogue.js:21-23` reads exactly one matcher value:

```js
// Per-lane matcher contract (docs/specs/link-sources.md): `matcher: null` declares a
// metadata-only lane, so the record rides with matching disabled and sync skips it.
...(adapter.matcher === null ? { videoMatching: false } : {}),
```

and `src/sxyprn.js:181-186` honours it by skipping tube resolution for those scenes.
That is the whole opt-out half, landed by PR #111 (madouqu). The spec also defines:

- **matcher**: the module that maps the lane's scene records to tube candidates
  (western studios: the cascade against sxyprn + eporner; FC2: exact PPV-code identity).
- **identity**: the lane's match condition (the cascade's stage-3 gate for western
  studios; exact code-in-title for FC2).

Sync must consult the lane's declaration before matching anything. That is the half
that does not exist.

## Deliver

1. A lane adapter may declare a matcher and its identity rule, and sync dispatches to it
   per scene instead of running the global cascade.
2. The three declaration cases stay distinguishable and must all be covered by tests:
   - `matcher: null` → metadata-only, no tube resolution (existing madouqu behaviour).
   - no declaration → the global sxyprn + eporner cascade, unchanged.
   - a declaration → that matcher and identity rule, for that lane's scenes only.
3. The western studios' default path is byte-for-byte unchanged in behaviour.

## Where the work lands

- `src/catalogue.js:11-24` — stamp the declaration onto the scene next to the existing
  `videoMatching` flag. A non-null `matcher` value is currently discarded, so today
  there is no path for it to reach the matcher layer.
- `src/sxyprn.js:181-186` — the skip point; and `enrichStoredCatalogue` (the fan-out
  around `src/sxyprn.js:224-249`) — the dispatch point. Watch out: the eporner fallback
  is a **single global `fallbackLookup`** supplied by the caller, and it is only reached
  when sxyprn produced nothing. A lane that wants the eporner co-lane must not be
  swallowed by the western sxyprn cascade first.
- `src/server.js:138-147` — where that fallback lookup is constructed, if the lane
  matcher needs its own.

Design the declaration so #107 can register an exact-code matcher without touching
`src/sync.js` again. Do not hardcode an "fc2" branch in shared code.

## Acceptance criteria (from the issue)

- A lane declaring a matcher has it consulted by sync.
- A lane declaring `null` is still skipped. The existing regression coverage in
  `test/madouqu.test.js` must keep passing unmodified.
- A lane declaring nothing gets the global cascade.
- `npm test` green.

## Hard constraints

- **Do not weaken, bypass, or reorder any gate in `src/matching.js`.** The cascade is the
  only admission gate in every pass; passes differ in query breadth, never in the gate.
  Review watches these files. If a lane identity rule looks weaker than the gate, bring
  it to the issue rather than implementing it.
- A lane matcher may change *which* candidates are considered. It may not admit a
  candidate the gate would reject.

## Tests

Extend `test/matching.test.js` (and `test/madouqu.test.js` only to add coverage, never to
change existing expectations):

- three synthetic lanes — declared matcher, `matcher: null`, undeclared — each asserting
  which lookup function was and was not called.
- the declared matcher is not consulted for another lane's scenes.
- the global cascade's existing behaviour for a western studio is unchanged.

## Handoff

Post on #112: the PR link, the chosen declaration shape (what the adapter field looks
like and what gets stamped on the scene), and the dispatch point. #107 is written against
that shape, so state it explicitly — it is the contract.

PR body: `Part of #64`, agent + model, and the three declaration cases you verified.
