# Load: #107 — exact PPV-code playback matching

- **Issue:** #107 (sub-issue of #64). Spec: `docs/specs/fc2-anal-uncensored.md` §6.
- **Wave:** 4. **Depends on:** #112 (the declaration shape it registers against), #113
  (scene records carrying the codes), #103 (code inventory).
- **Branch:** `fc2-107-ppv-code-matching`
- **Owns:** `src/matching-config.js`, `src/matching.js`, `src/eporner.js`, `src/sxyprn.js`, `src/studios/fc2.js`, `test/eporner.test.js`, `test/sxyprn.test.js`

May run concurrently with #105 or #106 — this load touches only matching files, plus the
adapter's declaration.

## The signal

Eporner carries **6,356 videos titled verbatim `FC2 PPV <code>`** (measured 2026-09-25,
plus "Fc2 Ppv" and ".H265" suffix variants), with fresh uploads daily. The FC2 scene's own
PPV code **is** the eporner title, so the code is the search string unchanged. This is
the strongest identity signal the project has ever measured: a verbatim unique identifier
with no name fuzziness. Sxyprn's fit is near-zero (§6) — treat it as best-effort, not
required.

Admission: **exact code-in-title**, plus duration proximity when the source record
carries a duration.

## Two problems in the current code mechanism

`src/matching-config.js` is eight lines:

```js
export const matchingQueryConfig = Object.freeze({
  "mambo-perv": Object.freeze({ sceneCodePattern: /\bOB\d{3,}\b/i }),
});

export function configuredSceneCode(scene) {
  return String(scene.title || "").match(matchingQueryConfig[scene.studioId]?.sceneCodePattern)?.[0]?.toLowerCase() || null;
}
```

1. The code is derived by matching against **`scene.title`**. FC2 titles are Japanese and
   do not contain the code. Build `fc2-ppv-<sourceSceneId>` instead, or carry the code on
   the scene and read that.
2. The lookup key is **`scene.studioId`** (exact). #105's per-seller ids are
   `fc2:<writer.slug>`, so an exact-key lookup misses every real FC2 scene. Prefix
   resolution is required. Coordinate the id separator with #105 and use one form
   everywhere.

Both `src/sxyprn.js` (`buildSxyprnQueries`) and `src/eporner.js` (`buildEpornerQueries`)
already pick the code up from `configuredSceneCode` once it returns a value.

## Deliver

- FC2's exact-code identity registered through the #112 contract, and the adapter's
  declaration flipped from `matcher: null` to it.
- Query construction: the PPV code as the search string, with the case and suffix
  variants handled by the same normalisation the rest of the pipeline uses.
- Admission: exact code-in-title via a lane-supplied `identity` predicate (the hook
  `pickMatch` already exposes at `src/matching.js:89-93`), with the duration gate
  unchanged.

## Hard constraints

- **The cascade in `src/matching.js` remains the only admission gate.** A lane identity
  rule changes which candidates are considered; it must not admit a candidate the gate
  would reject. `.coderabbit.yaml` explicitly watches `src/matching.js`, `src/sxyprn.js`,
  and `src/eporner.js` for gate weakening. Do not add a duration-only or
  code-only admission path that bypasses `pickMatch`.
- A code match is unambiguous, so a tie between distinct uploaders should still resolve
  to `null` as today rather than picking one.
- Server-side only, verified before display, never auto-linked below the confidence
  threshold. Keep `videoUrls` generic and source-tagged so a future eporner revival needs
  no schema migration.

## Tests

- exact code match links the right scene;
- a near-miss code (`FC2 PPV 4981629` against scene `4981628`) resolves to **nothing** —
  this is the precision case and it must be explicit;
- case and `.H265` suffix variants match; a different PPV number never does;
- duration mismatch is rejected when the scene carries a duration;
- an FC2 scene with no `durationSec` matches nothing (`src/matching.js:90`);
- a scene with no code match links to nothing and never blocks the sync;
- western lanes' coverage and behaviour are unchanged (existing `test/sxyprn.test.js` and
  `test/eporner.test.js` pass unmodified).

## Handoff

Post on #107: the PR link, the final id form for per-seller studio ids, the query strings
actually issued, and a sample of matched codes with their eporner URLs. #108 uses the
sample as its link-resolution acceptance anchor.
