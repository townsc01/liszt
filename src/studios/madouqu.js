/**
 * Madouqu lane adapter - mainland/Taiwan releases (male-on-female, penetrative) from
 * the madouqu.com WordPress REST API. Metadata/catalogue only: no playback links and
 * no matcher (`matcher: null`), per docs/specs/madouqu-mainland-taiwan-anal.md.
 *
 * The `search` parameter matches post content as well as titles, so results are
 * re-filtered against the title only: the title lexicon is the actual gate.
 */
const BASE_URL = "https://madouqu.com";
export const POSTS_URL = `${BASE_URL}/wp-json/wp/v2/posts`;
export const CATEGORIES_URL = `${BASE_URL}/wp-json/wp/v2/categories`;
const USER_AGENT = "Liszt catalogue updater/1.0";
const PER_PAGE = 100;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 3;

/** The seven anal search terms used by the 2026-09-24 run and the ongoing poll. */
export const ANAL_TERMS = ["肛交", "后庭", "屁眼", "肛门", "三通", "爆菊", "爆肛"];

// Section 3.1 safety screen (hard block, runs on every sync before anything is shown).
const SAFETY_LEXICON = ["萝莉", "幼女", "未成年", "初中", "小学", "迷奸", "强奸", "昏迷", "偷拍"];
// Section 3.2 trans/gay backstop.
const TRANS_LEXICON = ["伪娘", "人妖", "TS", "ladyboy", "男男", "耽美"];

// Section 3.3 anal gate. The spec lists 肛交/后庭/屁眼/肛门/三通/爆菊/爆肛; the
// 2026-09-24 run additionally matched the compound family (菊穴/菊花, 肛奴, 双洞/双穴/
// 双插/双通/双开/双龙入洞). The seed's matched_terms column records those matches
// (e.g. 74447 is 爆菊 via 菊花), so the gate carries the family terms to reproduce the
// 151-row acceptance baseline.
const ANAL_GATE = ["肛", "后庭", "屁眼", "菊", "三通", "双通", "双插", "双洞", "双穴", "双开", "双龙入洞", "爆菊", "爆肛"];
// Section 3.4 keep: unambiguous penetrative evidence.
const STRONG_PENETRATION = ["肛交", "爆菊", "爆肛", "三通", "双通", "双插", "双洞", "双穴", "双开", "双龙入洞", "菊"];
// Section 3.4 drop: play/toys.
const PLAY_LEXICON = ["肛塞", "肛钩", "灌肠", "指奸", "拳交", "跳蛋", "钢球", "扩张", "道具", "玩法", "塞", "堵", "灌满", "自慰", "裸舞", "露出", "秀", "调教"];
// Section 3.4 penetration verbs: 后庭/屁眼/肛门 combined with these is penetrative.
const PENETRATION_VERBS = ["操", "干", "肏", "内射", "中出", "爆草", "狂草", "抽插", "抽送", "猛插", "深插", "狂插", "插入", "换插", "齐入", "后入", "捅", "怼", "骑", "骑乘", "吞吐", "接龙", "无套", "解锁", "射满", "喷射", "射精", "注满", "交配", "抚慰", "淫辱", "群交", "群P", "乱交", "多P", "4P", "3P", "双飞", "开发", "啪啪", "戳", "开后庭", "轮"];

/** Section 5 label romanisation warm-start, keyed by category slug. */
export const LABEL_DISPLAY = {
  xb: "Xingba Media", tx: "Tangxin VLOG", modelmedia: "Madou Media", peachmedia: "Peach Media",
  xk: "Xingkong Infinite Media", tm: "Tianmei Media", gd: "Jelly Media", jd: "Jingdong Pictures",
  id: "AiDou Media", dx: "Elephant Media", hjhr: "Royal Chinese", cm: "Strawberry Video", jvid: "JVID",
};

