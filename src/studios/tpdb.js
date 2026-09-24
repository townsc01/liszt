const API_BASE_URL = "https://api.theporndb.net";
const SITES_URL = `${API_BASE_URL}/sites`;
const PER_PAGE = 100;
const MAX_PAGES = 1000;
const MAX_RATE_LIMIT_RETRIES = 4;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRateLimitRetry(url, options, fetchImpl) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, options);
    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;
    const retryAfter = Number(response.headers?.get?.("retry-after"));
    await delay(Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : Math.min(1000 * (2 ** attempt), 15_000));
  }
}

export function createTpdbStudio({ id, name, siteName = name, siteId, requireFemalePerformer = false }) {
  const adapter = {
  id,
  name,
  authority: {
    name: "ThePornDB",
    url: `${API_BASE_URL}/scenes`,
    role: "authoritative catalogue",
  },
  fetchScenes: (options) => fetchTpdbScenes({ ...options, siteName, siteId, requireFemalePerformer, sourceUrl: adapter.authority.url }),
  };
  return adapter;
}

export const fetchTushyScenes = (options) => fetchTpdbScenes({ ...options, siteName: "Tushy" });

const DEFAULT_SOURCE_URL = `${API_BASE_URL}/scenes`;

function getSceneId(record) {
  return record.id ?? record.uuid ?? record._id ?? record.external_id;
}

function isMaleGender(gender) {
  return ["male", "transgender male", "transgender_male"].includes(String(gender ?? "")
    .trim().toLowerCase().replace(/-/g, " "));
}

export function parseTpdbScene(record, performerGenders = new Map(), sourceUrl = DEFAULT_SOURCE_URL, { requireFemalePerformer = false } = {}) {
  const sourceSceneId = getSceneId(record);
  if (!sourceSceneId || !record.date || !record.title) {
    throw new Error("TPDB scene is missing its ID, date, or title");
  }
  const femalePresent = Array.isArray(record.performers) && record.performers.some((performer) => {
    const identifier = performer?.id ?? performer?.uuid ?? performer?._id;
    const name = performer?.name?.trim().toLowerCase();
    const gender = performer?.extras?.gender ?? performer?.gender ?? performerGenders.get(String(identifier)) ?? performerGenders.get(name) ?? "";
    return String(gender).trim().toLowerCase() === "female";
  });
  if (requireFemalePerformer && !femalePresent) return null;
  const performers = Array.isArray(record.performers)
    ? record.performers
      .filter((performer) => {
        const identifier = performer?.id ?? performer?.uuid ?? performer?._id;
        const name = performer?.name?.trim().toLowerCase();
        const gender = performer?.extras?.gender ?? performer?.gender ?? performerGenders.get(String(identifier)) ?? performerGenders.get(name) ?? "";
        return !isMaleGender(gender);
      })
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
      sourceUrl,
      recordUrl: releaseUrl,
      sourceSceneId: String(sourceSceneId),
    },
  };
}

async function requestJson(url, fetchImpl, apiKey) {
  const response = await fetchWithRateLimitRetry(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  }, fetchImpl);
  if (!response.ok) throw Object.assign(new Error(`TPDB request failed with HTTP ${response.status}`), { status: response.status });
  const result = await response.json();
  if (!result || !Array.isArray(result.data)) throw new Error("TPDB returned an invalid response");
  return result.data;
}

async function requestPerformer(url, fetchImpl, apiKey) {
  const response = await fetchWithRateLimitRetry(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  }, fetchImpl);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`TPDB performer lookup failed with HTTP ${response.status}`);
  const result = await response.json();
  if (!result || !result.data || typeof result.data !== "object") throw new Error("TPDB returned an invalid performer response");
  return result.data;
}

async function findPerformerGender(name, fetchImpl, apiKey) {
  const url = new URL(`${API_BASE_URL}/performers`);
  url.searchParams.set("q", name);
  const target = name.trim().toLowerCase();
  try {
    url.searchParams.set("gender", "FEMALE");
    const filtered = await requestJson(url, fetchImpl, apiKey);
    const female = filtered.find((candidate) => [candidate.name, candidate.full_name]
      .some((candidateName) => candidateName?.trim().toLowerCase() === target));
    if (female) return female.extras?.gender ?? female.gender ?? "Female";
  } catch (error) {
    if (error.status !== 422) throw error;
  }

  url.searchParams.delete("gender");
  const candidates = await requestJson(url, fetchImpl, apiKey);
  const performer = candidates.find((candidate) => [candidate.name, candidate.full_name]
    .some((candidateName) => candidateName?.trim().toLowerCase() === target));
  return performer?.extras?.gender ?? performer?.gender ?? "";
}

