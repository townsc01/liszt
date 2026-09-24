const BASE_URL = "https://www.analvids.com";
export const STUDIO_URL = `${BASE_URL}/studios/lancelotstylesevolution`;

const decodeHtml = (value = "") => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&(amp|quot|apos|#39|lt|gt|nbsp);/g, (entity) => ({
    "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
  })[entity]);

const cleanText = (value) => decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function parseListing(html) {
  const section = html.split('id="lancelotstylesevolution_scenes"')[1] || html;
  const cards = section.split('<div class="card-scene"').slice(1);
  return cards.flatMap((card) => {
    const url = card.match(/href="(https:\/\/www\.analvids\.com\/watch\/[^\"]+)"/)?.[1];
    const thumbnailUrl = card.match(/data-src="([^\"]+)"/)?.[1];
    const title = card.match(/<div class="card-scene__text">[\s\S]*?title="([^\"]+)"/)?.[1];
    return url && title ? [{ title: decodeHtml(title), releaseUrl: decodeHtml(url), thumbnailUrl: decodeHtml(thumbnailUrl || "") }] : [];
  });
}

export function parseScenePage(html, listing, femaleModelSlugs = null) {
  const titleBlock = html.match(/<h1 class="watch__title[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "";
  const releaseDate = html.match(/bi-calendar3[^>]*>\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!releaseDate) throw new Error(`Release date missing for ${listing.releaseUrl}`);
  const performers = [...titleBlock.matchAll(/<a href="https:\/\/www\.analvids\.com\/model\/([^\"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .filter(([, slug]) => femaleModelSlugs ? femaleModelSlugs.has(slug) : !slug.endsWith("/lancelot"))
    .map(([, , name]) => cleanText(name));
  return {
    id: listing.releaseUrl.match(/\/watch\/(\d+)/)?.[1], title: cleanText(titleBlock) || listing.title,
    releaseDate, studio: "Lancelot Styles Evolution", performers: [...new Set(performers)],
    thumbnailUrl: listing.thumbnailUrl, releaseUrl: listing.releaseUrl, source: "studio",
  };
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { "user-agent": "Liszt catalogue updater/1.0" } });
  if (!response.ok) throw new Error(`AnalVids returned ${response.status} for ${url}`);
  return response.text();
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
  const pages = await Promise.all(monthUrls(now, days).map((url) => fetchText(url, fetchImpl)));
  const listings = [...new Map(pages.flatMap(parseListing).map((scene) => [scene.releaseUrl, scene])).values()];
  const scenePages = [];
  const queue = [...listings];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const listing = queue.shift();
      scenePages.push({ listing, html: await fetchText(listing.releaseUrl, fetchImpl) });
    }
  });
  await Promise.all(workers);
  const models = new Map(scenePages.flatMap(({ html }) => {
    const title = html.match(/<h1 class="watch__title[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "";
    return [...title.matchAll(/href="https:\/\/www\.analvids\.com\/model\/([^\"]+)"/g)];
  })
    .map(([, slug]) => [slug, `${BASE_URL}/model/${slug}`]));
  const femaleModelSlugs = new Set();
  const modelQueue = [...models];
  await Promise.all(Array.from({ length: Math.min(8, modelQueue.length) }, async () => {
    while (modelQueue.length) {
      const [slug, url] = modelQueue.shift();
      const profile = await fetchText(url, fetchImpl);
      if (/\/models\/sex\/female\//.test(profile)) femaleModelSlugs.add(slug);
    }
  }));
  return scenePages.map(({ html, listing }) => parseScenePage(html, listing, femaleModelSlugs));
}
