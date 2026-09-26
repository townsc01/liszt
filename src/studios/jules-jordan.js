const BASE_URL = "https://www.julesjordan.com";
const LISTING_URL = `${BASE_URL}/trial/categories/anal.html`;

export const studio = {
  id: "jules-jordan",
  name: "Jules Jordan",
  authority: { name: "Jules Jordan", url: LISTING_URL, role: "authoritative catalogue" },
  fetchScenes: fetchJulesJordanScenes,
};

const decodeHtml = (value = "") => value
  .replace(/&/g, "&")
  .replace(/"/g, '"')
  .replace(/'|&apos;/g, "'")
  .replace(/</g, "<")
  .replace(/>/g, ">");

export function parseListing(html) {
  const listings = [];
  
  // Split by card divs and process each card individually
  const cardHtmls = html.split('<div class="jj-content-card">').slice(1);
  
  for (const cardHtml of cardHtmls) {
    const urlMatch = cardHtml.match(/<a href="([^"]*\/scenes\/[^"]+_vids\.html)" class="jj-card-thumb"/);
    const thumbMatch = cardHtml.match(/<img[^>]+src="([^"]+)"/);
    const titleMatch = cardHtml.match(/<h2 class="jj-card-title">([^<]+)<\/h2>/);
    const dateMatch = cardHtml.match(/<div class="jj-card-date">Released: ([^<]+)<\/div>/);
    
    if (urlMatch) {
      const releaseUrl = new URL(decodeHtml(urlMatch[1]), BASE_URL).href;
      const releaseDate = dateMatch ? parseDate(dateMatch[1].trim()) : undefined;
      const thumbnailUrl = thumbMatch ? decodeHtml(thumbMatch[1]) : "";
      listings.push({ releaseUrl, releaseDate, thumbnailUrl });
    }
  }
  
  if (!listings.length) throw new Error("Jules Jordan listing is missing video cards");
  return listings;
}

function parseDate(dateStr) {
  const match = dateStr.match(/([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!match) return undefined;
  const [, month, day, year] = match;
  const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseVideoPage(html, releaseUrl) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let video;
  for (const [, json] of scripts) {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.["@type"] === "VideoObject") { video = parsed; break; }
    } catch { /* Ignore malformed blocks */ }
  }

  const sourceSceneId = new URL(releaseUrl).pathname.match(/\/scenes\/([^/]+)_vids\.html/)?.[1];
  if (!video || !sourceSceneId || !video.name || !video.uploadDate) {
    throw new Error(`Required Jules Jordan video metadata missing for ${releaseUrl}`);
  }

  const releaseDate = video.uploadDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`))) {
    throw new Error(`Invalid Jules Jordan video release date for ${releaseUrl}`);
  }

  const performers = Array.isArray(video.actor)
    ? video.actor.map(({ name }) => name?.trim()).filter(Boolean)
    : [];

  const thumbnailUrl = Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl[0] : (video.thumbnailUrl || "");

  return {
    sourceSceneId,
    title: video.name.trim(),
    releaseDate,
    durationSec: parseIsoDuration(video.duration),
    performers: [...new Set(performers)],
    thumbnailUrl,
    releaseUrl,
    source: "Jules Jordan",
    provenance: { source: "Jules Jordan", sourceUrl: LISTING_URL, recordUrl: releaseUrl, sourceSceneId },
  };
}

async function fetchText(url, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": "Liszt catalogue updater/1.0", accept: "text/html" } });
      if (!response.ok) {
        const error = new Error(`Jules Jordan returned HTTP ${response.status} for ${url}`);
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
  throw new Error(`Jules Jordan fetch failed for ${url} after 3 attempts: ${lastError.message}`, { cause: lastError });
}

function parseIsoDuration(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const text = String(value || "").trim();
  const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const seconds = Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0);
    return seconds > 0 ? Math.round(seconds) : null;
  }
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  return null;
}

export async function fetchJulesJordanScenes({ now = new Date(), days = 90, fetchImpl = fetch } = {}) {
  const listings = new Map();
  let pageUrl = LISTING_URL;
  const visited = new Set();
  const earliest = new Date(now.getTime() - days * 86_400_000);

  while (pageUrl && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    const html = await fetchText(pageUrl, fetchImpl);
    for (const listing of parseListing(html)) listings.set(listing.releaseUrl, listing);

    const nextMatch = html.match(/<a class="jj-pag-next" href="([^"]+)"/);
    const pageHasRecent = parseListing(html).some(({ releaseDate }) => releaseDate && new Date(`${releaseDate}T00:00:00Z`) >= earliest);
    pageUrl = nextMatch && pageHasRecent ? new URL(decodeHtml(nextMatch[1]), BASE_URL).href : "";
  }

  if (!listings.size) return { scenes: [], verifiedEmpty: true };

  const recent = [];
  const queue = [...listings.values()].filter(({ releaseDate }) => releaseDate && new Date(`${releaseDate}T00:00:00Z`) >= earliest);
  const concurrency = Math.min(8, queue.length);

  await Promise.all(Array.from({ length: concurrency }, async () => {
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