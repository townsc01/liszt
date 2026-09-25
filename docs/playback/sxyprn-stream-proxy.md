# Sxyprn playback: server-side stream proxy

Status: design spec for Codex. Not implemented. Do not merge without Chris's review.
Date: 2026-09-25. All findings below verified live against liszt-x164.onrender.com and sxyprn.com on that date.

## 1. The bug, precisely

Clicking a thumbnail opens the watch overlay and the video never plays on the deployed site. Playback works on localhost. This is not sxyprn blocking Render, not a stale catalogue, and not an enrichment gap. It is an architecture bug: **sxyprn CDN URLs are bound to the IP address that minted them**, and liszt mints them server-side but plays them client-side.

Current flow (`public/watch.js` -> `GET /api/video?scene=<id>` -> `src/sxyprn.js` `videos.details()` -> JSON `{url}` -> `<video src>`):

1. Render's server scrapes the sxyprn post and mints a signed CDN URL: `https://sxyprn.com/cdn8/<payload>/<sig>/<expiry>/<token>/<file>.vid`
2. The browser is handed that URL and fetches it from the user's IP.
3. The CDN rejects any requester IP other than the minting IP.

### Evidence (live tests, 2026-09-25 ~07:20-07:23 UTC)

| Test | Result |
|---|---|
| `GET /api/video?scene=<current id>` on liszt-x164 | 200 in 18.7s with a fresh signed `.vid` URL. Server-side mint works from Render. |
| Render-minted URL fetched from a different IP (sandbox), `Range: bytes=0-2047` | HTTP 206, `Content-Type: text/html`, 10 bytes. The body is literally the URL's own expiry timestamp (`1790324543`) - an error token, not video. |
| Sandbox-minted URL fetched from the same sandbox IP, `Range: bytes=0-1023` | HTTP 206, `Content-Type: video/mp4`, real bytes. Redirect chain: `sxyprn.com/cdn8/...` -> 302 -> `c9.trafficdeposit.com/.../*.vid`. Range support confirmed. |
| Sandbox-minted URL loaded in a cloud browser (third IP) via a `<video>` element | `MEDIA_ERR_SRC_NOT_SUPPORTED` (error code 4) within 6s. |

Both hops (`sxyprn.com/cdn8` and the `trafficdeposit.com` redirect target) enforce the binding. On localhost the dev server and browser share an IP, which is why this shipped unnoticed.

### Corollaries

- No client-side trick fixes this: the URL must be fetched from the minting IP. A public CORS proxy would move the mismatch to the proxy's IP (and add a third party to the trust path). Rejected.
- The post pages cannot be iframed either: `x-frame-options: SAMEORIGIN` and CSP `frame-ancestors 'self'` (verified on live post pages). So "embed the sxyprn player" is out regardless.
- The mint is real and healthy from Render. The sxyprn link-enrichment investment (95/184 scenes linked at test time, still filling) is fully preserved by this fix.

## 2. The fix: proxy the bytes through Render

`GET /api/video?scene=<id>` stops returning a URL and starts returning the video itself:

1. Mint (or reuse a cached) signed URL using Render's IP - the existing `sxyprn` lib call and the `stream.hostname === "sxyprn.com"` validation stay exactly as they are.
2. Fetch the video upstream with Render's IP, forwarding the client's `Range` header.
3. Pipe the upstream response back: status (200/206), `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges: bytes`.
4. Abort the upstream request when the client disconnects (Render bills egress; half-watched scenes should not finish downloading).

The browser's `<video>` element then talks only to our own origin. IP binding satisfied because the CDN only ever sees Render.

### 2a. URL caching is mandatory, not optional

A `<video>` element issues many range requests (initial metadata + every seek). Each sxyprn mint costs ~15-19s from Render. Without caching, every seek stalls 15-19s - unusable.

- Cache key: scene id.
- Cache value: `{ streamUrl, redirectUrl?, expiresAt }`.
- Expiry: the expiry is embedded in the URL path as a unix timestamp (observed: `.../1790324543/...`). Parse it; cache until `expiry - 60s` (observed validity window ~20 min from mint). If parsing fails, fall back to a 15-minute TTL from mint time.
- Optionally cache the resolved redirect target (`c*.trafficdeposit.com/...`) after the first successful upstream request; if a later request gets an error-token response from the redirect host, re-mint once and retry the same range before failing.
- Detect the error token: upstream 200/206 with `Content-Type: text/html` and a tiny body means the mint is invalid - invalidate cache, re-mint once, retry once, then 502.

### 2b. First-play latency

Mint takes 15-19s on Render (sxyprn is slow to datacenter IPs). The current client timeout is 30s (`watch.js`), which is too tight once upstream streaming starts.

- Add `GET /api/video/resolve?scene=<id>`: warms the cache, returns 204 when ready. `watch.js` calls `resolve` the moment the overlay opens, shows a "resolving stream..." state, and only sets `<video src>` when resolve returns. This decouples mint latency from the media element's own retry behavior.
- Raise the client-side stall timeout to 90s for the first load event.
- Optional polish: prefetch `resolve` for the first N visible cards on hover/focus.

### 2c. Cost on the free tier

All video bytes now flow through Render twice (in + out). Free web services include 100 GB/month egress. These scenes run ~300 MB-1 GB+ each; prototype-scale usage is a few GB/month - fine. If the app becomes a daily driver, either move to a paid Render tier or revisit (e.g. only proxy scenes the user actually starts, never prefetch full files - range passthrough already does this).

### 2d. Security and correctness notes

- Keep the existing mint-time validation (`stream.hostname === "sxyprn.com"`, no credentials/userinfo in the URL). The proxy must never fetch arbitrary URLs: only URLs just minted by `videos.details()` for the requested scene, re-validated on every request (do not accept a `url` query param).
- One mint in flight per scene: coalesce concurrent requests for the same scene onto one pending mint promise.
- Per-request upstream timeout ~30s; overall first-byte budget ~45s (mint 19s + connect + first range).
- Do not log full signed URLs at info level (they are bearer tokens); log scene id and host only.

## 3. Tests

- Unit: cache hit/miss/expiry-parse; error-token detection; range header passthrough (request `bytes=100-` -> upstream receives it, response `206` + `Content-Range` preserved); client-abort cancels upstream; concurrent requests coalesce to one mint.
- Integration with a fixture upstream: a local HTTP server standing in for the CDN, asserting headers byte-for-byte.
- Update `test/server.test.js`: `/api/video` now returns `200 video/mp4` bytes for a scene with links, `404` for unknown scene, `404` for a scene with no sxyprnUrls (unchanged), `502` after re-mint failure.

## 4. Acceptance criteria

1. On liszt-x164 (Render, not localhost), clicking any linked thumbnail starts playback within ~20s and seeking works with <2s stall.
2. Two successive plays of the same scene: the second starts without a mint delay (cache hit).
3. A seek after >20 min triggers exactly one re-mint and then plays.
4. `npm test` passes, including the new proxy tests.

## 5. Explicitly rejected alternatives (recorded so they don't get re-litigated)

- Iframe the sxyprn post page: blocked by `x-frame-options` + CSP `frame-ancestors` (verified live).
- Client-side mint via public CORS proxy: IP binding defeats it; adds a third party to every video request.
- Hand the browser the resolved `trafficdeposit.com` URL: that hop enforces the same IP binding (verified live).
- In-browser WebTorrent streaming from the sxyprn post's `torrentUrl`: WebRTC-only peer connectivity makes poorly-seeded swarms unreachable rather than slow, and exposes the user's IP to the swarm. Not a playback path.