/** Section 5 title glossary (functional filter mappings, not prose). */
export const TITLE_GLOSSARY = [
  { term: "肛交", english: "anal sex" }, { term: "爆菊", english: "anal" }, { term: "爆肛", english: "anal" },
  { term: "三通", english: "triple penetration" }, { term: "后庭", english: "anal" }, { term: "屁眼", english: "asshole" },
  { term: "肛门", english: "anus" }, { term: "肛塞", english: "butt plug" }, { term: "肛钩", english: "anal hook" },
  { term: "灌肠", english: "enema" }, { term: "指奸", english: "fingering" }, { term: "拳交", english: "fisting" },
  { term: "跳蛋", english: "vibrator" }, { term: "钢球", english: "balls" }, { term: "扩张", english: "stretching" },
  { term: "人妻", english: "wife" }, { term: "极品", english: "top-tier" }, { term: "调教", english: "training" },
  { term: "淫荡", english: "slutty" }, { term: "母狗", english: "bitch" }, { term: "白丝", english: "white stockings" },
  { term: "黑丝", english: "black stockings" }, { term: "空姐", english: "flight attendant" }, { term: "约炮", english: "hookup" },
  { term: "内射", english: "creampie" }, { term: "吞精", english: "swallowing" }, { term: "喷水", english: "squirting" },
  { term: "群交", english: "group sex" }, { term: "4P", english: "foursome" }, { term: "3P", english: "threesome" },
  { term: "自慰", english: "masturbation" }, { term: "偷拍", english: "voyeur" }, { term: "迷奸", english: "drugged" },
];

const includesAny = (text, lexicon) => lexicon.filter((term) => text.includes(term));
const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * Section 3 filter, applied in order. Returns the classification plus the matched
 * terms so every exclusion can be logged with its reason.
 */
export function classifyTitle(title) {
  const text = String(title ?? "");
  const safety = includesAny(text, SAFETY_LEXICON);
  if (safety.length) return { content: "excluded", reason: "safety", terms: safety };
  const trans = TRANS_LEXICON.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  if (trans.length) return { content: "excluded", reason: "trans", terms: trans };
  const gate = includesAny(text, ANAL_GATE);
  if (!gate.length) return { content: "excluded", reason: "no-anal-term", terms: [] };
  const strong = includesAny(text, STRONG_PENETRATION);
  const play = includesAny(text, PLAY_LEXICON);
  const verbs = includesAny(text, PENETRATION_VERBS);
  if (strong.length || verbs.length || !play.length) return { content: "anal sex", reason: null, terms: gate };
  return { content: "anal play", reason: "play-only", terms: play };
}

/** Map the categories endpoint to per-label studio identities, logging unmapped ids. */
export function mapCategories(categories = [], { onLog = () => {} } = {}) {
  const byId = new Map();
  for (const category of categories) {
    const slug = category?.slug;
    if (!category?.id || !slug) continue;
    const display = LABEL_DISPLAY[slug];
    if (!display) onLog(`madouqu: unmapped category ${category.id} ${category.name} (${slug})`);
    byId.set(category.id, { slug, name: category.name, display: display || category.name, unmapped: !display });
  }
  return byId;
}

function categoryFor(post, categories) {
  const id = Array.isArray(post?.categories) ? post.categories[0] : null;
  return categories.get(id) || null;
}

function postTitle(post) {
  return String(post?.title?.rendered ?? "").trim();
}

function thumbnailFrom(post) {
  const jetpack = post?.jetpack_featured_media_url;
  return typeof jetpack === "string" && jetpack ? jetpack : "";
}

/** Build a scene record. Titles stay untranslated here - translation is a background pass. */
export function parsePost(post, { categories = new Map(), thumbnailUrl = "" } = {}) {
  const originalTitle = postTitle(post);
  const sourceSceneId = String(post.id);
  const label = categoryFor(post, categories);
  return {
    sourceSceneId,
    title: originalTitle,
    originalTitle,
    titleTranslated: false,
    translationProvider: "none",
    releaseDate: String(post.date_gmt || post.date).slice(0, 10),
    performers: [],
    thumbnailUrl: thumbnailUrl || thumbnailFrom(post),
    releaseUrl: post.link,
    source: "madouqu",
    studioCode: post.slug,
    tags: ["anal"],
    ...(label ? { studioId: `madouqu-${label.slug}`, studio: label.display } : {}),
    provenance: {
      source: "madouqu",
      sourceUrl: POSTS_URL,
      recordUrl: post.link,
      sourceSceneId,
      date: post.date,
      dateGmt: post.date_gmt,
      ...(label ? { categoryId: label.slug } : {}),
    },
  };
}

/**
 * Politeness-bounded JSON fetch: >= `delayMs` between requests, retry on 429, and a
 * hard error on any other non-OK response so the sync keeps last-good records.
 */
