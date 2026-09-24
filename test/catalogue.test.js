import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, reconcile, withinRollingWindow } from "../src/catalogue.js";
import { parseListing, parseScenePage } from "../src/analvids.js";

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

test("parses AnalVids listing cards", () => {
  const html = `<section id="lancelotstylesevolution_scenes"><div class="card-scene"><a href="https://www.analvids.com/watch/42/a_scene"><img data-src="https://cdn.example/thumb.jpg?x=1&amp;y=2"></a><div class="card-scene__text"><a title="Ada &amp; Bea">Ada</a></div></div></section>`;
  assert.deepEqual(parseListing(html), [{
    title: "Ada & Bea",
    releaseUrl: "https://www.analvids.com/watch/42/a_scene",
    thumbnailUrl: "https://cdn.example/thumb.jpg?x=1&y=2",
  }]);
});

test("parses release details and excludes the male studio performer", () => {
  const listing = { title: "Fallback", releaseUrl: "https://www.analvids.com/watch/42/a_scene", thumbnailUrl: "thumb" };
  const html = `<h1 class="watch__title h2">A scene with <a href="https://www.analvids.com/model/12/ada">Ada</a> and <a href="https://www.analvids.com/model/3336/lancelot">Lancelot</a></h1><i class="bi bi-calendar3 me-5"> 2026-09-20</i>`;
  assert.deepEqual(parseScenePage(html, listing), {
    id: "42", title: "A scene with Ada and Lancelot", releaseDate: "2026-09-20",
    studio: "Lancelot Styles Evolution", performers: ["Ada"], thumbnailUrl: "thumb",
    releaseUrl: listing.releaseUrl, source: "studio",
  });
});

test("keeps only performers confirmed by female model profiles", () => {
  const listing = { title: "Fallback", releaseUrl: "https://www.analvids.com/watch/42/a_scene", thumbnailUrl: "thumb" };
  const html = `<h1 class="watch__title h2"><a href="https://www.analvids.com/model/12/ada">Ada</a> and <a href="https://www.analvids.com/model/13/bob">Bob</a></h1><i class="bi bi-calendar3"> 2026-09-20</i>`;
  assert.deepEqual(parseScenePage(html, listing, new Set(["12/ada"])).performers, ["Ada"]);
});
