import {
  fetchWithRateLimitRetry,
  requestJson,
  findTpdbSite,
  resolvePerformerGenders,
  parseTpdbScene,
} from "./tpdb.js";
import { mapWithConcurrency } from "../concurrency.js";
import { metadataIncomplete, enrichFromStudioSite } from "../studio-site.js";

const API_BASE_URL = "https://api.theporndb.net";
const SITES_URL = `${API_BASE_URL}/sites`;
const PER_PAGE = 100;
const MAX_PAGES = 1000;

const ANAL_CATEGORIES = new Set([
  "anal",
  "anal sex",
  "analplay",
  "anal-play",
  "buttsex",
  "assfuck",
  "ass fuck",
  "backdoor",
  "sodomy",
  "greek",
]);

function hasAnalCategory(record) {
  const cats = record.categories || record.tags || record.genres || [];
  return Array.isArray(cats) && cats.some((c) => ANAL_CATEGORIES.has(String(c).trim().toLowerCase()));
}

function titleSuggestsAnal(title) {
  const t = String(title || "").toLowerCase();
  return /\banal\b|assfuck|ass\s*fuck|backdoor|sodomy|greek/.test(t);
}

async function fetchJulesJordanAnalScenes({
  now = new Date(),
  days = 90,
  fetchImpl = fetch,
  apiKey = process.env.TPDB_API_KEY,
  siteName = "Jules Jordan Video",
  sourceUrl = `${API_BASE_URL}/scenes`,
} = {}) {
  if (!apiKey) throw new Error("TPDB_API_KEY is not configured");
  const site = await findTpdbSite(siteName, fetchImpl, apiKey);
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const records = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${API_BASE_URL}/scenes`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("site_id", String(site.id));
    url.searchParams.set("date", cutoff);
    url.searchParams.set("date_operation", ">=");
    url.searchParams.set("performer_genders[Female]", "1");
    const batch = await requestJson(url, fetchImpl, apiKey);
    records.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  const analRecords = records.filter((record) => hasAnalCategory(record) || titleSuggestsAnal(record.title));
  const performerGenders = await resolvePerformerGenders(analRecords, fetchImpl, apiKey);
  const parsed = analRecords.map((record) => parseTpdbScene(record, performerGenders, sourceUrl, { requireFemalePerformer: true })).filter(Boolean);
  const scenes = await mapWithConcurrency(parsed, (scene) => metadataIncomplete(scene) && !scene.releaseUrl.startsWith(`${API_BASE_URL}/`)
    ? enrichFromStudioSite(scene, { fetchImpl })
    : scene);
  return { scenes, verifiedEmpty: scenes.length === 0 };
}

export const studio = {
  id: "jules-jordan",
  name: "Jules Jordan",
  authority: { name: "ThePornDB", url: `${API_BASE_URL}/scenes`, role: "authoritative catalogue" },
  fetchScenes: fetchJulesJordanAnalScenes,
};