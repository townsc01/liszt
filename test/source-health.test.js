import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifySourceStatus, renderSourceHealth, renderSourceHealthSummary, sourceHealth } from "../public/source-health.js";

const scene = (studioId, extra = {}) => ({ id: `${studioId}:1`, studioId, studio: studioId, title: "Scene", releaseDate: "2026-09-20", performers: [], ...extra });
const liveSxyprn = { source: "sxyprn", url: "https://sxyprn.com/post/6ab5422fa84b6.html", embedUrl: null, verifiedAt: "2026-09-25T00:00:00.000Z" };
const deadEporner = { source: "eporner", url: "https://www.eporner.com/video-abc", embedUrl: "https://www.eporner.com/embed/abc", verifiedAt: "2026-09-25T00:00:00.000Z", dead: true };

test("a missing API key is configuration, not a source outage", () => {
  assert.equal(classifySourceStatus("TPDB_API_KEY is not configured"), "config");
  assert.equal(classifySourceStatus("TPDB request failed with HTTP 401"), "config");
  assert.equal(classifySourceStatus("source unavailable"), "failing");
  assert.equal(classifySourceStatus("TPDB request failed with HTTP 500"), "failing");
  assert.equal(classifySourceStatus(null), "ok");
});

test("Sources shows a failing studio's error text and a healthy studio's sync, refresh, count and match", () => {
  const scenes = [scene("tushy", { videoUrls: [liveSxyprn] }), scene("tushy"), scene("lancelot")];
  const failing = renderSourceHealth({ id: "tushy", name: "Tushy", error: "TPDB_API_KEY is not configured", lastSuccessfulRefresh: "2026-09-24T15:45:52.989Z" }, scenes);
  assert.match(failing, /Not configured/);
  assert.match(failing, /TPDB_API_KEY is not configured/, "the error text is visible in Sources");
  assert.match(failing, /Deploy configuration, not a source outage/);
  const healthy = renderSourceHealth({ id: "lancelot", name: "Lancelot", error: null, lastSuccessfulRefresh: "2026-09-24T20:08:36.827Z" }, scenes);
  assert.match(healthy, /Sync ok/);
  assert.match(healthy, /Sep 24, 2026/);
  assert.match(healthy, /<dt>Scenes<\/dt><dd>1<\/dd>/);
  assert.match(healthy, /<dt>Match rate<\/dt><dd>0%<\/dd>/);
});

test("match rate counts the share of a studio's scenes with a live playback link", () => {
  const scenes = [
    scene("tushy", { videoUrls: [liveSxyprn] }),
    scene("tushy", { sxyprnUrls: ["https://sxyprn.com/post/6ab5422fa84b6.html"] }),
    scene("tushy", { videoUrls: [deadEporner] }),
    scene("tushy"),
  ];
  const health = sourceHealth({ id: "tushy" }, scenes);
  assert.equal(health.sceneCount, 4);
  assert.equal(health.liveCount, 2, "legacy sxyprnUrls count and a dead link does not");
  assert.equal(health.matchPercent, 50);
  assert.equal(sourceHealth({ id: "empty" }, scenes).matchPercent, null, "no scenes yields no percentage");
});

test("watchlist carries at most a one-line pointer, with no per-studio error text", () => {
  const summary = renderSourceHealthSummary([{ error: null }, { error: "source unavailable" }, { error: "TPDB_API_KEY is not configured" }]);
  assert.match(summary, /1 source failing/);
  assert.match(summary, /1 source not configured/);
  assert.match(summary, /see Sources/);
  assert.equal((summary.match(/<div/g) || []).length, 1, "one compact affordance, not one banner per studio");
  assert.doesNotMatch(summary, /source unavailable|TPDB_API_KEY/, "the error text lives in Sources, not the watchlist");
  assert.equal(renderSourceHealthSummary([{ error: null }]), "", "healthy studios show no pointer");
});

test("health HTML escapes untrusted error text", () => {
  assert.match(renderSourceHealth({ id: "tushy", error: "<img src=x onerror=alert(1)>" }, []), /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("regression: the watchlist no longer renders the per-studio error banner (#76 behaviour removed)", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /refresh failed/, "the per-studio error banner strip is gone");
  assert.match(app, /renderSourceHealthSummary\(statuses\)/, "the watchlist delegates to the one-line pointer");
  assert.match(app, /renderSourceHealth\(item, scenes\)/, "the Sources view delegates to per-studio health");
});
