import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseListing,
  parseVideoPage,
  parseDate,
  parseIsoDuration,
  fetchJulesJordanScenes,
  studio,
} from "../src/studios/jules-jordan.js";

const fixture = async (name) =>
  readFile(new URL(`../fixtures/jules-jordan/${name}`, import.meta.url), "utf8");

test("parseDate handles month name, day, year format", () => {
  assert.equal(parseDate("September 15, 2026"), "2026-09-15");
  assert.equal(parseDate("January 1, 2025"), "2025-01-01");
  assert.equal(parseDate("December 31, 2024"), "2024-12-31");
  assert.equal(parseDate("March 5, 2023"), "2023-03-05");
  assert.equal(parseDate("invalid"), undefined);
  assert.equal(parseDate(""), undefined);
});

test("parseIsoDuration parses ISO 8601 duration strings", () => {
  assert.equal(parseIsoDuration("PT35M42S"), 2142);
  assert.equal(parseIsoDuration("PT1H30M"), 5400);
  assert.equal(parseIsoDuration("PT42M15S"), 2535);
  assert.equal(parseIsoDuration("PT2H"), 7200);
  assert.equal(parseIsoDuration("PT0S"), null);
  assert.equal(parseIsoDuration(""), null);
});

test("parseIsoDuration parses clock format HH:MM:SS", () => {
  assert.equal(parseIsoDuration("35:42"), 2142);
  assert.equal(parseIsoDuration("1:30:00"), 5400);
  assert.equal(parseIsoDuration("42:15"), 2535);
});

test("parseListing extracts video cards from listing page", async () => {
  const html = await fixture("listing-page-1.html");
  const listings = parseListing(html);

  assert.equal(listings.length, 3);

  assert.equal(listings[0].releaseUrl, "https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html");
  assert.equal(listings[0].releaseDate, "2026-09-15");
  assert.equal(listings[0].thumbnailUrl, "https://content.julesjordan.com/thumbs/perfect-model-wants-the-scene_160x90.jpg");

  assert.equal(listings[1].releaseUrl, "https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html");
  assert.equal(listings[1].releaseDate, "2026-09-10");
  assert.equal(listings[1].thumbnailUrl, "https://content.julesjordan.com/thumbs/anal-acrobats-2_160x90.jpg");

  assert.equal(listings[2].releaseUrl, "https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html");
  assert.equal(listings[2].releaseDate, "2026-08-28");
  assert.equal(listings[2].thumbnailUrl, "https://content.julesjordan.com/thumbs/deep-anal-drilling_160x90.jpg");
});

test("parseListing throws when no video cards found", async () => {
  const emptyHtml = "<html><body>No cards here</body></html>";
  assert.throws(() => parseListing(emptyHtml), /Jules Jordan listing is missing video cards/);
});

test("parseVideoPage extracts metadata from JSON-LD VideoObject", async () => {
  const html = await fixture("video-page-perfect-model.html");
  const releaseUrl = "https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html";

  const scene = parseVideoPage(html, releaseUrl);

  assert.equal(scene.sourceSceneId, "perfect-model-wants-the-scene");
  assert.equal(scene.title, "Perfect Model Wants The Scene");
  assert.equal(scene.releaseDate, "2026-09-15");
  assert.equal(scene.durationSec, 2142);
  assert.deepEqual(scene.performers, ["Maddie Wren", "Jules Jordan"]);
  assert.equal(scene.thumbnailUrl, "https://content.julesjordan.com/thumbs/perfect-model-wants-the-scene_320x180.jpg");
  assert.equal(scene.releaseUrl, releaseUrl);
  assert.equal(scene.source, "Jules Jordan");
  assert.equal(scene.provenance.source, "Jules Jordan");
  assert.equal(scene.provenance.sourceSceneId, "perfect-model-wants-the-scene");
});

test("parseVideoPage handles single thumbnailUrl string", async () => {
  const html = await fixture("video-page-anal-acrobats.html");
  const releaseUrl = "https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html";

  const scene = parseVideoPage(html, releaseUrl);

  assert.equal(scene.sourceSceneId, "anal-acrobats-2");
  assert.equal(scene.title, "Anal Acrobats 2");
  assert.equal(scene.releaseDate, "2026-09-10");
  assert.equal(scene.durationSec, 2535);
  assert.deepEqual(scene.performers, ["Vanna Bardot", "Emily Willis"]);
  assert.equal(scene.thumbnailUrl, "https://content.julesjordan.com/thumbs/anal-acrobats-2_320x180.jpg");
});

test("parseVideoPage throws when required metadata missing", async () => {
  const badHtml = "<html><body>No JSON-LD here</body></html>";
  const releaseUrl = "https://www.julesjordan.com/scenes/missing_vids.html";

  assert.throws(
    () => parseVideoPage(badHtml, releaseUrl),
    /Required Jules Jordan video metadata missing/
  );
});

