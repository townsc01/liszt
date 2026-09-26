# AGENTS.md

How to work on Liszt. Read this before writing any code.

1. **Take work from Linear.** Open the [Liszt project](https://linear.app/lisztening/project/liszt-c872a029c925) and read [How Liszt work moves](https://linear.app/lisztening/document/how-liszt-work-moves-3406801f851f). Choose the first unblocked issue in the agreed queue. Its linked GitHub issue contains the detailed acceptance criteria. Check the Linear dependency links and the spec's `Depends on` header. If a prerequisite is not on main, stop and report the blocker on the Linear issue.
2. **Claim and report the task.** Assign the Linear issue to the working agent or person, set it In Progress, and comment with the agent/model and intended branch. If the agent cannot update Linear, report the same information to the invoking coordinator and do not pretend the status changed.
3. **Branch from latest main, always.** Never branch from a spec branch or a stale checkout. Include the Linear ID in the branch and PR title. Link the Linear issue and its GitHub issue in the PR description.
4. **Read first:** this file, the full linked GitHub issue, and the relevant spec in `docs/specs/`. [ROADMAP.md](ROADMAP.md) links the phase map. Linear holds the live work order and status.
5. **Respect the spec.** DECIDED items are final. Measured numbers in specs (corpus matrices, precision results) are ground truth, not suggestions. One scoped task per PR; no scope expansion.
6. **Tests green.** Add meaningful `node --test` coverage under `test/` for behavior you build; `npm test` must pass. Follow existing conventions.
7. **Review loop:** expect review comments from bigideaclanker[bot]. Address them on the same PR. Link the draft PR in Linear and set In Review. Mark Done only after merge, checks, and any required deployment validation.
8. **Keep it lightweight.** Bound concurrency, stream rather than buffer, no unbounded fan-out. v1.0 gate: a full sync plus playback-source check runs comfortably in 512MB. Correctness first; optimize when a gate or real crash demands it.
9. **Prove the test catches the bug.** A bug fix needs a regression test and evidence it fails without the fix; paste the failing output in the PR description.
10. **State your authorship.** Every agent-authored PR names the agent and model in its description. Each new commit records its author in a commit-message trailer; update the PR description if the agent or model changes.
