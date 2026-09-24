const REQUEST_TIMEOUT_MS = 4_000;
const MAX_CANDIDATES = 3;
const COMMON_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);

function words(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) || [];
}

function titleWords(value) {
  return words(String(value || "").split(/\bfeaturing\b/i)[0]).filter((word) => !COMMON_WORDS.has(word));
}

function titleScore(left, right) {
  const a = new Set(titleWords(left));
  const b = new Set(titleWords(right));
  if (a.size < 3 || b.size < 3) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return Math.min(shared / a.size, shared / b.size);
}

function performerName(value) {
  const parts = words(value);
  if (parts.at(-1) === "ls") parts.pop();
  return parts.join(" ");
}

function hasPerformer(scene, details, candidate) {
  const haystacks = [details.title, ...(Array.isArray(details.models) ? details.models : []), candidate.title, candidate.keywords].map((value) => words(value).join(" "));
  return scene.performers.some((performer) => {
    const name = performerName(performer);
    return name.split(" ").length >= 2 && haystacks.some((value) => (` ${value} `).includes(` ${name} `));
  });
}

export function validEpornerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["eporner.com", "www.eporner.com"].includes(url.hostname) &&
      /^\/(?:video-[A-Za-z0-9]+|hd-porn\/[A-Za-z0-9]+)(?:\/[^?#]*)?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function request(baseUrl, path, fetchImpl) {
  const response = await fetchImpl(new URL(path, baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Lustpress returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.success !== true) throw new Error("Lustpress did not return a successful result");
  return body;
}

async function searchVideos(query, fetchImpl) {
  const url = new URL("https://www.eporner.com/api/v2/video/search/");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "50");
  url.searchParams.set("page", "1");
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Eporner search returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.videos)) throw new Error("Eporner search returned no videos array");
  return body.videos;
}

export function createEpornerLookup({ baseUrl, fetchImpl = fetch } = {}) {
  if (!baseUrl) return null;
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid Lustpress URL");

  return async (scene) => {
    if (!Array.isArray(scene.performers) || !scene.performers.length) return null;
    const performerNames = [...new Set(scene.performers.map(performerName).filter((name) => name.split(" ").length >= 2))];
    const performerWords = new Set(performerNames.flatMap(words));
    const titleQuery = titleWords(scene.title).filter((word) => !performerWords.has(word)).slice(0, 4).join(" ");
    const queries = [...new Set([...performerNames.slice(0, 2), titleQuery].filter(Boolean))];
    const candidates = new Map();
    for (const query of queries) {
      try {
        for (const item of await searchVideos(query, fetchImpl)) {
          if (!/^[A-Za-z0-9]{11}$/.test(item.id || "") || !validEpornerUrl(item.url)) continue;
          const score = titleScore(scene.title, item.title);
          if (score >= 0.55 && (!candidates.has(item.id) || candidates.get(item.id).score < score)) candidates.set(item.id, { score, item });
        }
      } catch {
        // One failed search must not prevent other queries.
      }
    }

    const ranked = [...candidates].sort((a, b) => b[1].score - a[1].score).slice(0, MAX_CANDIDATES);
    const verified = [];
    for (const [id, { item }] of ranked) {
      try {
        const lustpressId = new URL(item.url).pathname.startsWith("/video-") ? `video-${id}` : id;
        const result = await request(base, `/eporner/get?id=${encodeURIComponent(lustpressId)}`, fetchImpl);
        const score = titleScore(scene.title, result.data?.title);
        const sourcePath = validEpornerUrl(result.source) ? new URL(result.source).pathname : "";
        const sameVideo = sourcePath.startsWith(`/video-${id}/`) || sourcePath.startsWith(`/hd-porn/${id}/`);
        if (sameVideo && score >= 0.8 && hasPerformer(scene, result.data, item)) {
          verified.push({ url: result.source, score });
        }
      } catch {
        // A broken candidate is simply not verified.
      }
    }
    verified.sort((a, b) => b.score - a.score);
    if (verified.length > 1 && verified[0].score - verified[1].score < 0.1) return null;
    return verified[0]?.url || null;
  };
}

export async function enrichEpornerLinks(scenes, previousScenes, lookup, { concurrency = 4 } = {}) {
  if (!lookup) return scenes;
  const previous = new Map(previousScenes.map((scene) => [scene.id, scene]));
  const output = [...scenes];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, scenes.length) }, async () => {
    while (next < scenes.length) {
      const index = next++;
      const scene = scenes[index];
      const prior = previous.get(scene.id);
      if (prior?.epornerUrl && prior.title === scene.title && prior.releaseDate === scene.releaseDate &&
          JSON.stringify(prior.performers) === JSON.stringify(scene.performers) && validEpornerUrl(prior.epornerUrl)) {
        output[index] = { ...scene, epornerUrl: prior.epornerUrl };
        continue;
      }
      try {
        const url = await lookup(scene);
        if (url && validEpornerUrl(url)) output[index] = { ...scene, epornerUrl: url };
      } catch {
        // Eporner is optional enrichment; studio records remain available.
      }
    }
  }));
  return output;
}
