import { fetchAnalVidsText } from "./analvids-fetch.js";
const BASE_URL = "https://www.analvids.com";
export const STUDIO_URL = `${BASE_URL}/studios/lancelotstylesevolution`;

export const studio = {
  id: "lancelot-styles-evolution",
  name: "Lancelot Styles Evolution",
  authority: {
    name: "AnalVids",
    url: STUDIO_URL,
    role: "authoritative catalogue",
  },
  fetchScenes: fetchAnalVidsScenes,
};

const decodeHtml = (value = "") => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&(amp|quot|apos|#39|lt|gt|nbsp);/g, (entity) => ({
    "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
  })[entity]);

const cleanText = (value) => decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function parseListing(html) {
  const section = html.split('id="lancelotstylesevolution_scenes"')[1] || html;
  return section.split('<div class="card-scene"').slice(1).flatMap((card) => {
    const releaseUrl = card.match(/href="(https:\/\/www\.analvids\.com\/watch\/[^\"]+)"/)?.[1];
    const thumbnailUrl = card.match(/data-src="([^\"]+)"/)?.[1];
    const title = card.match(/<div class="card-scene__text">[\s\S]*?title="([^\"]+)"/)?.[1];
    return releaseUrl && title ? [{ title: decodeHtml(title), releaseUrl: decodeHtml(releaseUrl), thumbnailUrl: decodeHtml(thumbnailUrl || "") }] : [];
  });
}

export function parseScenePage(html, listing, femaleModelSlugs = null) {
  const titleBlock = html.match(/<h1 class="watch__title[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "";
  const releaseDate = html.match(/bi-calendar3[^>]*>\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const sourceSceneId = listing.releaseUrl.match(/\/watch\/(\d+)/)?.[1];
  if (!releaseDate || !sourceSceneId) throw new Error(`Required scene data missing for ${listing.releaseUrl}`);
  const performers = [...titleBlock.matchAll(/<a href="https:\/\/www\.analvids\.com\/model\/([^\"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .filter(([, slug]) => femaleModelSlugs ? femaleModelSlugs.has(slug) : !slug.endsWith("/lancelot"))
    .map(([, , name]) => cleanText(name));
  return {
    id: `${studio.id}:${sourceSceneId}`, sourceSceneId, title: cleanText(titleBlock) || listing.title,
    releaseDate, studioId: studio.id, studio: studio.name, performers: [...new Set(performers)],
    thumbnailUrl: listing.thumbnailUrl, releaseUrl: listing.releaseUrl, source: "studio",
    provenance: { source: "AnalVids", sourceUrl: STUDIO_URL, recordUrl: listing.releaseUrl, sourceSceneId },
  };
}

const monthUrls = (now, days) => {
  const earliest = new Date(now.getTime() - days * 86_400_000);
  const cursor = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
  const urls = [];
  while (cursor <= now) {
    urls.push(`${STUDIO_URL}/year/${cursor.getUTCFullYear()}/month/${cursor.getUTCMonth() + 1}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return urls;
};

export async function fetchAnalVidsScenes({ now = new Date(), days = 90, fetchImpl = fetch } = {}) {
  const pages = await Promise.all(monthUrls(now, days).map((url) => fetchAnalVidsText(url, fetchImpl)));
  const listings = [...new Map(pages.flatMap(parseListing).map((scene) => [scene.releaseUrl, scene])).values()];
  // An empty recent catalogue would be extraordinary. Treat it as extraction failure,
  // not a successful empty refresh that could erase the last known-good records.
  if (!listings.length) throw new Error("AnalVids extraction returned no scene cards");
  const scenePages = [];
  const queue = [...listings];
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) { const listing = queue.shift(); scenePages.push({ listing, html: await fetchAnalVidsText(listing.releaseUrl, fetchImpl) }); }
  }));
  const models = new Map(scenePages.flatMap(({ html }) => [...(html.match(/<h1 class="watch__title[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "").matchAll(/href="https:\/\/www\.analvids\.com\/model\/([^\"]+)"/g)])
    .map(([, slug]) => [slug, `${BASE_URL}/model/${slug}`]));
  const femaleModelSlugs = new Set();
  const modelQueue = [...models];
  await Promise.all(Array.from({ length: Math.min(8, modelQueue.length) }, async () => {
    while (modelQueue.length) { const [slug, url] = modelQueue.shift(); if (/\/models\/sex\/female\//.test(await fetchAnalVidsText(url, fetchImpl))) femaleModelSlugs.add(slug); }
  }));
  return { scenes: scenePages.map(({ html, listing }) => parseScenePage(html, listing, femaleModelSlugs)), verifiedEmpty: false };
}
