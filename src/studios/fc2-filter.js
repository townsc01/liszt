/**
 * FC2 lane filter + admission pipeline (docs/specs/fc2-anal-uncensored.md).
 *
 * This module owns, per #104:
 *   - the section 3 gates: safety screen (minor/non-consent), censorship gate, trans backstop;
 *   - the 11.1 activity-based seller admission;
 *   - the 11.1a three-tier orientation filter;
 *   - the 11.2 precision blocklist.
 *
 * It consumes #103's raw crawl output (listing `items` + budgeted `details`) and returns the
 * admitted items, the seller admission table, the badge-null pending set and every logged
 * exclusion. It deliberately does NOT map scene records (section 4), persist anything, or wire
 * sync - those are #113. Nothing is silently dropped: every exclusion carries its reason, the
 * matched terms and the seller for human review.
 */
const DAY_MS = 86_400_000;

/** Section 3.2 - minor/non-consent hard block (Japanese + English). 18/19-year-old ages stay. */
export const SAFETY_LEXICON = ["JK", "女子校生", "女子高生", "高校生", "ロリ", "未成年", "監禁", "昏睡", "盗撮", "レイプ", "loli", "underage", "schoolgirl"];

/** Section 3.4 - trans/crossdress hard block (no reinstatement path). */
export const TRANS_LEXICON = ["ニューハーフ", "女装子", "女装", "男の娘", "シーメール", "ペニ子", "ペニクリ", "shemale", "trans"];

/** 11.1a tier 1/tier 2 - male-on-male lexicon. */
export const MM_LEXICON = ["ガチムチ", "ラガーマン", "ノンケ", "ゲイ", "ホモ", "男同士", "体育会", "GMPD", "ケツワレ", "マッチョ"];

/** 11.1a tier 1/tier 2 - male-to-trans lexicon (the section 3.4 rule plus its detail-tag vocabulary). */
export const MT_LEXICON = [...TRANS_LEXICON, "メス男子", "竿あり", "玉アリ", "オトコノコ", "兜合わせ"];

/** 11.1a tier 2 - pegging/femdom/extreme lexicon (フィスト grouped here per Chris, 2026-09-25). */
export const PEGGING_LEXICON = ["ペニバン", "逆アナル", "逆アナ", "女王様", "M男", "前立腺", "男の潮吹き", "フィスト"];

/** 11.1a tier 2 - solo lexicon; excluded only without a co-occurrence rescue (see below). */
export const SOLO_LEXICON = ["オナニー", "自撮り", "シャワー", "入浴", "風呂"];

/**
 * 11.1a tier 2 - the load-bearing rescue: female-receiving evidence that keeps a straight scene
 * whose title also mentions a toy/shower. Straight scenes routinely mention toys.
 */
export const MF_COOCCURRENCE = ["中出し", "チンポ", "ハメ", "貫通", "挿入", "セックス", "ファック", "性交", "AF", "フェラ", "射精", "3P", "二穴", "2穴", "アナルSEX"];

/** 11.1a tier 3 - detail-page tag vocabulary that hard-excludes an otherwise-innocuous item. */
export const ORIENTATION_TAG_SET = ["GMPD", "ケツワレ", "ガチムチ", "竿あり", "玉アリ", "メス男子", "オトコノコ", "女装", "shemale", ...MM_LEXICON];

const lower = (value) => String(value ?? "").toLowerCase();
const matched = (text, lexicon) => lexicon.filter((term) => lower(text).includes(lower(term)));

/** Section 3.3 - the raw badge states the detail page can carry. */
export function evaluateCensorship(censored) {
  if (censored === "無") return { state: "uncensored" };
  if (censored === "有") return { state: "censored" };
  if (censored == null || censored === "") return { state: "pending" };
  if (String(censored).includes("無") && String(censored).includes("有")) return { state: "mixed" };
  return { state: "unrecognised" };
}

/**
 * 11.1a tier 2 + section 3.2/3.4 + 11.2, applied to an item's title and (when available) its
 * detail tags. Returns the first hard verdict in cheapest-first order. A null verdict means the
 * item survives every content rule and still needs the censorship gate.
 */
