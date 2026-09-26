/**
 * One-time madouqu backfill: walk all pages of all seven anal search terms at polite
 * pacing (~10-15 minutes), classify, and write the lane's scenes into the catalogue.
 * Translation stays out of this path; run `npm run backfill:translate` afterwards.
 */
import { fileURLToPath } from "node:url";
import { readStore, writeStore } from "../src/store.js";
import { validateResult } from "../src/catalogue.js";
import { classifyTitle, fetchCategories, createJsonFetcher, ANAL_TERMS, POSTS_URL, parsePost, mapCategories, studio } from "../src/studios/madouqu.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = process.env.LISZT_DATA_PATH || `${root}/data/catalogue.json`;
const maxPages = Number(process.env.MADOUQU_MAX_PAGES || 100);

const fetchJson = createJsonFetcher({});
const categories = mapCategories(await fetchCategories(fetchJson), { onLog: (line) => console.log(line) });
const posts = new Map();
for (const term of ANAL_TERMS) {
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(POSTS_URL);
    url.searchParams.set("search", term);
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const { json, headers } = await fetchJson(url.href);
    const batch = Array.isArray(json) ? json : [];
    for (const post of batch) posts.set(String(post.id), post);
    const totalPages = Number(headers?.get?.("x-wp-totalpages")) || 1;
    console.log(`${term} page ${page}/${totalPages} (${batch.length} posts)`);
    if (batch.length < 100 || page >= totalPages) break;
  }
}

const scenes = [];
for (const post of posts.values()) {
  const title = String(post?.title?.rendered || "").trim();
  const verdict = classifyTitle(title);
  if (verdict.content !== "anal sex") {
    console.log(`excluded ${post.id} (${verdict.reason}): ${title}`);
    continue;
  }
  scenes.push(parsePost(post, { categories }));
}

// Normalise exactly like sync does, so a backfilled scene carries the same
// `videoMatching: false` no-matcher flag and cannot be tube-matched later.
const catalogue = await readStore(path);
// Carry durable translations and label names forward, exactly like sync: the adapter
// knows nothing about the background pass, and re-deriving them is the thing we avoid.
const priorTranslations = new Map();
for (const scene of catalogue.scenes || []) {
  if (!scene.titleTranslated || !scene.title) continue;
  const entry = { title: scene.title, provider: scene.translationProvider };
  if (scene.id) priorTranslations.set(scene.id, entry);
  if (scene.originalTitle) priorTranslations.set(scene.originalTitle, entry);
}
const normalised = validateResult(studio, { scenes, verifiedEmpty: false }).map((scene) => {
  if (scene.titleTranslated) return scene;
  const carried = priorTranslations.get(scene.id) || priorTranslations.get(scene.originalTitle);
  return carried ? { ...scene, title: carried.title, titleTranslated: true, translationProvider: carried.provider } : scene;
});
const others = (catalogue.scenes || []).filter((scene) => scene.studioId !== "madouqu" && !String(scene.studioId || "").startsWith("madouqu-"));
const priorStudios = catalogue.studios || [];
const priorLabels = new Map(priorStudios.filter(({ id }) => id !== studio.id).map(([id, status]) => [id, status.name]));
const labels = new Map();
for (const scene of normalised) {
  if (!scene.studioId || scene.studioId === studio.id || labels.has(scene.studioId)) continue;
  // Keep a prior (possibly LLM-renamed) label display name; it is durable.
  labels.set(scene.studioId, { id: scene.studioId, name: priorLabels.get(scene.studioId) || scene.studio, authority: studio.authority, lastSuccessfulRefresh: new Date().toISOString(), error: null });
}
const next = {
  ...catalogue,
  studios: [...priorStudios.filter(({ id }) => id !== studio.id && !String(id).startsWith(`${studio.id}-`)), { id: studio.id, name: studio.name, authority: studio.authority, lastSuccessfulRefresh: new Date().toISOString(), error: null }, ...[...labels.values()].sort((left, right) => left.name.localeCompare(right.name))],
  scenes: [...normalised, ...others].sort((left, right) => right.releaseDate.localeCompare(left.releaseDate)),
};
await writeStore(path, next);
console.log(`madouqu backfill wrote ${normalised.length} scenes to ${path}`);
