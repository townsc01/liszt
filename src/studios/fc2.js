/**
 * FC2 lane source client - fc2cmadb.com (see docs/specs/fc2-anal-uncensored.md).
 *
 * SCOPE (#103): union crawl across the アナル tag + its aliases (section 11.5), the measured
 * rate limits (section 2), and raw Inertia-JSON extraction. This cut deliberately contains
 * NO filter/admission logic:
 *   - The section 3 safety screen (minor/non-consent lexicon), the trans/crossdress backstop,
 *     and the censorship gate are hard blocks that MUST run on every sync. They are owned by
 *     #104 so each lexicon is implemented once, not duplicated here.
 *   - The 11.1 activity-based seller admission, the 11.1a orientation filter, and the 11.2
 *     precision blocklist are also #104.
 *   - The lane adapter, sync wiring, seller-as-studio display, and translation are #113/#105/#106.
 *
 * fc2cmadb is Laravel + Inertia + Vue. Every page embeds its full data as JSON in
 * `<script data-page="app" type="application/json">`, and exposes the route table as
 * `const Ziggy = {...}`, so extraction is deterministic and needs no DOM parsing.
 *
 * Rate limits (measured 2026-09-24, section 2): detail pages ~one per 8-9s; faster returns
 * HTTP 429 and a ~30-60 minute ban. Listing pages are cheap but stay >= 2s apart. A full
 * 8,891-fetch history crawl is ~20 hours; ongoing sync only fetches details for newly listed
 * video_ids, budgeted per run.
 */
const USER_AGENT = "Liszt catalogue updater/1.0";
const DEFAULT_TIMEOUT_MS = 30_000;

export const BASE_URL = "https://fc2cmadb.com";
export const ARTICLES_URL = `${BASE_URL}/articles`;
export const TAGS_URL = `${BASE_URL}/tags`;

/** The primary tag (site tag id 47). */
export const PRIMARY_TAG = "アナル";
/** Section 11.5 aliases polled alongside アナル for ALL sellers. */
export const ALIAS_TAGS = ["アナルファック", "アナル中出し", "尻穴", "ケツ穴", "肛門", "2穴", "二穴"];
/** Noisy aliases: crawled for seller-activity data; their items pass the same filters. */
export const NOISY_ALIAS_TAGS = ["アナルセックス", "アナル拡張"];
/** The full union the crawler walks. */
export const UNION_TAGS = [PRIMARY_TAG, ...ALIAS_TAGS, ...NOISY_ALIAS_TAGS];

/** Section 2 measured limits. */
export const DETAIL_DELAY_MS = 8_500;
export const LISTING_DELAY_MS = 2_000;
/** Section 7: detail fetches per run (FC2_DETAIL_BUDGET, default 60 ~ 9 minutes). */
export const DEFAULT_DETAIL_BUDGET = 60;
/** Section 7: on HTTP 429, stop the tier and back off 60 minutes. */
export const RATE_LIMIT_BACKOFF_MS = 60 * 60_000;

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Raised for HTTP 429 so the caller can stop the tier and back off rather than retry. */
export class RateLimitError extends Error {
  constructor(url) {
    super(`fc2cmadb rate limit (HTTP 429) at ${url}`);
    this.name = "RateLimitError";
    this.status = 429;
  }
}

/** Raised when a page carries no Inertia page object (layout change, error page, empty body). */
export class InertiaParseError extends Error {
  constructor(message, { url = "" } = {}) {
    super(message);
    this.name = "InertiaParseError";
    this.url = url;
  }
}

/** `GET /tags/{tag_name}` for a Japanese tag name (percent-encoded, as the site emits). */
export function tagListingUrl(tag) {
  return `${TAGS_URL}/${encodeURIComponent(tag)}`;
}

/** `GET /articles/{video_id}` - the database record, not the FC2 store page. */
export function articleUrl(videoId) {
  return `${ARTICLES_URL}/${encodeURIComponent(String(videoId))}`;
}

/**
 * Extract the Inertia page object `{ component, props, url, version, sharedProps, ... }`
 * from a page's `<script data-page="app">` JSON. Throws if the marker is absent.
 */
