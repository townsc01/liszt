import { matchTokens, pickMatch } from "./matching.js";
import { trustedEpornerUploaders } from "./trusted-uploaders.js";
import { configuredSceneCode } from "./matching-config.js";

const API_URL = "https://www.eporner.com/api/v2/video/search/";
const VIDEO_URL = "https://www.eporner.com/api/v2/video/id/";
const POOL_TTL_MS = 5 * 60_000;
const POOL_CACHE_LIMIT = 512;

/**
 * Deduplicate concurrent lookups for a short window. Entries expire so a long-lived
 * lookup still observes new uploads, a rejection is evicted at once so one transient
 * error cannot disable the source for later scenes, and the map stays bounded.
 */
function createExpiringPoolCache({ ttlMs = POOL_TTL_MS, limit = POOL_CACHE_LIMIT } = {}) {
  const entries = new Map();
  return function cached(key, load) {
    const now = Date.now();
    const entry = entries.get(key);
    if (entry && now - entry.createdAt < ttlMs) return entry.value;
    entries.delete(key);
    const value = Promise.resolve().then(load);
    entries.set(key, { createdAt: now, value });
    value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    return value;
  };
}

/** Walk an uploader's newest profile pages, then hydrate each post with the public video API. */
export function createEpornerTrustedPoolLoader({ fetchImpl = fetch, maxPages = 40, poolTtlMs } = {}) {
  const cached = createExpiringPoolCache({ ttlMs: poolTtlMs });
  return async (account, scene) => {
    if (!/^[A-Za-z0-9_-]+$/.test(account)) return [];
    const cutoff = Date.parse(scene.releaseDate);
    const key = `${account}:${Number.isFinite(cutoff) ? cutoff : "unknown"}`;
    const videos = await cached(key, async () => {
      const collected = new Map();
      for (let page = 1; page <= maxPages; page++) {
        const profile = new URL(`https://www.eporner.com/profile/${encodeURIComponent(account)}/uploaded-videos/`);
        if (page > 1) profile.searchParams.set("page", String(page));
        const response = await fetchImpl(profile);
        if (!response.ok) throw new Error(`Eporner profile failed with HTTP ${response.status}`);
        const html = await response.text();
        const ids = [...html.matchAll(/(?:https?:\/\/www\.eporner\.com)?\/video-([A-Za-z0-9]+)(?:\/|["'?#])/g)]
          .map((match) => match[1]).filter((id) => !collected.has(id));
        if (!ids.length) break;
        const pageVideos = [];
        for (const id of ids) {
          const url = new URL(VIDEO_URL);
          url.searchParams.set("id", id);
          url.searchParams.set("format", "json");
          try {
            const detail = await fetchImpl(url, { headers: { accept: "application/json" } });
            if (!detail.ok) continue;
            const video = await detail.json();
            if (video && validEpornerUrl(video.url) && validEpornerEmbedUrl(video.embed)) {
              collected.set(id, video);
              pageVideos.push(video);
            }
          } catch { /* A missing post must not hide other uploads. */ }
        }
        if (Number.isFinite(cutoff) && pageVideos.length && pageVideos.every((video) => {
          const added = Date.parse(video.added);
          return Number.isFinite(added) && added < cutoff - 86_400_000;
        })) break;
      }
      return [...collected.values()];
    });
    return Number.isFinite(cutoff) ? videos.filter((video) => {
      const added = Date.parse(video.added);
      return !Number.isFinite(added) || added >= cutoff - 86_400_000;
    }) : videos;
  };
}

export function validEpornerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["eporner.com", "www.eporner.com"].includes(url.hostname) &&
      /^\/video-[A-Za-z0-9]+(?:\/[^/]*)?\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function validEpornerEmbedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["eporner.com", "www.eporner.com"].includes(url.hostname) &&
      /^\/embed\/[A-Za-z0-9]+\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function matchEpornerScene(scene, videos, options = {}) {
  const safe = videos.filter((video) => validEpornerUrl(video.url) && validEpornerEmbedUrl(video.embed))
    .map((video) => ({ ...video, duration: Number(video.length_sec) }));
  const match = pickMatch(scene, safe, options);
  return match ? videos.find((video) => video.url === match.url) || null : null;
}

export function buildEpornerQueries(scene) {
  const names = [...new Set((scene.performers || []).map((name) => matchTokens(name).join(" ")).filter(Boolean))].slice(0, 2);
  const nameTokens = new Set(names.flatMap(matchTokens));
  const title = matchTokens(scene.title).filter((token) => !nameTokens.has(token)).slice(0, 5).join(" ");
  const code = configuredSceneCode(scene);
  return [...new Set([...names, scene.creatorStudio ? null : scene.studio, code, title].filter(Boolean))];
}

export function createEpornerLookup({ fetchImpl = fetch, trustedPoolLoader = null, trustedUploaders = trustedEpornerUploaders, poolTtlMs } = {}) {
  const cached = createExpiringPoolCache({ ttlMs: poolTtlMs });
  const pool = (query) => cached(query, async () => {
    const url = new URL(API_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1000");
    url.searchParams.set("page", "1");
    url.searchParams.set("order", "latest");
    url.searchParams.set("format", "json");
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Eporner search failed with HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.videos)) throw new Error("Eporner returned an invalid response");
    return data.videos;
  });
  return async (scene) => {
    if (!Number.isFinite(scene.durationSec)) return null;
    const results = await Promise.allSettled(buildEpornerQueries(scene).map(pool));
    const successful = results.filter(({ status }) => status === "fulfilled");
    if (!successful.length) throw results[0]?.reason || new Error("Eporner search unavailable");
    const openVideos = [...new Map(successful.flatMap(({ value }) => value).map((video) => [video.url, video])).values()];
    const openMatch = matchEpornerScene(scene, openVideos);
    if (openMatch || !trustedPoolLoader || !Number.isFinite(scene.durationSec)) return openMatch;
    const trustedVideos = [];
    for (const account of trustedUploaders) {
      try {
        const videos = await trustedPoolLoader(account, scene);
        for (const video of Array.isArray(videos) ? videos : []) trustedVideos.push({ ...video, uploader: video.uploader || account });
      } catch {
        // One unavailable profile must not hide candidates from the remaining trusted accounts.
      }
    }
    return matchEpornerScene(scene, trustedVideos, { trustedPool: true });
  };
}
