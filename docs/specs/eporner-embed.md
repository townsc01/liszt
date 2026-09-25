# eporner embed: iframe playback

> **Depends on:** link-sources.

> Codex spec. How a verified eporner link becomes playable video in liszt. Companion to
> `docs/specs/link-sources.md` (link resolution) and `docs/specs/sxyprn-embed.md`.
> Docs-only; do not merge without review.

## Why eporner needs no proxy

Unlike sxyprn, eporner serves iframe-clean embeds: no IP binding, no minted URLs, no referer
checks. The API's video object carries a ready `embed` field
(`https://www.eporner.com/embed/<id>/`) next to `url`, `length_sec`, `added`, `title` and
`keywords` - everything the matcher and the player need in one row.

## The mechanism

1. At match time (third pass, see link-sources.md) the matched row's `embed` URL is stored on
   the scene's `videoUrls` entry as `{ source: "eporner", url, embedUrl, verifiedAt }`.
2. The scene page renders an `<iframe src="<embedUrl>" allowfullscreen>` when the user
   selects the eporner source (or when sxyprn has no link for the scene - eporner is the
   second source).
3. No server involvement at playback time. No Range handling, no proxy bandwidth cost.

## Constraints

- Embed URL comes ONLY from the API's `embed` field or the canonical watch URL's id - never
  constructed by string-munging titles.
- If an embed 404s later (uploader deletion, DMCA), mark the link dead on the next sync's
  spot-check and keep the sxyprn link (if any) as primary.
- eporner's own ads/branding live inside its iframe - the trade-off for zero proxy cost.

## Non-goals

- No proxying, no downloading.
- No tag-based discovery (tags optional and poorly applied) - matching uses
  studio/performer/title keyword pools only.
