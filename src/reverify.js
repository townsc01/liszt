import { mapWithConcurrency } from "./concurrency.js";
import { readStore, writeStore } from "./store.js";
import { validSxyprnUrl } from "./sxyprn.js";
import { validEpornerUrl } from "./eporner.js";

const EPORNER_VIDEO_URL = "https://www.eporner.com/api/v2/video/id/";
const USER_AGENT = "Mozilla/5.0 (compatible; Liszt link re-verify; +https://github.com/townsc01/liszt)";

/** Links re-verified per sync: the stalest slice, so the ~97-link catalogue rotates every ~4 syncs. */
export const REVERIFY_SLICE_SIZE = 25;
/** Consecutive definitive failures required before a link is marked dead. */
export const REVERIFY_STRIKE_LIMIT = 2;
/** A stalled verify must not hold the shared pool open: bound every fetch and treat the abort as inconclusive. */
export const VERIFY_TIMEOUT_MS = 15_000;

function linkUrl(link) {
  return link.source === "sxyprn" ? validSxyprnUrl(link.url) : link.source === "eporner" && validEpornerUrl(link.url);
}

function verifiedTime(link) {
  const parsed = Date.parse(link.verifiedAt);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function strikeCount(link) {
  const parsed = Number(link.verifyFailures);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function liveScene(scene) {
  return Array.isArray(scene.videoUrls) && scene.videoUrls.length > 0;
}

/**
 * The stalest re-verifiable links across the catalogue, at most REVERIFY_SLICE_SIZE of them,
 * ordered oldest-verifiedAt first. Legacy `sxyprnUrls` are skipped: they carry no per-link
 * verification time and the live catalogue has none.
 */
export function selectReverifySlice(scenes, limit = REVERIFY_SLICE_SIZE) {
  const candidates = [];
  for (const scene of scenes) {
    if (!liveScene(scene)) continue;
    for (const link of scene.videoUrls) {
      if (linkUrl(link)) candidates.push({ sceneId: scene.id, link });
    }
  }
  return candidates
    .sort((left, right) => verifiedTime(left.link) - verifiedTime(right.link))
    .slice(0, limit);
}

/** Apply one verification outcome to a link. Only a definitive failure counts as a strike. */
function applyOutcome(link, outcome, now) {
  const at = now.toISOString();
  if (outcome?.status === "live") {
    const { verifyFailures, ...rest } = link;
    return { link: { ...rest, verifiedAt: at }, dead: false };
  }
  if (outcome?.status !== "dead") return { link, dead: false };
  const failures = strikeCount(link) + 1;
  if (failures < REVERIFY_STRIKE_LIMIT) return { link: { ...link, verifyFailures: failures }, dead: false };
  return { link, dead: true };
}

function toDeadLink(link, outcome, now) {
  return {
    source: link.source,
    url: link.url,
    embedUrl: link.embedUrl ?? null,
    verifiedAt: link.verifiedAt,
    deadAt: now.toISOString(),
    deadReason: outcome.reason || "Link not found",
  };
}

/**
 * Re-verify the stalest slice of each scene's live links. A link that reaches two consecutive
 * definitive failures moves out of `videoUrls` into `deadVideoUrls` (kept for history, hidden
 * from the UI); the last live link dying also clears `videoCheckedAt` so the scene re-enters
 * normal resolution. Runs through the shared bounded fetch pool - no new fan-out.
 */
export async function reverifyLinks(scenes, { verify, now = new Date(), limit = REVERIFY_SLICE_SIZE } = {}) {
  const slice = selectReverifySlice(scenes, limit);
  if (!slice.length) return scenes;
  const outcomes = await mapWithConcurrency(slice, async ({ link }) => {
    try {
      return await verify(link);
    } catch {
      // A thrown verifier is a network problem, not proof of deletion.
      return { status: "inconclusive" };
    }
  });
  const byScene = new Map();
  slice.forEach(({ sceneId, link }, index) => {
    const applied = applyOutcome(link, outcomes[index], now);
    if (!byScene.has(sceneId)) byScene.set(sceneId, new Map());
    byScene.get(sceneId).set(link.url, applied.dead ? toDeadLink(link, outcomes[index], now) : applied.link);
  });
  return scenes.map((scene) => {
    const updates = byScene.get(scene.id);
    if (!updates) return scene;
    const videoUrls = (scene.videoUrls || []).map((link) => updates.get(link.url) || link).filter((link) => !updates.get(link.url)?.deadAt);
    const dead = (scene.videoUrls || []).map((link) => updates.get(link.url)).filter((link) => link?.deadAt);
    const updated = { ...scene, ...(videoUrls.length ? { videoUrls } : { videoUrls: undefined }) };
    if (dead.length) updated.deadVideoUrls = [...(scene.deadVideoUrls || []), ...dead];
    if (!videoUrls.length && dead.length) updated.videoCheckedAt = undefined;
    return updated;
  });
}

/**
 * Verify one stored link. Definitive non-existence only: an sxyprn watch page answering
 * 404/410, or an eporner `video/id` lookup that returns no record. Every other answer -
 * timeout, 403 anti-bot wall, 5xx, malformed body - is inconclusive.
 */
export function createLinkVerifier({ fetchImpl = fetch, timeoutMs = VERIFY_TIMEOUT_MS } = {}) {
  return async (link) => {
    if (link.source === "sxyprn") {
      let response;
      try {
        response = await fetchImpl(link.url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        return { status: "inconclusive", reason: error.message };
      }
      if ([404, 410].includes(response.status)) return { status: "dead", reason: `sxyprn watch page returned HTTP ${response.status}` };
      if (response.ok) return { status: "live" };
      return { status: "inconclusive", reason: `sxyprn watch page returned HTTP ${response.status}` };
    }
    if (link.source === "eporner") {
      const id = /\/video-([A-Za-z0-9]+)/.exec(new URL(link.url).pathname)?.[1];
      if (!id) return { status: "inconclusive", reason: "eporner link has no video id" };
      const url = new URL(EPORNER_VIDEO_URL);
      url.searchParams.set("id", id);
      url.searchParams.set("format", "json");
      let response;
      try {
        response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        return { status: "inconclusive", reason: error.message };
      }
      if (!response.ok) return { status: "inconclusive", reason: `eporner lookup returned HTTP ${response.status}` };
      let video;
      try {
        video = await response.json();
      } catch (error) {
        return { status: "inconclusive", reason: error.message };
      }
      // The API answers an unknown id with an empty array, never a 404.
      if (Array.isArray(video) && video.length === 0) return { status: "dead", reason: "eporner video/id lookup found no record" };
      return video && typeof video === "object" ? { status: "live" } : { status: "inconclusive", reason: "eporner lookup returned an invalid record" };
    }
    return { status: "inconclusive", reason: `unsupported source ${link.source}` };
  };
}

/** Re-verify the stalest slice of a stored catalogue and persist only when a link changed. */
export async function reverifyStoredCatalogue(path, options = {}) {
  const catalogue = await readStore(path);
  const scenes = catalogue.scenes || [];
  const updated = await reverifyLinks(scenes, options);
  if (JSON.stringify(updated) === JSON.stringify(scenes)) return null;
  const next = { ...catalogue, scenes: updated };
  await writeStore(path, next);
  return next;
}
