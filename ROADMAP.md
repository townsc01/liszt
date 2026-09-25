# Roadmap

Status and build order live in **[GitHub milestones](https://github.com/townsc01/liszt/milestones)** - the single source of truth, readable via API (`/repos/townsc01/liszt/milestones`). Do not hand-maintain status here; read the milestones.

- **Phase 1 - Foundations** (shipped): [link-sources](docs/specs/link-sources.md), [studio-site-scraper](docs/specs/studio-site-scraper.md). Playback links as data + complete metadata.
- **Phase 2 - Matching**: [matching-algorithm](docs/specs/matching-algorithm.md). The measured identity gate; unlocks production-precision auto-linking.
- **Phase 3 - Playback UX**: [sxyprn-embed](docs/specs/sxyprn-embed.md), [eporner-embed](docs/specs/eporner-embed.md). In-app playback with source fallback.
- **Phase 4 - New lanes**: [FC2](docs/specs/fc2-anal-uncensored.md), [madouqu](docs/specs/madouqu-mainland-taiwan-anal.md) (metadata-only). Requires the per-lane matcher contract in link-sources.md + shared `src/translate.js`.
- **Maintenance queue**: open defect/follow-up issues; the milestone description carries the invocation order.

Specs carry content only. Each spec's `Depends on` header names prerequisites; current phase status belongs to the milestones, never to spec text.
