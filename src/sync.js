import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reconcile, withinRollingWindow } from "./catalogue.js";
import { writeStore } from "./store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataPath = process.env.LISZT_DATA_PATH || `${root}/data/catalogue.json`;

export async function sync({ now = new Date() } = {}) {
  // Fixtures keep this first cut reproducible. Source adapters can replace these
  // reads once catalogue access and TPDB credentials have been confirmed.
  const [studio, tpdb] = await Promise.all([
    readFile(`${root}/fixtures/studio.json`, "utf8").then(JSON.parse),
    readFile(`${root}/fixtures/tpdb.json`, "utf8").then(JSON.parse),
  ]);
  const scenes = withinRollingWindow(reconcile(studio, tpdb), now);
  const catalogue = { lastChecked: now.toISOString(), scenes };
  await writeStore(dataPath, catalogue);
  return catalogue;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await sync();
  console.log(`Saved ${result.scenes.length} scenes to ${dataPath}`);
}