export function classifyContent(title, tagNames = []) {
  const text = String(title ?? "");
  const tagText = tagNames.join(" ");
  const safety = matched(text, SAFETY_LEXICON);
  if (safety.length) return { verdict: "exclude", reason: "safety", terms: safety };
  const trans = [...matched(text, TRANS_LEXICON), ...matched(tagText, TRANS_LEXICON)];
  if (trans.length) return { verdict: "exclude", reason: "trans", terms: [...new Set(trans)] };
  const mm = matched(text, MM_LEXICON);
  if (mm.length) return { verdict: "exclude", reason: "orientation-mm", terms: mm };
  const mt = matched(text, MT_LEXICON);
  if (mt.length) return { verdict: "exclude", reason: "orientation-mt", terms: mt };
  const pegging = matched(text, PEGGING_LEXICON);
  if (pegging.length) return { verdict: "exclude", reason: "orientation-pegging", terms: pegging };
  const solo = matched(text, SOLO_LEXICON);
  const rescue = matched(text, MF_COOCCURRENCE);
  if (solo.length && !rescue.length) return { verdict: "exclude", reason: "blocklist-softcore", terms: solo };
  return { verdict: "keep", reason: null, terms: solo.length ? { solo, rescue } : [] };
}

/** 11.1a tier 3 - orientation vocabulary hidden on the detail page's tags. */
export function classifyDetailTags(tagNames = []) {
  const hits = [...new Set(tagNames.flatMap((name) => matched(name, ORIENTATION_TAG_SET)))];
  return hits.length ? { verdict: "exclude", reason: "orientation-detail-tag", terms: hits } : { verdict: "keep", reason: null, terms: [] };
}

/** Stable seller key: fc2cmadb `writer` id, else slug, else name. */
export function sellerKey(writer) {
  if (!writer) return null;
  return writer.slug || (writer.id != null ? String(writer.id) : null) || writer.name || null;
}

/** Human-readable seller label for logs and the 11.3 studio display. */
export function sellerLabel(writer) {
  if (!writer) return "";
  return writer.name || writer.slug || String(writer.id ?? "");
}

/**
 * 11.1a tier 1 - classify a seller from the titles of its crawled union items (min 3 titles).
 * A seller is excluded when more than half its titles hit the M/M or M/T lexicon.
 */
export function classifySeller(items, { minTitles = 3, threshold = 0.5 } = {}) {
  const titles = items.map((item) => String(item?.title ?? ""));
  if (titles.length < minTitles) return { excluded: false, reason: null, terms: [], mmShare: 0, mtShare: 0, titles: titles.length };
  const mm = titles.filter((title) => matched(title, MM_LEXICON).length).length;
  const mt = titles.filter((title) => matched(title, MT_LEXICON).length).length;
  const mmShare = mm / titles.length;
  const mtShare = mt / titles.length;
  if (mmShare > threshold) return { excluded: true, reason: "orientation-mm-seller", terms: MM_LEXICON.filter((term) => titles.some((title) => lower(title).includes(lower(term)))), mmShare, mtShare, titles: titles.length };
  if (mtShare > threshold) return { excluded: true, reason: "orientation-mt-seller", terms: MT_LEXICON.filter((term) => titles.some((title) => lower(title).includes(lower(term)))), mmShare, mtShare, titles: titles.length };
  return { excluded: false, reason: null, terms: [], mmShare, mtShare, titles: titles.length };
}

/**
 * 11.1 activity-based seller admission, recomputed every sync from the crawled union listings.
 * A seller is admitted with >= `minReleases` releases in the trailing `windowDays`; it goes
 * dormant after `dormancyDays` without an in-union release. Existing rows stay either way.
 */