test("parseVideoPage throws when uploadDate is invalid", async () => {
  const badHtml = `
    <html>
    <head>
      <script type="application/ld+json">
      {"@type": "VideoObject", "name": "Test", "uploadDate": "not-a-date", "duration": "PT10M"}
      </script>
    </head>
    </html>`;
  const releaseUrl = "https://www.julesjordan.com/scenes/test_vids.html";

  assert.throws(
    () => parseVideoPage(badHtml, releaseUrl),
    /Invalid Jules Jordan video release date/
  );
});

test("studio adapter has correct identity and authority", () => {
  assert.equal(studio.id, "jules-jordan");
  assert.equal(studio.name, "Jules Jordan");
  assert.equal(studio.authority.name, "Jules Jordan");
  assert.equal(studio.authority.url, "https://www.julesjordan.com/trial/categories/anal.html");
  assert.equal(studio.authority.role, "authoritative catalogue");
  assert.equal(typeof studio.fetchScenes, "function");
});

test("fetchJulesJordanScenes integrates listing and video page parsing", async () => {
  const listingPage1 = await fixture("listing-page-1.html");
  const listingPage2 = await fixture("listing-page-2.html");
  const videoPage1 = await fixture("video-page-perfect-model.html");
  const videoPage2 = await fixture("video-page-anal-acrobats.html");
  const videoPage3 = await fixture("video-page-deep-anal-drilling.html");
  const videoPage4 = await fixture("video-page-anal-therapy.html");
  const videoPage5 = await fixture("video-page-backdoor-delights.html");

  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
    ["https://www.julesjordan.com/trial/categories/anal.html?page=2", listingPage2],
    ["https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html", videoPage1],
    ["https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html", videoPage2],
    ["https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html", videoPage3],
    ["https://www.julesjordan.com/scenes/anal-therapy-session_vids.html", videoPage4],
    ["https://www.julesjordan.com/scenes/backdoor-delights_vids.html", videoPage5],
  ]);

  const fetchImpl = async (url) => {
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 90, fetchImpl });

  assert.equal(result.scenes.length, 5);
  assert.equal(result.verifiedEmpty, false);

  const scene1 = result.scenes.find((s) => s.sourceSceneId === "perfect-model-wants-the-scene");
  const scene2 = result.scenes.find((s) => s.sourceSceneId === "anal-acrobats-2");
  const scene3 = result.scenes.find((s) => s.sourceSceneId === "deep-anal-drilling");
  const scene4 = result.scenes.find((s) => s.sourceSceneId === "anal-therapy-session");
  const scene5 = result.scenes.find((s) => s.sourceSceneId === "backdoor-delights");

  assert.ok(scene1, "first scene should be present");
  assert.ok(scene2, "second scene should be present");
  assert.ok(scene3, "third scene should be present");
  assert.ok(scene4, "fourth scene should be present");
  assert.ok(scene5, "fifth scene should be present");
  assert.equal(scene1.title, "Perfect Model Wants The Scene");
  assert.equal(scene2.title, "Anal Acrobats 2");
  assert.equal(scene3.title, "Deep Anal Drilling");
  assert.equal(scene4.title, "Anal Therapy Session");
  assert.equal(scene5.title, "Backdoor Delights");
});

test("fetchJulesJordanScenes filters by date window", async () => {
  const listingPage1 = await fixture("listing-page-1.html");
  const listingPage2 = await fixture("listing-page-2.html");
  const videoPage1 = await fixture("video-page-perfect-model.html");
  const videoPage2 = await fixture("video-page-anal-acrobats.html");
  const videoPage3 = await fixture("video-page-deep-anal-drilling.html");
  const videoPage4 = await fixture("video-page-anal-therapy.html");
  const videoPage5 = await fixture("video-page-backdoor-delights.html");

  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
    ["https://www.julesjordan.com/trial/categories/anal.html?page=2", listingPage2],
    ["https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html", videoPage1],
    ["https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html", videoPage2],
    ["https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html", videoPage3],
    ["https://www.julesjordan.com/scenes/anal-therapy-session_vids.html", videoPage4],
    ["https://www.julesjordan.com/scenes/backdoor-delights_vids.html", videoPage5],
  ]);

  const fetchImpl = async (url) => {
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  // Window that only includes the Sept 15 scene (within 5 days of Sept 20)
  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 5, fetchImpl });

  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].sourceSceneId, "perfect-model-wants-the-scene");
});

test("fetchJulesJordanScenes handles pagination and stops when no recent scenes", async () => {
  const listingPage1 = await fixture("listing-page-1.html");
  const listingPage2 = await fixture("listing-page-2.html");
  const videoPage1 = await fixture("video-page-perfect-model.html");
  const videoPage2 = await fixture("video-page-anal-acrobats.html");
  const videoPage3 = await fixture("video-page-deep-anal-drilling.html");
  const videoPage4 = await fixture("video-page-anal-therapy.html");
  const videoPage5 = await fixture("video-page-backdoor-delights.html");

  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
    ["https://www.julesjordan.com/trial/categories/anal.html?page=2", listingPage2],
    ["https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html", videoPage1],
    ["https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html", videoPage2],
    ["https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html", videoPage3],
    ["https://www.julesjordan.com/scenes/anal-therapy-session_vids.html", videoPage4],
    ["https://www.julesjordan.com/scenes/backdoor-delights_vids.html", videoPage5],
  ]);

  const fetchImpl = async (url) => {
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  // Window where page 1 has 2 recent scenes (Sept 15, Sept 10), page 2 has none (Aug 15, Aug 1)
  // So it fetches page 2 but finds no recent scenes there, then stops
  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 10, fetchImpl });

  // Should fetch both pages but only keep the 2 scenes within 10 days (both on page 1)
  assert.equal(result.scenes.length, 2);
  const sceneIds = result.scenes.map((s) => s.sourceSceneId).sort();
  assert.deepEqual(sceneIds, ["anal-acrobats-2", "perfect-model-wants-the-scene"]);
});

