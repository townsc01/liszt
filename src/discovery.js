import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { CheerioCrawler, Configuration } from "crawlee";

const RELEASE_WORDS = /scene|video|watch|movie|episode|release|updates?/i;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

function privateAddress(address) {
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|::1$|fc|fd|fe80)/i.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

/** Reject credentials, non-HTTP schemes, localhost and DNS targets that can reach private services. */
export async function validateStudioUrl(input, { resolve = async (host) => [...await resolve4(host).catch(() => []), ...await resolve6(host).catch(() => [])] } = {}) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Enter a valid absolute website URL"); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP and HTTPS website URLs are supported");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard web ports are allowed");
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolve(url.hostname);
  if (!addresses.length) throw new Error("The website hostname could not be resolved");
  if (addresses.some(privateAddress) || /(^|\.)localhost$/i.test(url.hostname)) throw new Error("Private or local network addresses are not allowed");
  url.hash = "";
  return url;
}

const values = (value) => Array.isArray(value) ? value : value ? [value] : [];
function objects(value) {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== "object") return [];
  return [value, ...objects(value["@graph"]), ...objects(value.itemListElement).map((item) => item.item || item)];
}

export function extractStructuredScenes($, pageUrl) {
  const records = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      for (const item of objects(JSON.parse($(element).text()))) {
        const types = values(item["@type"]);
        if (!types.some((type) => /VideoObject|Movie|Episode/i.test(String(type)))) continue;
        const releaseUrl = new URL(item.url || item.contentUrl || pageUrl, pageUrl).href;
        const releaseDate = String(item.datePublished || item.uploadDate || "").match(DATE_RE)?.[1];
        const thumbnailUrl = values(item.thumbnailUrl || item.image)[0];
        records.push({ title: item.name || item.headline, releaseDate, thumbnailUrl: typeof thumbnailUrl === "object" ? thumbnailUrl.url : thumbnailUrl, releaseUrl, performers: values(item.actor || item.creator).map((actor) => typeof actor === "string" ? actor : actor?.name).filter(Boolean) });
      }
    } catch { /* invalid JSON-LD is evidence we cannot use, not a crawler failure */ }
  });
  return records;
}

export function stableSceneId(scene) {
  const identity = new URL(scene.releaseUrl);
  identity.hash = "";
  identity.search = "";
  return createHash("sha256").update(identity.href).digest("hex").slice(0, 20);
}

export async function discoverStudio(input, { maxRequests = 30, crawlerFactory, resolve, now = new Date() } = {}) {
  const homepage = await validateStudioUrl(input, { resolve });
  const origin = homepage.origin;
  const pages = [];
  const scenes = new Map();
  let name = homepage.hostname.replace(/^www\./, "");
  const handler = async ({ request, $, enqueueLinks }) => {
    const current = await validateStudioUrl(request.loadedUrl || request.url, { resolve });
    if (current.origin !== origin) return;
    const pageName = $("meta[property='og:site_name']").attr("content") || $("title").text().split(/[|–—]/)[0].trim();
    if (pageName && pages.length === 0) name = pageName;
    const found = extractStructuredScenes($, current.href);
    for (const scene of found) {
      if (!scene.title || !scene.releaseDate || !scene.releaseUrl) continue;
      const id = stableSceneId(scene);
      scenes.set(id, { ...scene, sourceSceneId: id });
    }
    pages.push({ url: current.href, kind: found.length ? "scene data" : "discovery", records: found.length });
    await enqueueLinks({ strategy: "same-hostname", transformRequestFunction: (req) => {
      const target = new URL(req.url);
      if (target.origin !== origin || (!RELEASE_WORDS.test(target.pathname) && (request.userData.depth || 0) >= 1)) return false;
      req.userData = { depth: (request.userData.depth || 0) + 1 };
      return req;
    } });
  };
  const crawler = crawlerFactory ? crawlerFactory(handler) : new CheerioCrawler({
    maxRequestsPerCrawl: maxRequests,
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: 30,
    requestHandler: handler,
    preNavigationHooks: [async ({ request }) => { await validateStudioUrl(request.url, { resolve }); }],
  }, new Configuration({ persistStorage: false }));
  await crawler.run([{ url: homepage.href, userData: { depth: 0 } }]);
  const recent = [...scenes.values()].filter((scene) => {
    const age = (now - new Date(`${scene.releaseDate}T00:00:00Z`)) / 86400000;
    return age >= 0 && age <= 90;
  }).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const missing = [];
  if (!pages.some((page) => page.records)) missing.push("structured VideoObject, Movie, or Episode records");
  if (![...scenes.values()].some((scene) => scene.releaseDate)) missing.push("machine-readable publication dates");
  if (![...scenes.values()].some((scene) => scene.releaseUrl)) missing.push("stable canonical scene URLs");
  return { homepageUrl: homepage.href, name, pages, scenes: recent, supported: recent.length > 0, missing };
}

export function adapterForDiscoveredStudio(definition, options = {}) {
  return {
    id: definition.id,
    name: definition.name,
    authority: { name: definition.name, url: definition.homepageUrl, role: "studio website" },
    async fetchScenes({ now }) {
      const preview = await discoverStudio(definition.homepageUrl, { ...options, now });
      if (!preview.supported) throw new Error(`Discovery is pending: missing ${preview.missing.join(", ")}`);
      return { verifiedEmpty: false, scenes: preview.scenes.map((scene) => ({ ...scene, source: definition.name, provenance: { source: definition.name, sourceUrl: definition.homepageUrl, recordUrl: scene.releaseUrl, sourceSceneId: scene.sourceSceneId } })) };
    },
  };
}
