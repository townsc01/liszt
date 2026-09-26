# Roadmap

Live work order and status are in the [Liszt Linear project](https://linear.app/lisztening/project/liszt-c872a029c925). The [operating model](https://linear.app/lisztening/document/how-liszt-work-moves-3406801f851f) explains how agents take tasks and hand off PRs. GitHub issues and the specs below retain detailed requirements and evidence; [GitHub milestones](https://github.com/townsc01/liszt/milestones) remain a historical phase map while the transition completes.

- **Phase 1 - Foundations** (shipped): [link-sources](docs/specs/link-sources.md), [studio-site-scraper](docs/specs/studio-site-scraper.md). Playback links as data + complete metadata.
- **Phase 2 - Matching**: [matching-algorithm](docs/specs/matching-algorithm.md). The measured identity gate; unlocks production-precision auto-linking.
- **Phase 3 - Playback UX**: [sxyprn-embed](docs/specs/sxyprn-embed.md), [eporner-embed](docs/specs/eporner-embed.md). In-app playback with source fallback.
- **Phase 4 - New lanes**: [FC2](docs/specs/fc2-anal-uncensored.md), [madouqu](docs/specs/madouqu-mainland-taiwan-anal.md) (metadata-only). Requires the per-lane matcher contract in link-sources.md + shared `src/translate.js`.
- **Maintenance queue**: defects and follow-ups tracked in Linear, with links to their existing GitHub issues.

Specs carry content and prerequisites. Linear holds the live queue and dependencies.