export function createJsonFetcher({ fetchImpl = fetch, delayMs = DEFAULT_DELAY_MS, maxRetries = DEFAULT_MAX_RETRIES, onRequest = () => {} } = {}) {
  let lastRequest = 0;
  return async function fetchJson(url) {
    for (let attempt = 0; ; attempt += 1) {
      await sleep(delayMs - (Date.now() - lastRequest));
      lastRequest = Date.now();
      onRequest(url);
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
      if (response.status === 429 && attempt < maxRetries) {
        await sleep(Math.min(1000 * 2 ** attempt, 15_000));
        continue;
      }
      if (!response.ok) throw new Error(`madouqu request failed with HTTP ${response.status}`);
      return { json: await response.json(), headers: response.headers };
    }
  };
}

/** Walk a search term's pages, stopping on a short page, the last page, or a page of known ids. */
export async function walkSearch(term, { fetchJson, isSeen = () => false, maxPages = 2, perPage = PER_PAGE } = {}) {
  const posts = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(POSTS_URL);
    url.searchParams.set("search", term);
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const { json, headers } = await fetchJson(url.href);
    const batch = Array.isArray(json) ? json : [];
    posts.push(...batch);
    const totalPages = Number(headers?.get?.("x-wp-totalpages")) || 1;
    if (batch.length < perPage || page >= totalPages) break;
    if (!batch.some((post) => !isSeen(post.id))) break;
  }
  return posts;
}

export async function fetchCategories(fetchJson) {
  const url = new URL(CATEGORIES_URL);
  url.searchParams.set("per_page", String(PER_PAGE));
  const { json } = await fetchJson(url.href);
  return Array.isArray(json) ? json : [];
}

async function resolveMediaUrl(fetchJson, post) {
  if (!post?.featured_media) return "";
  try {
    const { json } = await fetchJson(`${BASE_URL}/wp-json/wp/v2/media/${post.featured_media}`);
    return typeof json?.source_url === "string" ? json.source_url : "";
  } catch {
    return "";
  }
}

export function createMadouquStudio({ id = "madouqu", name = "Madouqu (mainland/Taiwan)", options = {} } = {}) {
  return {
    id,
    name,
    windowDays: 90,
    // Per-lane matcher contract (docs/specs/link-sources.md): metadata-only lane.
    matcher: null,
    authority: { name: "madouqu.com", url: POSTS_URL, role: "aggregator catalogue" },
    fetchScenes: (args) => fetchMadouquScenes({ ...args, ...options }),
  };
}

export const studio = createMadouquStudio();

/**
 * Ongoing sync fetch: poll page 1 (page 2 only when page 1 is full of unseen ids) for
 * each anal term, union by post id, then title-filter and classify. Any search failure
 * throws so the sync retains the lane's last-good records.
 */
export async function fetchMadouquScenes({
  now = new Date(),
  days = 90,
  fetchImpl = fetch,
  delayMs = DEFAULT_DELAY_MS,
  maxPages = 2,
  resolveThumbnails = true,
  knownIds = [],
  onLog = () => {},
} = {}) {
  const fetchJson = createJsonFetcher({ fetchImpl, delayMs });
  const seen = new Set(knownIds.map(String));
  const categories = mapCategories(await fetchCategories(fetchJson), { onLog });
  const posts = new Map();
  for (const term of ANAL_TERMS) {
    for (const post of await walkSearch(term, { fetchJson, isSeen: (id) => seen.has(String(id)), maxPages })) {
      posts.set(String(post.id), post);
    }
  }

  const earliest = new Date(now.getTime() - days * 86_400_000);
  const scenes = [];
  for (const post of posts.values()) {
    const title = postTitle(post);
    const verdict = classifyTitle(title);
    if (verdict.content !== "anal sex") {
      onLog(`madouqu: excluded ${post.id} (${verdict.reason}): ${title}`);
      continue;
    }
    const releaseDate = String(post.date_gmt || post.date).slice(0, 10);
    const date = new Date(`${releaseDate}T00:00:00Z`);
    if (date < earliest || date > now) continue;
    // Only hit the media endpoint when the post carries no ready-made thumbnail URL.
    const thumbnailUrl = resolveThumbnails && !thumbnailFrom(post) ? await resolveMediaUrl(fetchJson, post) : "";
    scenes.push(parsePost(post, { categories, thumbnailUrl }));
  }
  return { scenes, verifiedEmpty: scenes.length === 0 };
}
