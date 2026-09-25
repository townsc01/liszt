import sxyprn from "sxyprn";
import { readStore, writeStore } from "./store.js";
import { sxyprnOverrides } from "./sxyprn-overrides.js";
import { enrichFromStudioSite } from "./studio-site.js";
import { matchTokens, pickMatch, titleStem } from "./matching.js";

const DAY_MS = 86_400_000;
const COMMON = new Set(["a", "an", "and", "at", "by", "for", "in", "into", "of", "on", "the", "to", "with"]);

function words(value) {
  return matchTokens(String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function titleWords(value) {
  const title = String(value || "");
  const beforeFeaturing = title.split(/\bfeaturing\b/i)[0];
  const core = words(beforeFeaturing).filter((word) => !COMMON.has(word));
  return core.length >= 4 ? core : words(title).filter((word) => !COMMON.has(word));
}

function titleScore(left, right) {
  const reference = new Set(titleWords(left));
  const candidate = new Set(words(right));
  if (reference.size < 4) return 0;
  const shared = [...reference].filter((word) => candidate.has(word)).length;
  return shared >= 4 ? shared / reference.size : 0;
}

function performerName(value) {
  const parts = words(value);
  if (parts.at(-1) === "ls") parts.pop();
  return parts.join(" ");
}

function hasPerformer(scene, title) {
  const haystack = ` ${words(title).join(" ")} `;
  return (scene.performers || []).some((name) => {
    const performer = performerName(name);
    return performer.length >= 6 && haystack.includes(` ${performer} `);
  });
}

function sceneCode(scene) {
  return scene.studioId === "mambo-perv" ? String(scene.title).match(/\bOB\d{3,}\b/i)?.[0].toLowerCase() : null;
}

function hasSceneEvidence(scene, title, code) {
  return hasPerformer(scene, title) || (code && new RegExp(`\\b${code}\\b`, "i").test(title));
}

export function buildSxyprnQueries(scene) {
  const names = [...new Set((scene.performers || []).map(performerName).filter(Boolean))].slice(0, 2);
  const performerWords = new Set(names.flatMap(words));
  const titleQuery = titleWords(scene.title).filter((word) => !performerWords.has(word)).slice(0, 5).join(" ");
  return [...new Set([...names, titleQuery, sceneCode(scene), scene.creatorStudio ? null : scene.studio].filter(Boolean))];
}

export function searchSlug(value) {
  return String(value || "").replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\/]/g, " ")
    .trim().replace(/\s+/g, "-");
}

export function validSxyprnUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "sxyprn.com" &&
      /^\/post\/[a-f0-9]{13}\.html$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function createSxyprnLookup({ client = sxyprn, maxMatches = 1 } = {}) {
  const searchCache = new Map();
  const detailsCache = new Map();
  const search = (query) => {
    const slug = searchSlug(query);
    if (!searchCache.has(slug)) searchCache.set(slug, client.videos.search(slug));
    return searchCache.get(slug);
  };
  const details = (url) => {
    if (!detailsCache.has(url)) detailsCache.set(url, client.videos.details({ url }));
    return detailsCache.get(url);
  };

  return async (scene) => {
    const code = sceneCode(scene);
    const queries = buildSxyprnQueries(scene);
    if (!queries.length || !Number.isFinite(scene.durationSec)) return [];
    const allCandidates = new Map();
    let successfulSearches = 0;
    for (const query of queries) {
      try {
        const page = await search(query);
        successfulSearches++;
        for (const item of page.videos || []) {
          if (!validSxyprnUrl(item.url)) continue;
          allCandidates.set(item.url, item);
        }
      } catch {
        // A second performer or the title may still find the scene.
      }
    }
    if (!successfulSearches) throw new Error("Sxyprn search unavailable");
    const mapped = [...allCandidates.values()].map((item) => ({ ...item, duration: Number(item.durationSeconds) }));
    const identity = code ? (item) => hasSceneEvidence(scene, item.title, code) ||
      words(item.title).join(" ").includes(words(scene.title).join(" ")) : null;
    const picked = pickMatch(scene, mapped, { identity });
    if (!picked) return [];
    const sameStem = mapped.filter((item) => titleStem(item.title) === titleStem(picked.title));
    const ranked = [picked, ...sameStem.filter((item) => item.url !== picked.url)];
    const verified = [];
    let successfulDetails = 0;
    for (const item of ranked.slice(0, Math.max(3, maxMatches))) {
      try {
        const detail = await details(item.url);
        successfulDetails++;
        const durationMatch = pickMatch(scene, [{ ...item, title: detail.title, duration: Number(item.durationSeconds) }], { identity });
        if (validSxyprnUrl(detail.url) && detail.url === item.url && detail.streamUrl &&
            durationMatch) {
          verified.push({ url: detail.url, score: titleScore(scene.title, detail.title), isExternal: detail.isExternal });
          if (verified.length >= maxMatches) break;
        }
      } catch {
        // Do not expose a search hit whose post could not be verified.
      }
    }
    if (!successfulDetails) throw new Error("Sxyprn post verification unavailable");
    verified.sort((a, b) => b.score - a.score || Number(a.isExternal) - Number(b.isExternal));
    return verified.slice(0, maxMatches).map(({ url }) => url);
  };
}

