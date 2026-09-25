# AGENTS.md

How to work on Liszt. Read this before writing any code.

1. **Branch from latest main, always.** Never branch from a spec branch or a stale checkout.
2. **Read first:** this file, the repo milestones (build order and live status - `/repos/townsc01/liszt/milestones` via API, or ROADMAP.md for the linked map), and the full spec you are implementing (`docs/specs/`).
3. **Respect each spec's "Depends on" header.** If a dependency is not implemented on main, stop and say so - do not stub around it.
4. **DECIDED items are final.** Measured numbers in specs (corpus matrices, precision results) are ground truth, not suggestions. Do not relitigate them.
5. **One spec per task.** Implement what the spec says, nothing more. No scope expansion.
6. **Tests green.** Add `node --test` coverage under `test/` for everything you build; `npm test` must pass. Follow the existing test conventions.
7. **Review loop:** expect review comments from bigideaclanker[bot]. Address them on the same PR - do not open a new one.
8. **Keep it lightweight.** The app must stay small in memory: bound concurrency, stream rather than buffer, no unbounded fan-out. v1.0 gate: a full sync plus playback-source check runs comfortably in 512MB. Do not optimize ahead of need - correctness first, belt-tightening only when a gate or a real crash demands it.