export function admitSellers(items, { now = new Date(), windowDays = 90, minReleases = 3, dormancyDays = 180, priorAdmissions = new Map() } = {}) {
  const earliest = now.getTime() - windowDays * DAY_MS;
  const dormancyCutoff = now.getTime() - dormancyDays * DAY_MS;
  const grouped = new Map();
  for (const item of items) {
    const key = sellerKey(item?.writer);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const admissions = new Map();
  for (const [key, sellerItems] of grouped) {
    const byVideoId = new Map();
    for (const item of sellerItems) if (item?.videoId != null) byVideoId.set(String(item.videoId), item);
    const releases = [...byVideoId.values()];
    const recent = releases.filter((item) => {
      const date = Date.parse(`${item.releaseDate}T00:00:00Z`);
      return Number.isFinite(date) && date >= earliest && date <= now.getTime();
    });
    const latest = releases.map((item) => item.releaseDate).filter(Boolean).sort().at(-1) || null;
    const latestTime = latest ? Date.parse(`${latest}T00:00:00Z`) : NaN;
    const wasAdmitted = priorAdmissions.has(key);
    const admitted = recent.length >= minReleases;
    const dormant = !admitted && wasAdmitted && (!Number.isFinite(latestTime) || latestTime < dormancyCutoff);
    const label = sellerLabel(releases[0]?.writer);
    admissions.set(key, {
      key,
      label,
      slug: releases[0]?.writer?.slug || null,
      releaseCount: recent.length,
      totalSeen: releases.length,
      latestReleaseDate: latest,
      admitted: admitted || wasAdmitted,
      active: admitted,
      dormant,
      orientation: classifySeller(releases),
    });
  }
  return admissions;
}

/**
 * Run the whole #104 pipeline over one crawl pass.
 *
 * `items` are #103 listing rows; `details` are #103 detail rows for the budgeted subset. An item
 * with no detail this run cannot pass the censorship gate yet and is reported as `undecided`
 * (it stays eligible for a later run) rather than rejected. `pending` items are badge-null and
 * the caller (#113) owns their queue persistence and 7-day expiry.
 */
export function runAdmissionPipeline({ items = [], details = [], now = new Date(), windowDays = 90, minReleases = 3, dormancyDays = 180, priorAdmissions = new Map() } = {}) {
  const detailByVideoId = new Map(details.filter((detail) => detail?.videoId != null).map((detail) => [String(detail.videoId), detail]));
  const admissions = admitSellers(items, { now, windowDays, minReleases, dormancyDays, priorAdmissions });

  const kept = [];
  const excluded = [];
  const pending = [];
  const removed = [];
  const undecided = [];
  const ledger = { walked: items.length, kept: 0, excluded: 0, pending: 0, removed: 0, undecided: 0, byReason: {} };
  const log = (entry) => { ledger.byReason[entry.reason] = (ledger.byReason[entry.reason] || 0) + 1; };

  for (const item of items) {
    const videoId = String(item.videoId);
    const seller = sellerLabel(item.writer) || null;
    const detail = detailByVideoId.get(videoId);
    const tagNames = detail?.tagNames || [];

    // 11.1a tier 1: a seller classified out wholesale excludes every item it posted.
    const admission = admissions.get(sellerKey(item.writer));
    if (admission?.orientation?.excluded) {
      const entry = { videoId, seller, reason: admission.orientation.reason, terms: admission.orientation.terms };
      excluded.push(entry); log(entry); continue;
    }

    // Section 3.2/3.4 + 11.1a tiers 2 + 11.2, on listing data.
    const content = classifyContent(item.title, tagNames);
    if (content.verdict === "exclude") {
      const entry = { videoId, seller, reason: content.reason, terms: content.terms };
      excluded.push(entry); log(entry); continue;
    }

    // Section 7: a detail page that says the article is gone marks the scene removed.
    if (detail && (detail.notFound || detail.status)) {
      const entry = { videoId, seller, reason: "removed", terms: [], status: detail.status ?? null, notFound: detail.notFound ?? null };
      removed.push(entry); log(entry); continue;
    }

    // 11.1a tier 3: orientation vocabulary hidden on the detail tags.
    const orientation = classifyDetailTags(tagNames);
    if (orientation.verdict === "exclude") {
      const entry = { videoId, seller, reason: orientation.reason, terms: orientation.terms };
      excluded.push(entry); log(entry); continue;
    }

    if (!detail) { undecided.push({ videoId, seller, item }); ledger.undecided += 1; continue; }

    // Section 3.3 censorship gate - the badge only exists on the detail page.
    const badge = evaluateCensorship(detail.censored);
    if (badge.state === "censored") {
      const entry = { videoId, seller, reason: "censored", terms: ["有"] };
      excluded.push(entry); log(entry); continue;
    }
    if (badge.state === "mixed") {
      const entry = { videoId, seller, reason: "censored-mixed", terms: [String(detail.censored)] };
      excluded.push(entry); log(entry); continue;
    }
    if (badge.state === "pending") {
      const entry = { videoId, seller, reason: "badge-null", terms: [], releaseDate: item.releaseDate };
      pending.push(entry); log(entry); continue;
    }
    if (badge.state !== "uncensored") {
      const entry = { videoId, seller, reason: "badge-empty", terms: [String(detail.censored)] };
      excluded.push(entry); log(entry); continue;
    }

    kept.push({ item, detail, seller, admission: admission || null });
    ledger.kept += 1;
  }

  ledger.excluded = excluded.length;
  ledger.pending = pending.length;
  ledger.removed = removed.length;
  return { kept, excluded, pending, removed, undecided, admissions, ledger };
}
