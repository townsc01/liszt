import { fileURLToPath } from "node:url";
import { validateResult, withinRollingWindow } from "./catalogue.js";
import { enrichSxyprnLinks, enrichStoredCatalogue } from "./sxyprn.js";
import { studios as registeredStudios } from "./studios/index.js";
import { readStore, writeStore } from "./store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPaths = process.env.LISZT_DATA_PATH ? [process.env.LISZT_DATA_PATH] : [`${root}/data/catalogue.json`];

export async function sync({ now = new Date(), fetchImpl = fetch, paths = outputPaths, adapters = registeredStudios } = {}) {
  const previous = await readStore(paths[0]);
  const priorScenes = previous.scenes || [];
  const priorStatuses = new Map((previous.studios || []).map((status) => [status.id, status]));
  // A lane may emit its own per-label studio identities (madouqu). Publish one source
  // status per label so the watchlist can group and filter by real label, not the
  // adapter's flattened identity. Label display names are durable: the prior catalogue's
  // name (including an LLM naming from the background pass) wins over the adapter's
  // freshly-mapped name, so a rename is never re-derived on the next sync.
  const labelStatuses = new Map();
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  const priorLabels = new Map([...priorStatuses].filter(([id]) => !adapterIds.has(id)).map(([id, status]) => [id, status.name]));
  const labelName = (studioId, fallback) => priorLabels.get(studioId) || fallback;
  const isLaneLabel = (studioId) => Boolean(studioId) && !adapterIds.has(studioId);
  // A source refresh rebuilds each scene from the adapter, which knows nothing about
  // translation. Carry the durable English title forward - by scene id, plus an
  // original-title alias for records whose id moved - so a sync never discards the
  // background pass's work (and never re-derives it from the LLM).
  const priorTranslations = new Map();
  for (const scene of priorScenes) {
    if (!scene.titleTranslated || !scene.title) continue;
    const entry = { title: scene.title, provider: scene.translationProvider };
    if (scene.id) priorTranslations.set(scene.id, entry);
    if (scene.originalTitle) priorTranslations.set(scene.originalTitle, entry);
  }
  const withTranslation = (scene) => {
    if (scene.titleTranslated) return scene;
    const carried = priorTranslations.get(scene.id) || priorTranslations.get(scene.originalTitle);
    return carried ? { ...scene, title: carried.title, titleTranslated: true, translationProvider: carried.provider } : scene;
  };
  const results = await Promise.all(adapters.map(async (adapter) => {
    if (!adapter.id || !adapter.name || !adapter.authority?.url || typeof adapter.fetchScenes !== "function") {
      throw new Error("Invalid studio adapter contract");
    }
    try {
      const result = await adapter.fetchScenes({ now, days: 90, fetchImpl });
      const scenes = withinRollingWindow(validateResult(adapter, result), now)
        .map((scene) => isLaneLabel(scene.studioId) ? { ...scene, studio: labelName(scene.studioId, scene.studio) } : scene)
        .map(withTranslation);
      const status = { id: adapter.id, name: adapter.name, authority: adapter.authority, lastSuccessfulRefresh: now.toISOString(), error: null };
      for (const scene of scenes) {
        if (!scene.studioId || scene.studioId === adapter.id) continue;
        if (!labelStatuses.has(scene.studioId)) {
          labelStatuses.set(scene.studioId, { id: scene.studioId, name: scene.studio, authority: adapter.authority, lastSuccessfulRefresh: now.toISOString(), error: null });
        }
      }
      return { scenes, status };
    } catch (error) {
      const scenes = withinRollingWindow(priorScenes.filter((scene) => scene.studioId === adapter.id || scene.studio === adapter.name || String(scene.studioId || "").startsWith(`${adapter.id}-`)).map((scene) => ({
        ...scene,
        id: scene.sourceSceneId ? `${adapter.id}:${scene.sourceSceneId}` : `${adapter.id}:${String(scene.id).split(":").at(-1)}`,
        sourceSceneId: scene.sourceSceneId || String(scene.id).split(":").at(-1),
        studioId: scene.studioId || adapter.id,
        provenance: scene.provenance || { source: adapter.authority.name, sourceUrl: adapter.authority.url, recordUrl: scene.releaseUrl, sourceSceneId: String(scene.id).split(":").at(-1) },
      })), now);
      // Retention keeps per-label identity, so republish the labels seen in the retained set.
      for (const scene of scenes) {
        if (!scene.studioId || scene.studioId === adapter.id || labelStatuses.has(scene.studioId)) continue;
        labelStatuses.set(scene.studioId, { id: scene.studioId, name: scene.studio, authority: adapter.authority, lastSuccessfulRefresh: priorStatuses.get(adapter.id)?.lastSuccessfulRefresh || previous.lastChecked || null, error: null });
      }
      return { scenes, status: { id: adapter.id, name: adapter.name, authority: adapter.authority, lastSuccessfulRefresh: priorStatuses.get(adapter.id)?.lastSuccessfulRefresh || previous.lastChecked || null, error: error.message } };
    }
  }));
  const refreshedScenes = results.flatMap(({ scenes }) => scenes).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const scenes = await enrichSxyprnLinks(refreshedScenes, priorScenes, null, { now });
  const catalogue = { lastChecked: now.toISOString(), studios: [...results.map(({ status }) => status), ...[...labelStatuses.values()].sort((left, right) => left.name.localeCompare(right.name))], scenes };
  await Promise.all(paths.map((path) => writeStore(path, catalogue)));
  return catalogue;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await sync();
  console.log(`Saved ${result.scenes.length} live scenes to ${outputPaths.join(" and ")}`);
  for (const status of result.studios) if (status.error) console.error(`${status.name}: ${status.error}`);
  await enrichStoredCatalogue(outputPaths[0], { onProgress: (scene) => console.log(`Sxyprn checked ${scene.id}`) });
}
