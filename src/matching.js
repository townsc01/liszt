const DECORATION_WORDS = new Set(["new", "watch", "download"]);

/** Normalise tube text without losing characters represented by compatibility glyphs. */
export function matchTokens(value) {
  return String(value || "").normalize("NFKC").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

export function normalizedText(value) {
  return matchTokens(value).join(" ");
}

export function hasOpenIdentity(scene, title) {
  const candidate = new Set(matchTokens(title));
  const performer = (scene.performers || []).some((name) => {
    const tokens = matchTokens(name);
    return tokens.length > 0 && tokens.every((token) => candidate.has(token));
  });
  const sceneTitle = normalizedText(scene.title);
  return performer || (sceneTitle.length > 0 && normalizedText(title).includes(sceneTitle));
}

function parseDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function mmddMatches(scene, title) {
  const runs = [...String(title || "").normalize("NFKC").matchAll(/(?:^|\D)(\d{3,4})(?=\D|$)/g)];
  const code = runs.map((match) => match[1]).reverse().find((digits) => {
    const month = Number(digits.slice(0, -2));
    const day = Number(digits.slice(-2));
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  });
  if (!code) return true;
  const release = parseDate(scene.releaseDate);
  if (release === null) return false;
  for (const offset of [-1, 0, 1]) {
    const date = new Date(release + offset * 86_400_000);
    if (Number(code.slice(0, -2)) === date.getUTCMonth() + 1 && Number(code.slice(-2)) === date.getUTCDate()) return true;
  }
  return false;
}

export function hasTrustedIdentity(scene, title) {
  const titleTokens = matchTokens(title);
  const candidate = new Set(titleTokens);
  const hasName = (scene.performers || []).some((name) => {
    const tokens = matchTokens(name);
    return tokens.length > 0 && (tokens.every((token) => candidate.has(token)) || candidate.has(tokens[0]) ||
      titleTokens.some((token) => new RegExp(`^${tokens[0]}\\d{3,4}$`, "i").test(token)));
  });
  return hasName && mmddMatches(scene, title);
}

/** Remove common repost wrappers while retaining words which carry scene identity. */
export function titleStem(value) {
  const withoutUrls = String(value || "").replace(/https?:\/\/\S+/gi, " ")
    .replace(/\{(?:new|watch\/?download:)[^}]*\}/gi, " ")
    .replace(/(?:\s+#[\p{L}\p{N}_-]+)+\s*$/u, " ")
    .replace(/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ");
  return matchTokens(withoutUrls).filter((token) => !DECORATION_WORDS.has(token)).join(" ");
}

function uploader(candidate) {
  return String(candidate.uploader || candidate.user || candidate.author || candidate.username || "").toLowerCase();
}

function rank(scene, left, right) {
  const duration = Math.abs(Number(left.duration) - scene.durationSec) - Math.abs(Number(right.duration) - scene.durationSec);
  if (duration) return duration;
  const release = parseDate(scene.releaseDate);
  const leftDate = parseDate(left.added);
  const rightDate = parseDate(right.added);
  if (release !== null && leftDate !== null && rightDate !== null) {
    const dateDistance = Math.abs(leftDate - release) - Math.abs(rightDate - release);
    if (dateDistance) return dateDistance;
  } else if (leftDate !== null && rightDate === null) return -1;
  else if (leftDate === null && rightDate !== null) return 1;
  const views = Number(right.views || 0) - Number(left.views || 0);
  if (views) return views;
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  return String(left.url || "").localeCompare(String(right.url || ""));
}

/** Apply the measured duration/identity gate and conservative duplicate tiebreak. */
export function pickMatch(scene, candidates, { trustedPool = false, identity = null } = {}) {
  if (!Number.isFinite(scene.durationSec) || scene.durationSec <= 0) return null;
  const accepted = candidates.filter((candidate) => Number.isFinite(Number(candidate.duration)) &&
    Math.abs(Number(candidate.duration) - scene.durationSec) <= 2 &&
    (identity ? identity(candidate) : trustedPool ? hasTrustedIdentity(scene, candidate.title) : hasOpenIdentity(scene, candidate.title)));
  if (!accepted.length) return null;

  const bestByStem = new Map();
  for (const candidate of accepted) {
    const stem = titleStem(candidate.title);
    const current = bestByStem.get(stem);
    if (!current || rank(scene, candidate, current) < 0) bestByStem.set(stem, candidate);
  }
  const distinct = [...bestByStem.values()];
  if (distinct.length > 1 && new Set(distinct.map(uploader)).size > 1) return null;
  return distinct.sort((left, right) => rank(scene, left, right))[0];
}
