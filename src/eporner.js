import { matchTokens, pickMatch } from "./matching.js";
import { trustedEpornerUploaders } from "./trusted-uploaders.js";
import { configuredSceneCode } from "./matching-config.js";

const API_URL = "https://www.eporner.com/api/v2/video/search/";

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

export function createEpornerLookup({ fetchImpl = fetch, trustedPoolLoader = null, trustedUploaders = trustedEpornerUploaders } = {}) {
  const pools = new Map();
  async function pool(query) {
    if (!pools.has(query)) pools.set(query, (async () => {
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
    })());
    return pools.get(query);
  }
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