function legacyLinks(scene) {
  const verifiedAt = scene.sxyprnCheckedAt || new Date(0).toISOString();
  return (scene.sxyprnUrls || []).filter(validSxyprnUrl).map((url) => ({ source: "sxyprn", url, embedUrl: null, verifiedAt }));
}

function unchanged(scene, prior) {
  return prior && scene.releaseDate === prior.releaseDate &&
    (scene.id === prior.id
      ? scene.title === prior.title && JSON.stringify(scene.performers) === JSON.stringify(prior.performers)
      : scene.releaseUrl === prior.releaseUrl && scene.studioId === prior.studioId && titleScore(scene.title, prior.title) >= 0.8);
}

function namingVersion(scene) {
  return JSON.stringify(scene.performers || []);
}

export async function enrichSxyprnLinks(scenes, previousScenes, lookup, { now = new Date(), days = 14, fetchImpl = fetch, scrape = enrichFromStudioSite } = {}) {
  const byId = new Map(previousScenes.map((scene) => [scene.id, scene]));
  const byReleaseUrl = new Map(previousScenes.filter((scene) => scene.releaseUrl).map((scene) => [scene.releaseUrl, scene]));
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const output = [];
  for (const input of scenes) {
    const { sxyprnUrls, sxyprnCheckedAt, epornerUrls, epornerUrl, epornerCheckedAt, ...scene } = input;
    const override = sxyprnOverrides.get(scene.id);
    if (override) {
      output.push({ ...scene, videoUrls: override.filter(validSxyprnUrl).map((url) => ({ source: "sxyprn", url, embedUrl: null, verifiedAt: now.toISOString() })) });
      continue;
    }
    const prior = byId.get(scene.id) || byReleaseUrl.get(scene.releaseUrl);
    const same = unchanged(scene, prior);
    const priorLinks = same ? ([...(prior.videoUrls || []), ...legacyLinks(prior)]).filter((link, index, links) =>
      ((link.source === "sxyprn" && validSxyprnUrl(link.url)) || link.source === "eporner") && links.findIndex((item) => item.source === link.source && item.url === link.url) === index) : [];
    const checkedAt = same ? Date.parse(prior.videoCheckedAt || prior.sxyprnCheckedAt) : NaN;
    const retained = { ...scene, ...(priorLinks.length ? { videoUrls: priorLinks } : {}),
      ...(Number.isFinite(checkedAt) ? { videoCheckedAt: prior.videoCheckedAt || prior.sxyprnCheckedAt } : {}) };
    if (!lookup || scene.releaseDate < cutoff || (Number.isFinite(checkedAt) && now.getTime() >= checkedAt && now.getTime() - checkedAt < DAY_MS)) {
      output.push(retained);
      continue;
    }
    try {
      const urls = [...new Set(await lookup(scene))].filter(validSxyprnUrl).slice(0, 2);
      const otherLinks = priorLinks.filter((link) => link.source !== "sxyprn");
      let working = scene;
      let scraped = false;
      if (!urls.length && scene.releaseUrl && scene.studioSiteNamingVersion !== namingVersion(scene)) {
        working = await scrape(scene, { fetchImpl, refreshExisting: true });
        scraped = true;
      }
      const links = urls.length ? [...urls.map((url) => ({ source: "sxyprn", url, embedUrl: null, verifiedAt: now.toISOString() })), ...otherLinks] : priorLinks;
      output.push({ ...working, ...(links.length ? { videoUrls: links } : {}), videoCheckedAt: now.toISOString(),
        ...(scraped ? { studioSiteNamingVersion: namingVersion(working) } : {}) });
    } catch {
      output.push(retained);
    }
  }
  return output;
}

export async function enrichStoredCatalogue(path, { lookup = createSxyprnLookup(), fallbackLookup, days = 14, shouldContinue = () => true, onProgress = () => {} } = {}) {
  const catalogue = await readStore(path);
  let changed = false;
  for (let index = 0; index < (catalogue.scenes || []).length; index++) {
    if (!shouldContinue()) break;
    const scene = catalogue.scenes[index];
    let [updated] = await enrichSxyprnLinks([scene], [scene], lookup, { days });
    if (fallbackLookup && !updated.videoUrls?.some((link) => link.source === "sxyprn") && Number.isFinite(updated.durationSec)) {
      try {
        const match = await fallbackLookup(updated);
        if (match) {
          const links = (updated.videoUrls || []).filter((link) => link.source !== "eporner");
          links.push({ source: "eporner", url: match.url, embedUrl: match.embed, verifiedAt: new Date().toISOString() });
          updated = { ...updated, videoUrls: links };
        }
      } catch {
        // Keep the last-good links when the fallback source is unavailable.
      }
    }
    if (JSON.stringify(updated) === JSON.stringify(scene) || !shouldContinue()) continue;
    catalogue.scenes[index] = updated;
    changed = true;
    onProgress(updated);
  }
  if (changed && shouldContinue()) await writeStore(path, catalogue);
}
