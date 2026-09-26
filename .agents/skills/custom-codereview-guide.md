---
name: custom-codereview-guide
description: Liszt repository review guidelines for the OpenHands PR reviewer
triggers:
  - /codereview
---

# Liszt Code Review Guidelines

You are reviewing code for **Liszt**, a small Node.js watchlist that keeps a rolling
90-day catalogue of scenes from selected studios. Read `AGENTS.md` and the relevant
spec in `docs/specs/` before judging a change; the spec is authoritative.

## Review Decisions

### When to APPROVE

- Documentation-only changes, spec edits, and config changes that follow existing patterns.
- Test-only changes that add coverage without touching production behavior.
- Simple additions that follow an established adapter/lane convention.

### When to REQUEST_CHANGES

- A change that weakens or bypasses a matching gate (see below).
- A production bug fix landed without a regression test.
- A behavior change that contradicts a `DECIDED` item or a measured number in a spec.
- Unbounded fan-out, buffering, or concurrency that threatens the 512MB v1.0 gate.
- Secrets committed, or an API key read from the environment by PR code.

### When to COMMENT

- A design question or a suggestion that is not blocking.
- Missing evidence for an end-to-end claim in the PR description.

## Core Principles

1. **Spec is ground truth.** `DECIDED` items are final. Measured numbers (corpus
   matrices, precision results, match rates) are facts to preserve, not suggestions.
   Flag any change that quietly moves them.
2. **One scoped task per PR.** No scope expansion. If a PR does more than its issue,
   say so and name the extra scope.
3. **Correctness first, then lightweight.** Prefer streaming over buffering, bounded
   concurrency, and no unbounded fan-out. Optimize only when a gate or a real crash
   demands it.
4. **Prove the fix.** Every bug fix needs a regression test, and the PR must show the
   test failing without the fix. Test output alone is not end-to-end evidence.

## What to Check

- **Matching gates** (`src/matching.js`, per `docs/specs/matching-algorithm.md`):
  the open-search gate (stage 3) accepts only when every token of a performer name is
  present in the normalised candidate title, OR the candidate title contains the
  normalised scene title verbatim. An MMDD code is **not** an open-search identity
  signal. The trusted-pool gate (stage 5) uses duration ±2s and identity from any
  performer token or a first-name-only token; a trailing MMDD code must match the
  scene release date within ±1 day. Passes may differ in query breadth, never in the
  gate. Candidate authors/uploaders may be objects (`{id, name, url}`) - identity must
  be extracted, never `String()`-ed.
- **Source adapters** (`src/studios/`, `src/sxyprn.js`, `src/eporner.js`): match the
  relevant `docs/specs/*-embed.md`. The trusted-uploader pool fallback must be wired
  into production callers (`src/server.js`), not only tests. Sxyprn matching must
  survive retitled uploads (camelCase splits, trailing tags like `ls`).
- **Lanes** (`src/studios/madouqu.js` and future lanes): a lane emits its own per-label
  `studioId`/`studio` and declares its matcher; a metadata-only lane ships no playback
  links and `matcher: null`.
- **Translation** (`src/translate.js`): never on the boot or sync path. With no
  `OPENROUTER_API_KEY` it degrades to glossary-only with no error banner.
- **Tests** (`test/`): `node --test` conventions, `npm test` must pass.
- **Security**: no secrets in the diff; the reviewer's own keys arrive as SDK secrets,
  never as environment variables the PR code can read.

## Repository Conventions

- Node.js >= 20.18.1, ESM (`"type": "module"`), no new runtime dependencies without
  a spec reason.
- Commit messages follow conventional commits; agent-authored PRs name the agent and
  model (AGENTS.md #10).
- Docs live in `README.md` and `docs/specs/`; keep them in step with behavior changes.
- Existing automated reviewer: `coderabbitai[bot]` (see `.coderabbit.yaml`). Do not
  duplicate unresolved comments it has already posted; add only what is new.
