# AGENTS.md

How to work on Liszt. Read this before writing any code.

1. **Take work from GitHub issues.** Open the repo's open issues and choose the first unblocked issue in the agreed queue. The issue body carries the detailed acceptance criteria; check the spec's `Depends on` header and any issue cross-references. If a prerequisite is not on main, stop and report the blocker in a comment on the issue.
2. **Claim and report the task.** Comment on the GitHub issue when you start, naming the working agent/model and the intended branch. **Comment discipline:** the GitHub issue is the shared record - comment when you start (plan in two sentences), on any load-bearing decision or blocker, and at handoff (PR link, what changed, what you verified). If you cannot comment on GitHub, send each of those to the invoking coordinator so it posts them for you; do not pretend the status changed.
3. **Branch from latest main, always.** Never branch from a spec branch or a stale checkout. Include the GitHub issue number in the branch and PR title. Close the issue from the PR description ("Fixes #N").
4. **Read first:** this file, the full GitHub issue, and the relevant spec in `docs/specs/`. [ROADMAP.md](ROADMAP.md) links the phase map. GitHub issues hold the live work order and status.
5. **Respect the spec.** DECIDED items are final. Measured numbers in specs (corpus matrices, precision results) are ground truth, not suggestions. One scoped task per PR; no scope expansion.
6. **Tests green.** Add meaningful `node --test` coverage under `test/` for behavior you build; `npm test` must pass. Follow existing conventions.
7. **Review loop:** expect review comments from coderabbitai[bot] and the coordinator. Address them on the same PR. Post the draft PR link in an issue comment. Work is done only after merge, checks, and any required deployment validation.
8. **Keep it lightweight.** Bound concurrency, stream rather than buffer, no unbounded fan-out. v1.0 gate: a full sync plus playback-source check runs comfortably in 512MB. Correctness first; optimize when a gate or real crash demands it.
9. **Prove the test catches the bug.** A bug fix needs a regression test and evidence it fails without the fix; paste the failing output in the PR description.
10. **State your authorship.** Every agent-authored PR names the agent and model in its description. Each new commit records its author in a commit-message trailer; update the PR description if the agent or model changes.
