const API_BASE_URL = "https://api.theporndb.net";
const SITES_URL = `${API_BASE_URL}/sites`;
const PER_PAGE = 100;
const MAX_PAGES = 1000;

export const studio = {
  id: "tushy",
  name: "Tushy",
  authority: {
    name: "ThePornDB",
    url: `${API_BASE_URL}/scenes`,
    role: "authoritative catalogue",
  },
  fetchScenes: fetchTushyScenes,
};

function getSceneId(record) {
  return record.id ?? record.uuid ?? record._id ?? record.external_id;
}

export function parseTpdbScene(record, performerGenders = new Map()) {
  const sourceSceneId = getSceneId(record);
  if (!sourceSceneId || !record.date || !record.title) {
    throw new Error("TPDB scene is missing its ID, date, or title");
  }
  const performers = Array.isArray(record.performers)
    ? record.performers
      .filter((performer) => String(performer?.extras?.gender ?? performer?.gender ?? performerGenders.get(String(performer?.id ?? performer?.uuid ?? performer?._id)) ?? "").trim().toLowerCase() === "female")
      .map((performer) => performer?.name?.trim())
      .filter(Boolean)
    : [];
  const releaseUrl = record.url || `${API_BASE_URL}/scenes/${encodeURIComponent(sourceSceneId)}`;
  return {
    sourceSceneId: String(sourceSceneId),
    title: record.title.trim(),
    releaseDate: record.date,
    performers: [...new Set(performers)],
    thumbnailUrl: record.image || record.poster_image || record.poster || "",
    releaseUrl,
    source: "ThePornDB",
    provenance: {
      source: "ThePornDB",
      sourceUrl: studio.authority.url,
      recordUrl: releaseUrl,
      sourceSceneId: String(sourceSceneId),
    },
  };
}

async function requestJson(url, fetchImpl, apiKey) {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`TPDB request failed with HTTP ${response.status}`);
  const result = await response.json();
  if (!result || !Array.isArray(result.data)) throw new Error("TPDB returned an invalid response");
  return result.data;
}

async function requestPerformer(url, fetchImpl, apiKey) {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`TPDB performer lookup failed with HTTP ${response.status}`);
  const result = await response.json();
  if (!result || !result.data || typeof result.data !== "object") throw new Error("TPDB returned an invalid performer response");
  return result.data;
}

async function resolvePerformerGenders(records, fetchImpl, apiKey) {
  const performers = new Map();
  for (const record of records) {
    for (const performer of record.performers || []) {
      const identifier = performer?.id ?? performer?.uuid ?? performer?._id;
      const gender = performer?.extras?.gender ?? performer?.gender;
      if (identifier && !gender && !performers.has(String(identifier))) performers.set(String(identifier), null);
    }
  }
  const queue = [...performers.keys()];
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const identifier = queue.shift();
      const url = `${API_BASE_URL}/performers/${encodeURIComponent(identifier)}`;
      const performer = await requestPerformer(url, fetchImpl, apiKey);
      performers.set(identifier, performer?.extras?.gender ?? performer?.gender ?? "");
    }
  }));
  return performers;
}

async function findTushySite(fetchImpl, apiKey) {
  const url = new URL(SITES_URL);
  url.searchParams.set("q", "Tushy");
  url.searchParams.set("per_page", String(PER_PAGE));
  const sites = await requestJson(url, fetchImpl, apiKey);
  const site = sites.find((candidate) => candidate.name?.trim().toLowerCase() === "tushy"
    || candidate.short_name?.trim().toLowerCase() === "tushy");
  if (!site?.id) throw new Error("TPDB did not return a matching Tushy site");
  return site;
}

async function fetchPage(page, fetchImpl, apiKey, siteId, cutoff) {
  const url = new URL(`${API_BASE_URL}/scenes`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("site_id", String(siteId));
  url.searchParams.set("date", cutoff);
  url.searchParams.set("date_operation", ">=");
  return requestJson(url, fetchImpl, apiKey);
}

export async function fetchTushyScenes({ now = new Date(), days = 90, fetchImpl = fetch, apiKey = process.env.TPDB_API_KEY } = {}) {
  if (!apiKey) throw new Error("TPDB_API_KEY is not configured");
  const site = await findTushySite(fetchImpl, apiKey);
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await fetchPage(page, fetchImpl, apiKey, site.id, cutoff);
    records.push(...batch);
    if (batch.length < PER_PAGE) {
      const performerGenders = await resolvePerformerGenders(records, fetchImpl, apiKey);
      const scenes = records.map((record) => parseTpdbScene(record, performerGenders));
      return { scenes, verifiedEmpty: scenes.length === 0 };
    }
  }
  throw new Error(`TPDB pagination exceeded ${MAX_PAGES} pages`);
}
