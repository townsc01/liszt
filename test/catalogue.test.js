import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, reconcile, withinRollingWindow } from "../src/catalogue.js";

const base = { title: "Café Scene", releaseDate: "2026-09-01", studio: "Example Studio", performers: [], thumbnailUrl: "", releaseUrl: "" };

test("normalizes punctuation and accents for matching", () => {
  assert.equal(normalizeTitle(" Café—Scene! "), "cafe scene");
});

test("deduplicates records and keeps authoritative studio fields", () => {
  const tpdb = [{ ...base, source: "tpdb", performers: ["Ada", "Bea"], releaseUrl: "tpdb" }];
  const studio = [{ ...base, source: "studio", title: "Cafe Scene", performers: ["Ada"], releaseUrl: "studio" }];
  const [scene] = reconcile(studio, tpdb);
  assert.equal(scene.releaseUrl, "studio");
  assert.equal(scene.source, "studio");
  assert.deepEqual(scene.performers, ["Ada", "Bea"]);
});

test("keeps only releases in the rolling window", () => {
  const scenes = [
    { ...base, releaseDate: "2026-09-24" },
    { ...base, releaseDate: "2026-06-25" },
    { ...base, releaseDate: "2026-09-25" },
  ];
  assert.deepEqual(withinRollingWindow(scenes, new Date("2026-09-24T12:00:00Z")).map((scene) => scene.releaseDate), ["2026-09-24"]);
});
