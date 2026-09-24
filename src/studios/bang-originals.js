const BASE_URL = "https://www.bang.com";
export const LISTING_URL = `${BASE_URL}/studio/299/bang-originals?by=date.desc&with=anal`;

export const studio = {
  id: "bang-originals",
  name: "Bang! Originals",
  authority: { name: "Bang!", url: LISTING_URL, role: "authoritative catalogue" },
  fetchScenes: fetchBangOriginalsScenes,
};

const decodeHtml = (value = "") => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

export function parseListing(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) throw new Error("Bang! Originals listing is missing structured search results");
  let data;
  for (const [, block] of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed?.["@type"] === "SearchResultsPage") { data = parsed; break; }
    } catch { /* Keep looking for the structured search results block. */ }
  }
  if (data?.["@type"] !== "SearchResultsPage" || !Array.isArray(data.mainEntity?.itemListElement)) {
    throw new Error("Bang! Originals listing has an unexpected structured response");
  }
  const datesByUrl = new Map();
  for (const card of html.split('<div class="video_container').slice(1)) {
    const url = card.match(/href="([^"]*\/video\/[^"]+)"/)?.[1];
    const date = card.match(/<span class="mx-1 lg:mx-2">•<\/span>\s*([A-Za-z]{3} \d{1,2}, \d{4})/)?.[1];
    if (url && date) datesByUrl.set(new URL(decodeHtml(url), BASE_URL).href, new Date(`${date} UTC`).toISOString().slice(0, 10));
  }
  return data.mainEntity.itemListElement.flatMap(({ url }) => {
    if (typeof url !== "string") return [];
    const absoluteUrl = new URL(url, BASE_URL);
    if (absoluteUrl.origin !== BASE_URL || !absoluteUrl.pathname.startsWith("/video/")) return [];
    return [{ releaseUrl: absoluteUrl.href, ...(datesByUrl.has(absoluteUrl.href) ? { releaseDate: datesByUrl.get(absoluteUrl.href) } : {}) }];
  });
}

export function parseVideoPage(html, releaseUrl) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let video;
  for (const [, json] of scripts) {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.["@type"] === "VideoObject") { video = parsed; break; }
    } catch { /* Ignore unrelated malformed structured metadata. */ }
  }
  const sourceSceneId = new URL(releaseUrl).pathname.match(/^\/video\/([^/]+)/)?.[1];
  if (!video || !sourceSceneId || !video.name || !video.datePublished) {
    throw new Error(`Required Bang! video metadata missing for ${releaseUrl}`);
  }
  const releaseDate = video.datePublished.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`))) {
    throw new Error(`Invalid Bang! video release date for ${releaseUrl}`);
  }
  const performers = Array.isArray(video.actor) ? video.actor.map(({ name }) => name?.trim()).filter(Boolean) : [];
  return {
    sourceSceneId,
    title: video.name.trim(),
    releaseDate,
    performers: [...new Set(performers)],
    thumbnailUrl: typeof video.thumbnailUrl === "string" ? video.thumbnailUrl : "",
    releaseUrl,
    source: "Bang!",
    provenance: { source: "Bang!", sourceUrl: LISTING_URL, recordUrl: releaseUrl, sourceSceneId },
  };
}

async function fetchText(url, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": "Liszt catalogue updater/1.0", accept: "text/html" } });
      if (!response.ok) {
        const error = new Error(`Bang! returned HTTP ${response.status} for ${url}`);
        error.status = response.status;
        throw error;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500 && error.status !== 429) throw error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Bang! fetch failed for ${url} after 3 attempts: ${lastError.message}`, { cause: lastError });
}

export async function fetchBangOriginalsScenes({ now = new Date(), days = 90, fetchImpl = fetch } = {}) {
  const listings = new Map();
  let pageUrl = LISTING_URL;
  const visited = new Set();
  while (pageUrl && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    const html = await fetchText(pageUrl, fetchImpl);
    for (const listing of parseListing(html)) listings.set(listing.releaseUrl, listing);
    const next = html.match(/<link rel="next" href="([^"]+)"/)?.[1];
    const earliest = new Date(now.getTime() - days * 86_400_000);
    const pageHasRecent = parseListing(html).some(({ releaseDate }) => releaseDate && new Date(`${releaseDate}T00:00:00Z`) >= earliest);
    pageUrl = next && pageHasRecent ? new URL(decodeHtml(next), BASE_URL).href : "";
  }
  if (!listings.size) return { scenes: [], verifiedEmpty: true };

  const earliest = new Date(now.getTime() - days * 86_400_000);
  const recent = [];
  const queue = [...listings.values()].filter(({ releaseDate }) => releaseDate && new Date(`${releaseDate}T00:00:00Z`) >= earliest);
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const listing = queue.shift();
      const html = await fetchText(listing.releaseUrl, fetchImpl);
      const scene = parseVideoPage(html, listing.releaseUrl);
      const date = new Date(`${scene.releaseDate}T00:00:00Z`);
      if (date >= earliest && date <= now) recent.push(scene);
    }
  }));
  return { scenes: recent, verifiedEmpty: recent.length === 0 };
}
