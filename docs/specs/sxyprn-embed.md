# sxyprn embed: proxied playback

> **Depends on:** link-sources (implemented). **Status:** spec'd.

> Codex spec. How a verified sxyprn link becomes playable video in liszt. Companion to
> `docs/specs/link-sources.md` (link resolution) and `docs/specs/eporner-embed.md`.
> Docs-only; do not merge without review.

## The problem: sxyprn CDN URLs are IP-bound

sxyprn's `details()` mints media URLs bound to the requesting IP. A URL minted by the server
during matching 404s (or serves an error page) when the USER's browser opens it. Direct
hotlinking is therefore impossible - this was measured, not theoretical, and is the reason
early playback attempts failed silently.

## The mechanism (shipped in PR #38, merged)

`src/video-proxy.js` - a server-side mint-and-stream proxy:

1. Client asks `/api/video-proxy?scene=<id>` (or the stored sxyprn watch URL).
2. The SERVER resolves the sxyprn page, mints a fresh CDN URL (bound to the server's IP),
   and streams the bytes back, forwarding Range headers so seeking works.
3. The browser only ever talks to the liszt server; the IP binding is satisfied because the
   server is both minter and fetcher.

## Embed behaviour

- The scene page renders a `<video>` element whose `src` is the proxy URL - no third-party
  player, no ads, no referer leakage to sxyprn.
- Range support is mandatory (large files, mobile seeking). Proxy must stream, never buffer
  whole files into memory.
- Minted CDN URLs are time-limited: mint per playback request, never cache media URLs in the
  catalogue. The stored `videoUrls` entry keeps only the sxyprn WATCH-page URL; the media URL
  is derived at playback time.
- Failure mode: if the proxy cannot mint (page removed, rate limited), the UI falls back to
  the eporner embed when the scene has one, else shows the link as broken rather than a dead
  player.

## Non-goals

- No downloading/hosting of video files; this is a pass-through, not a library.
- No proxying of eporner (its embeds are iframe-clean - see eporner-embed.md).
