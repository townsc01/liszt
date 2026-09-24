import { fileURLToPath } from "node:url";
import { enrichSxyprnLinks, enrichStoredCatalogue } from "../src/sxyprn.js";
import { readStore, writeStore } from "../src/store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = process.env.LISZT_DATA_PATH || `${root}/data/catalogue.json`;
const catalogue = await readStore(path);
catalogue.scenes = await enrichSxyprnLinks(catalogue.scenes || [], catalogue.scenes || [], null, { days: 90 });
await writeStore(path, catalogue);
await enrichStoredCatalogue(path, { days: 90, onProgress: (scene) => console.log(`Sxyprn checked ${scene.id}`) });
console.log(`Sxyprn backfill finished for ${catalogue.scenes.length} scenes`);