async function resolvePerformerGenders(records, fetchImpl, apiKey) {
  const performers = new Map();
  for (const record of records) {
    for (const performer of record.performers || []) {
      const identifier = performer?.id ?? performer?.uuid ?? performer?._id;
      const gender = performer?.extras?.gender ?? performer?.gender;
      const name = performer?.name?.trim();
      if (gender) {
        if (identifier) performers.set(String(identifier), gender);
        if (name) performers.set(name.toLowerCase(), gender);
      } else {
        if (identifier && !performers.has(String(identifier))) performers.set(String(identifier), null);
        if (name && !performers.has(name.toLowerCase())) performers.set(name.toLowerCase(), null);
      }
    }
  }
  const queue = [...new Set((records.flatMap((record) => record.performers || []))
    .filter((performer) => !performer?.extras?.gender && !performer?.gender)
    .map((performer) => ({ identifier: performer?.id ?? performer?.uuid ?? performer?._id, name: performer?.name?.trim() }))
    .filter(({ identifier, name }) => identifier || name)
    .map(({ identifier, name }) => `${identifier ? `id:${identifier}` : ""}${identifier && name ? "|" : ""}${name ? `name:${name.toLowerCase()}` : ""}`))];
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const key = queue.shift();
      const [, identifier] = key.match(/(?:^|\|)id:([^|]+)/) || [];
      const [, name] = key.match(/(?:^|\|)name:(.*)$/) || [];
      let gender = "";
      if (identifier) {
        const performer = await requestPerformer(`${API_BASE_URL}/performers/${encodeURIComponent(identifier)}`, fetchImpl, apiKey);
        gender = performer?.extras?.gender ?? performer?.gender ?? "";
      }
      if (gender) {
        if (identifier) performers.set(identifier, gender);
        if (name) performers.set(name, gender);
      } else {
        const resolvedGender = name ? await findPerformerGender(name, fetchImpl, apiKey) : "";
        const effectiveGender = resolvedGender || "Unknown";
        if (identifier) performers.set(identifier, effectiveGender);
        if (name) performers.set(name, effectiveGender);
      }
    }
  }));
  return performers;
}

async function findTpdbSite(siteName, fetchImpl, apiKey) {
  const url = new URL(SITES_URL);
  url.searchParams.set("q", siteName);
  url.searchParams.set("per_page", String(PER_PAGE));
  const sites = await requestJson(url, fetchImpl, apiKey);
  const target = siteName.trim().toLowerCase();
  const site = sites.find((candidate) => candidate.name?.trim().toLowerCase() === target
    || candidate.short_name?.trim().toLowerCase() === target);
  if (!site?.id) throw new Error(`TPDB did not return a matching ${siteName} site`);
  return site;
}

async function fetchPage(page, fetchImpl, apiKey, siteId, cutoff, { requireFemalePerformer = false } = {}) {
  const url = new URL(`${API_BASE_URL}/scenes`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("site_id", String(siteId));
  url.searchParams.set("date", cutoff);
  url.searchParams.set("date_operation", ">=");
  if (requireFemalePerformer) url.searchParams.set("performer_genders[Female]", "1");
  return requestJson(url, fetchImpl, apiKey);
}

export async function fetchTpdbScenes({ now = new Date(), days = 90, fetchImpl = fetch, apiKey = process.env.TPDB_API_KEY, siteName, siteId: configuredSiteId, sourceUrl = DEFAULT_SOURCE_URL, requireFemalePerformer = false } = {}) {
  if (!apiKey) throw new Error("TPDB_API_KEY is not configured");
  if (!configuredSiteId && !siteName) throw new Error("TPDB siteName or siteId is required");
  const site = configuredSiteId ? { id: configuredSiteId } : await findTpdbSite(siteName, fetchImpl, apiKey);
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await fetchPage(page, fetchImpl, apiKey, site.id, cutoff, { requireFemalePerformer });
    records.push(...batch);
    if (batch.length < PER_PAGE) {
      const performerGenders = await resolvePerformerGenders(records, fetchImpl, apiKey);
      const scenes = records.map((record) => parseTpdbScene(record, performerGenders, sourceUrl, { requireFemalePerformer })).filter(Boolean);
      return { scenes, verifiedEmpty: scenes.length === 0 };
    }
  }
  throw new Error(`TPDB pagination exceeded ${MAX_PAGES} pages`);
}