test("fetchJulesJordanScenes returns verifiedEmpty when no recent scenes", async () => {
  const listingPage1 = await fixture("listing-page-1.html");
  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
  ]);

  const fetchImpl = async (url) => {
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  // Window of 1 day - all scenes are older
  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 1, fetchImpl });

  assert.equal(result.scenes.length, 0);
  assert.equal(result.verifiedEmpty, true);
});

test("fetchJulesJordanScenes retries on 5xx errors", async () => {
  let attempts = 0;
  const listingPage1 = await fixture("listing-page-1.html");
  const listingPage2 = await fixture("listing-page-2.html");
  const videoPage1 = await fixture("video-page-perfect-model.html");
  const videoPage2 = await fixture("video-page-anal-acrobats.html");
  const videoPage3 = await fixture("video-page-deep-anal-drilling.html");
  const videoPage4 = await fixture("video-page-anal-therapy.html");
  const videoPage5 = await fixture("video-page-backdoor-delights.html");

  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
    ["https://www.julesjordan.com/trial/categories/anal.html?page=2", listingPage2],
    ["https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html", videoPage1],
    ["https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html", videoPage2],
    ["https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html", videoPage3],
    ["https://www.julesjordan.com/scenes/anal-therapy-session_vids.html", videoPage4],
    ["https://www.julesjordan.com/scenes/backdoor-delights_vids.html", videoPage5],
  ]);

  const fetchImpl = async (url) => {
    attempts++;
    if (attempts <= 2 && url === "https://www.julesjordan.com/trial/categories/anal.html") {
      return { ok: false, status: 500, statusText: "Internal Server Error" };
    }
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 90, fetchImpl });

  assert.ok(attempts >= 3, "should have retried at least 3 times");
  assert.equal(result.scenes.length, 5); // all 5 scenes from listing page 1 and 2
});

test("fetchJulesJordanScenes does not retry on 4xx errors (except 429)", async () => {
  let attempts = 0;

  const fetchImpl = async (url) => {
    attempts++;
    return { ok: false, status: 404, statusText: "Not Found" };
  };

  const now = new Date("2026-09-20T00:00:00Z");

  await assert.rejects(
    fetchJulesJordanScenes({ now, days: 90, fetchImpl }),
    /Jules Jordan returned HTTP 404/
  );

  assert.equal(attempts, 1, "should not retry on 404");
});

test("fetchJulesJordanScenes retries on 429 rate limit", async () => {
  let attempts = 0;
  const listingPage1 = await fixture("listing-page-1.html");
  const listingPage2 = await fixture("listing-page-2.html");
  const videoPage1 = await fixture("video-page-perfect-model.html");
  const videoPage2 = await fixture("video-page-anal-acrobats.html");
  const videoPage3 = await fixture("video-page-deep-anal-drilling.html");
  const videoPage4 = await fixture("video-page-anal-therapy.html");
  const videoPage5 = await fixture("video-page-backdoor-delights.html");

  const pages = new Map([
    ["https://www.julesjordan.com/trial/categories/anal.html", listingPage1],
    ["https://www.julesjordan.com/trial/categories/anal.html?page=2", listingPage2],
    ["https://www.julesjordan.com/scenes/perfect-model-wants-the-scene_vids.html", videoPage1],
    ["https://www.julesjordan.com/scenes/anal-acrobats-2_vids.html", videoPage2],
    ["https://www.julesjordan.com/scenes/deep-anal-drilling_vids.html", videoPage3],
    ["https://www.julesjordan.com/scenes/anal-therapy-session_vids.html", videoPage4],
    ["https://www.julesjordan.com/scenes/backdoor-delights_vids.html", videoPage5],
  ]);

  const fetchImpl = async (url) => {
    attempts++;
    if (attempts <= 2 && url === "https://www.julesjordan.com/trial/categories/anal.html") {
      return { ok: false, status: 429, statusText: "Too Many Requests" };
    }
    const html = pages.get(url);
    if (!html) throw new Error(`No fixture for ${url}`);
    return { ok: true, text: async () => html };
  };

  const now = new Date("2026-09-20T00:00:00Z");
  const result = await fetchJulesJordanScenes({ now, days: 90, fetchImpl });

  assert.ok(attempts >= 3, "should have retried on 429");
  assert.equal(result.scenes.length, 5);
});