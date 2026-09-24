import { fileURLToPath } from "node:url";
import { withinRollingWindow } from "./catalogue.js";
import { fetchAnalVidsScenes } from "./analvids.js";
import { writeStore } from "./store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPaths = process.env.LISZT_DATA_PATH ? [process.env.LISZT_DATA_PATH] : [`${root}/data/catalogue.json`, `${root}/docs/catalogue.json`];

export async function sync({ now = new Date(), fetchImpl = fetch, paths = outputPaths } = {}) {
  const scenes = withinRollingWindow(await fetchAnalVidsScenes({ now, fetchImpl }), now);
  scenes.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const catalogue = { lastChecked: now.toISOString(), sourceUrl: "https://www.analvids.com/studios/lancelotstylesevolution", scenes };
  await Promise.all(paths.map((path) => writeStore(path, catalogue)));
  return catalogue;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await sync();
  console.log(`Saved ${result.scenes.length} live scenes to ${outputPaths.join(" and ")}`);
}
