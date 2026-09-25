const API_URL = "https://www.eporner.com/api/v2/video/search/";

function tokens(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().match(/[a-z0-9]+/g) || [];
}

function containsIdentity(scene, title) {
  const candidate = new Set(tokens(title));
  const performer = (scene.performers || []).some((name) => {
    const nameTokens = tokens(name);
    return nameTokens.length > 0 && nameTokens.every((token) => candidate.has(token));
  });
  const normalizedTitle = tokens(title).join(" ");
  const sceneTitle = tokens(scene.title).join(" ");
  return performer || (sceneTitle.length > 0 && normalizedTitle.includes(sceneTitle));
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

export function matchEpornerScene(scene, videos) {
  if (!Number.isFinite(scene.durationSec) || scene.durationSec <= 0) return null;
  const accepted = videos.filter((video) => Math.abs(Number(video.length_sec) - scene.durationSec) <= 2 &&
    containsIdentity(scene, video.title) && validEpornerUrl(video.url) && validEpornerEmbedUrl(video.embed));
  if (!accepted.length) return null;
  const stems = new Set(accepted.map((video) => tokens(video.title).join(" ")
    .replace(/\b(?:new|watch|download)\b/g, "").replace(/\b[a-z]*\d+[a-z0-9]*\b/g, "").trim()));
  if (stems.size > 1) return null;
  accepted.sort((a, b) => Number(b.views || 0) - Number(a.views || 0) || String(a.added || "").localeCompare(String(b.added || "")));
  return accepted[0];
}

export function createEpornerLookup({ fetchImpl = fetch } = {}) {
  const pools = new Map();
  async function pool(studio) {
    if (!pools.has(studio)) pools.set(studio, (async () => {
      const url = new URL(API_URL);
      url.searchParams.set("query", studio);
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
    return pools.get(studio);
  }
  return async (scene) => matchEpornerScene(scene, await pool(scene.studio));
}
