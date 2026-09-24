import { fileURLToPath } from "node:url";
import { validateResult, withinRollingWindow } from "./catalogue.js";
import { createEpornerLookup, enrichEpornerLinks } from "./eporner.js";
import { studios as registeredStudios } from "./studios/index.js";
import { readStore, writeStore } from "./store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPaths = process.env.LISZT_DATA_PATH ? [process.env.LISZT_DATA_PATH] : [`${root}/data/catalogue.json`];

export async function sync({ now = new Date(), fetchImpl = fetch, paths = outputPaths, adapters = registeredStudios, epornerLookup = createEpornerLookup({ baseUrl: process.env.LUSTPRESS_URL, fetchImpl }) } = {}) {
  const previous = await readStore(paths[0]);
  const priorScenes = previous.scenes || [];
  const priorStatuses = new Map((previous.studios || []).map((status) => [status.id, status]));
  const results = await Promise.all(adapters.map(async (adapter) => {
    if (!adapter.id || !adapter.name || !adapter.authority?.url || typeof adapter.fetchScenes !== "function") {
      throw new Error("Invalid studio adapter contract");
    }
    try {
      const result = await adapter.fetchScenes({ now, days: 90, fetchImpl });
      const scenes = withinRollingWindow(validateResult(adapter, result), now);
      return { scenes, status: { id: adapter.id, name: adapter.name, authority: adapter.authority, lastSuccessfulRefresh: now.toISOString(), error: null } };
    } catch (error) {
      const scenes = withinRollingWindow(priorScenes.filter((scene) => scene.studioId === adapter.id || scene.studio === adapter.name).map((scene) => ({
        ...scene,
        id: scene.sourceSceneId ? `${adapter.id}:${scene.sourceSceneId}` : `${adapter.id}:${String(scene.id).split(":").at(-1)}`,
        sourceSceneId: scene.sourceSceneId || String(scene.id).split(":").at(-1),
        studioId: adapter.id,
        provenance: scene.provenance || { source: adapter.authority.name, sourceUrl: adapter.authority.url, recordUrl: scene.releaseUrl, sourceSceneId: String(scene.id).split(":").at(-1) },
      })), now);
      return { scenes, status: { id: adapter.id, name: adapter.name, authority: adapter.authority, lastSuccessfulRefresh: priorStatuses.get(adapter.id)?.lastSuccessfulRefresh || previous.lastChecked || null, error: error.message } };
    }
  }));
  const refreshedScenes = results.flatMap(({ scenes }) => scenes).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const scenes = await enrichEpornerLinks(refreshedScenes, priorScenes, epornerLookup);
  const catalogue = { lastChecked: now.toISOString(), studios: results.map(({ status }) => status), scenes };
  await Promise.all(paths.map((path) => writeStore(path, catalogue)));
  return catalogue;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await sync();
  console.log(`Saved ${result.scenes.length} live scenes to ${outputPaths.join(" and ")}`);
  for (const status of result.studios) if (status.error) console.error(`${status.name}: ${status.error}`);
}