export function parseInertiaPage(html, { url = "" } = {}) {
  const match = String(html).match(/<script\b[^>]*\bdata-page=["']app["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new InertiaParseError("no data-page=\"app\" Inertia payload found", { url });
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new InertiaParseError(`Inertia payload is not valid JSON: ${error.message}`, { url });
  }
}

/** The Inertia props object (`page.props`), or an empty object when absent. */
export function parseInertiaProps(html, { url = "" } = {}) {
  return parseInertiaPage(html, { url }).props || {};
}

/**
 * Extract the in-page `const Ziggy = {...}` route table. Optional: the crawler hard-codes the
 * two routes it uses, so a missing table is not fatal - this exists for drift detection.
 */
export function parseRouteTable(html) {
  const text = String(html);
  const marker = text.indexOf("const Ziggy=");
  if (marker === -1) return null;
  const start = marker + "const Ziggy=".length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Normalise a `writer` (seller) object; FC2 is a marketplace, so this is the closest studio. */
export function parseWriter(writer) {
  if (!writer || typeof writer !== "object") return null;
  return {
    id: writer.id ?? null,
    slug: writer.slug ?? null,
    name: writer.name ?? null,
  };
}

function normaliseTag(tag) {
  if (typeof tag === "string") return { name: tag, tagId: null };
  if (!tag || typeof tag !== "object") return null;
  return { name: tag.name ?? null, tagId: tag.pivot?.tag_id ?? tag.tag_id ?? null };
}

/** Normalise one listing row. `censored` is always null on listings - detail carries the badge. */
export function parseListingItem(item) {
  const videoId = item?.video_id;
  if (videoId == null) return null;
  return {
    videoId: String(videoId),
    articleId: item.id ?? null,
    title: item.title ?? "",
    releaseDate: String(item.release_date ?? "").slice(0, 10),
    duration: item.duration ?? null,
    imageUrl: item.image_url ?? null,
    // The listing always carries censored: null, even for marked items (section 2).
    censored: item.censored ?? null,
    notFound: item.not_found ?? null,
    status: item.status ?? null,
    salePercentage: item.sale_percentage ?? null,
    saleLimiteDate: item.sale_limite_date ?? null,
    writer: parseWriter(item.writer),
    writerId: item.writer_id ?? item.writer?.id ?? null,
    pivotTagId: item.pivot?.tag_id ?? null,
  };
}

/**
 * Extract the listing page: the 30 normalised rows plus the cursor URL for the next page
 * (null on the final page). `props.articles` is a cursor-paginated object.
 */
export function parseListingProps(props) {
  const articles = props?.articles;
  const rows = Array.isArray(articles?.data) ? articles.data : [];
  return {
    items: rows.map(parseListingItem).filter(Boolean),
    nextPageUrl: articles?.next_page_url ?? null,
    perPage: articles?.per_page ?? null,
    path: articles?.path ?? null,
    tagName: props?.tag_name ?? null,
  };
}

/** Extract the article detail page (section 2/4 fields) as raw, unfiltered data. */
export function parseArticleProps(props) {
  const article = props?.article;
  if (!article || article.video_id == null) {
    throw new InertiaParseError("article props carry no video_id");
  }
  const videoId = String(article.video_id);
  const tags = Array.isArray(article.tags) ? article.tags.map(normaliseTag).filter(Boolean) : [];
  return {
    videoId,
    articleId: article.id ?? null,
    title: article.title ?? "",
    releaseDate: String(article.release_date ?? "").slice(0, 10),
    duration: article.duration ?? null,
    imageUrl: article.image_url ?? null,
    // The censorship badge is only present here: 無 (uncensored) / 有 (censored) / null (unmarked),
    // or the section 3.3 mixed form "通常版：有 特典版：無" - all preserved verbatim for #104.
    censored: article.censored ?? null,
    notFound: article.not_found ?? null,
    status: article.status ?? null,
    salePercentage: article.sale_percentage ?? null,
    saleLimiteDate: article.sale_limite_date ?? null,
    bookmarkCount: article.bookmark_count ?? null,
    likeCount: article.like_count ?? null,
    writer: parseWriter(article.writer),
    writerId: article.writer_id ?? article.writer?.id ?? null,
    tags,
    tagNames: tags.map((tag) => tag.name).filter(Boolean),
    releaseUrl: articleUrl(videoId),
  };
}

/** Convenience: article detail straight from HTML. */
export function parseArticlePage(html, { url = "" } = {}) {
  return parseArticleProps(parseInertiaProps(html, { url }));
}

/**
 * Deterministic pacing: guarantees >= `delayMs` between the start of consecutive requests.
 * `now`/`sleep` are injectable so tests can assert the spacing without waiting.
 */
export function createRequestPacer({ delayMs = LISTING_DELAY_MS, now = Date.now, sleep: sleepImpl = sleep } = {}) {
  let last = null;
  return async function pace() {
    if (last !== null) {
      const waitMs = delayMs - (now() - last);
      if (waitMs > 0) await sleepImpl(waitMs);
    }
    last = now();
  };
}

/**
 * A paced HTML fetcher. Throws `RateLimitError` on HTTP 429 (never retries: the ban is long)
 * and a plain Error on any other non-OK status, so the caller can keep last-good records.
 */
export function createPageFetcher({ fetchImpl = fetch, pacer, userAgent = USER_AGENT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async function fetchPage(url, { headers = {} } = {}) {
    await pacer?.();
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": userAgent, ...headers },
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.status === 429) throw new RateLimitError(url);
      if (!response.ok) {
        const error = new Error(`fc2cmadb request failed with HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return { html: await response.text(), url: response.url || String(url), status: response.status, headers: response.headers };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

/**
 * Inertia-aware fetch. A partial reload sends `X-Inertia` + the page `version`; if the site has
 * redeployed, the version is stale and it answers HTTP 409 - re-fetch the plain HTML (which
 * carries the new version) and retry once (section 2).
 */
export function createInertiaClient({ fetchPage, maxVersionRetries = 1, onLog = () => {} } = {}) {
  return async function fetchInertia(url, { version, partial, headers = {} } = {}) {
    const inertiaHeaders = { ...headers };
    if (version) inertiaHeaders["x-inertia"] = "true";
    if (version && partial?.component) inertiaHeaders["x-inertia-version"] = version;
    if (version && partial?.component) inertiaHeaders["x-inertia-partial-component"] = partial.component;
    if (version && partial?.data) inertiaHeaders["x-inertia-partial-data"] = partial.data;
    try {
      return await fetchPage(url, { headers: inertiaHeaders });
    } catch (error) {
      if (error.status !== 409 || maxVersionRetries <= 0) throw error;
      onLog(`fc2: Inertia version stale at ${url}; re-reading the page for the new version`);
      return fetchInertia(url, { version: null, partial, headers });
    }
  };
}

/**
 * Walk one tag listing newest-first. Stops when: the page carries no cursor, `maxPages` is
 * reached, or a page has no unseen video_id (`stopOnKnown`, for the cheap ongoing poll).
 */
export async function walkTag(tag, { fetchPage, maxPages = 1, knownIds = new Set(), stopOnKnown = true, onLog = () => {} } = {}) {
  const seen = knownIds instanceof Set ? knownIds : new Set(knownIds.map(String));
  const items = [];
  const pages = [];
  let version = null;
  let url = tagListingUrl(tag);
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(url);
    const inertia = parseInertiaPage(response.html, { url });
    version = inertia.version ?? version;
    const parsed = parseListingProps(inertia.props);
    pages.push({ page, url, count: parsed.items.length });
    for (const item of parsed.items) items.push({ ...item, sourceTags: [tag] });
    if (!parsed.nextPageUrl) break;
    if (stopOnKnown && parsed.items.length && !parsed.items.some((item) => !seen.has(item.videoId))) {
      onLog(`fc2: ${tag} page ${page} is all known ids; stopping the walk`);
      break;
    }
    url = parsed.nextPageUrl;
  }
  return { tag, items, pages, version, nextPageUrl: null };
}

/**
 * Union crawl across the tags (section 11.5). Items are deduplicated by video_id; when an item
 * appears on several tags its `sourceTags` accumulate, which is the seller-activity evidence
 * #104's 11.1 admission recomputes each sync. An HTTP 429 stops the whole tier and reports it.
 */
export async function crawlUnion({ tags = UNION_TAGS, fetchPage, maxPages = 1, knownIds = [], stopOnKnown = true, onLog = () => {} } = {}) {
  const seen = new Set(knownIds.map(String));
  const items = new Map();
  const tagPages = [];
  let version = null;
  let rateLimited = false;
  for (const tag of tags) {
    try {
      const walk = await walkTag(tag, { fetchPage, maxPages, knownIds: seen, stopOnKnown, onLog });
      tagPages.push({ tag, pages: walk.pages.length });
      version = walk.version ?? version;
      for (const item of walk.items) {
        const existing = items.get(item.videoId);
        if (existing) {
          for (const sourceTag of item.sourceTags) if (!existing.sourceTags.includes(sourceTag)) existing.sourceTags.push(sourceTag);
        } else {
          items.set(item.videoId, item);
        }
      }
    } catch (error) {
      if (error instanceof RateLimitError) {
        onLog(`fc2: listing rate limited at tag ${tag}; stopping the listing tier`);
        rateLimited = true;
        break;
      }
      throw error;
    }
  }
  return { items, tagPages, version, rateLimited, tags };
}

/**
 * Order the detail-fetch queue: unseen video_ids first (newest first), then pending re-checks,
 * capped at `budget` (section 7). `pendingIds` is supplied by #104's badge-null queue.
 */
export function selectDetailTargets(items, { knownIds = [], pendingIds = [], budget = DEFAULT_DETAIL_BUDGET } = {}) {
  const known = new Set(knownIds.map(String));
  const pending = new Set(pendingIds.map(String));
  const list = [...items];
  const fresh = list.filter((item) => !known.has(item.videoId) && !pending.has(item.videoId))
    .sort((left, right) => String(right.releaseDate).localeCompare(String(left.releaseDate)));
  const recheck = list.filter((item) => pending.has(item.videoId) && !known.has(item.videoId))
    .sort((left, right) => String(right.releaseDate).localeCompare(String(left.releaseDate)));
  return [...fresh, ...recheck].slice(0, Math.max(0, budget))
    .map((item) => ({ videoId: item.videoId, reason: pending.has(item.videoId) ? "pending" : "new", item }));
}

/**
 * Fetch the budgeted detail pages at the measured detail rate. A 429 stops the tier at once
 * (no retry) and reports `rateLimited` so the caller can back off 60 minutes. Other per-item
 * failures are logged and skipped - one bad page must not lose the rest of the run.
 */
export async function fetchDetails(targets, { fetchDetailPage, onLog = () => {} } = {}) {
  const details = [];
  const errors = [];
  let rateLimited = false;
  for (const target of targets) {
    try {
      const response = await fetchDetailPage(articleUrl(target.videoId), { version: target.version });
      details.push({ ...parseArticlePage(response.html, { url: response.url }), reason: target.reason });
    } catch (error) {
      if (error instanceof RateLimitError) {
        onLog(`fc2: detail rate limited at ${target.videoId}; stopping the detail tier`);
        rateLimited = true;
        break;
      }
      errors.push({ videoId: target.videoId, message: error.message });
      onLog(`fc2: detail fetch failed for ${target.videoId}: ${error.message}`);
    }
  }
  return { details, errors, rateLimited };
}

/**
 * One crawl pass: union listing walk + budgeted detail fetch for the new/pending queue.
 * Returns raw extraction only - the caller (#104/#113) owns admission and filtering.
 */
export async function fetchFc2Crawl({
  now = new Date(),
  tags = UNION_TAGS,
  knownIds = [],
  pendingIds = [],
  listingPagesPerTag = 1,
  detailBudget = DEFAULT_DETAIL_BUDGET,
  fetchImpl = fetch,
  listingDelayMs = LISTING_DELAY_MS,
  detailDelayMs = DETAIL_DELAY_MS,
  sleep: sleepImpl,
  onLog = () => {},
} = {}) {
  const fetchPage = createPageFetcher({ fetchImpl, pacer: createRequestPacer({ delayMs: listingDelayMs, sleep: sleepImpl }) });
  const detailPage = createPageFetcher({ fetchImpl, pacer: createRequestPacer({ delayMs: detailDelayMs, sleep: sleepImpl }) });
  // Detail pages go through the Inertia client so a stale-version 409 re-reads the HTML instead
  // of failing the item. The deferred `actresses` prop is deliberately not requested (section 2).
  const fetchDetailPage = createInertiaClient({ fetchPage: detailPage, onLog });
  const union = await crawlUnion({ tags, fetchPage, maxPages: listingPagesPerTag, knownIds, onLog });
  const items = [...union.items.values()];
  if (union.rateLimited) {
    return { items, details: [], targets: [], errors: [], rateLimited: true, backoffUntil: new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS), tagPages: union.tagPages, tags: union.tags };
  }
  const targets = selectDetailTargets(items, { knownIds, pendingIds, budget: detailBudget })
    .map((target) => ({ ...target, version: union.version }));
  const { details, errors, rateLimited } = await fetchDetails(targets, { fetchDetailPage, onLog });
  return {
    items,
    details,
    targets,
    errors,
    rateLimited,
    backoffUntil: rateLimited ? new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS) : null,
    tagPages: union.tagPages,
    tags: union.tags,
  };
}
