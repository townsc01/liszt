import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateResult, withinRollingWindow } from "../src/catalogue.js";
import { parseListing, parseScenePage, studio } from "../src/studios/lancelot-styles-evolution.js";
import { sync } from "../src/sync.js";

const fixture = (name) => readFile(new URL(`../fixtures/analvids/${name}`, import.meta.url), "utf8");
const scene = (id, releaseDate = "2026-09-20") => ({ sourceSceneId: id, title: `Scene ${id}`, releaseDate, performers: [], thumbnailUrl: "", releaseUrl: `https://source/${id}`, source: "Test", provenance: { source: "Test", sourceUrl: "https://source", recordUrl: `https://source/${id}`, sourceSceneId: id } });
const adapter = (id, fetchScenes) => ({ id, name: `Studio ${id}`, authority: { name: "Test", url: `https://source/${id}`, role: "authoritative catalogue" }, fetchScenes });

test("parses representative saved AnalVids listing and scene pages", async () => {
  const [listing] = parseListing(await fixture("listing.html"));
  assert.deepEqual(listing, { title: "Ada & Bea", releaseUrl: "https://www.analvids.com/watch/42/a_scene", thumbnailUrl: "https://cdn.example/thumb.jpg?x=1&y=2" });
  const parsed = parseScenePage(await fixture("scene.html"), listing);
  assert.equal(parsed.id, "lancelot-styles-evolution:42");
  assert.equal(parsed.sourceSceneId, "42");
  assert.equal(parsed.provenance.source, "AnalVids");
  assert.deepEqual(parsed.performers, ["Ada"]);
});

test("IDs are stable and scoped to a studio rather than title or date", () => {
  const first = validateResult(adapter("one", null), { scenes: [scene("42")], verifiedEmpty: false })[0];
  const second = validateResult(adapter("two", null), { scenes: [{ ...scene("42"), title: first.title, releaseDate: first.releaseDate }], verifiedEmpty: false })[0];
  assert.equal(first.id, "one:42");
  assert.equal(second.id, "two:42");
  assert.notEqual(first.id, second.id);
});

test("distinguishes verified empty catalogues from suspicious extraction failures", () => {
  assert.deepEqual(validateResult(adapter("empty", null), { scenes: [], verifiedEmpty: true }), []);
  assert.throws(() => validateResult(adapter("empty", null), { scenes: [] }), /Suspicious empty/);
});

test("keeps only releases in the rolling window", () => {
  assert.deepEqual(withinRollingWindow([scene("today", "2026-09-24"), scene("old", "2026-06-25"), scene("future", "2026-09-25")], new Date("2026-09-24T12:00:00Z")).map(({ sourceSceneId }) => sourceSceneId), ["today"]);
});

test("sync exposes dashboard shape and lets studios succeed independently", async () => {
  const path = join(tmpdir(), `liszt-${process.pid}-independent.json`);
  await writeFile(path, JSON.stringify({ lastChecked: "2026-09-20T00:00:00Z", studios: [{ id: "bad", name: "Studio bad", lastSuccessfulRefresh: "2026-09-20T00:00:00Z" }], scenes: [{ ...scene("kept", "2026-09-19"), id: "bad:kept", studioId: "bad", studio: "Studio bad" }] }));
  const result = await sync({ now: new Date("2026-09-24T12:00:00Z"), paths: [path], adapters: [adapter("good", async () => ({ scenes: [scene("new")], verifiedEmpty: false })), adapter("bad", async () => { throw new Error("source down"); })] });
  assert.deepEqual(result.scenes.map(({ id }) => id), ["good:new", "bad:kept"]);
  assert.equal(result.studios.find(({ id }) => id === "bad").error, "source down");
  assert.equal(result.studios.find(({ id }) => id === "bad").lastSuccessfulRefresh, "2026-09-20T00:00:00Z");
  assert.deepEqual(Object.keys(result).sort(), ["lastChecked", "scenes", "studios"]);
});

test("failed studios retain only last-good records still inside the rolling window", async () => {
  const path = join(tmpdir(), `liszt-${process.pid}-window.json`);
  await writeFile(path, JSON.stringify({ studios: [{ id: "bad", lastSuccessfulRefresh: "earlier" }], scenes: [{ ...scene("recent", "2026-09-01"), id: "bad:recent", studioId: "bad", studio: "Studio bad" }, { ...scene("expired", "2026-01-01"), id: "bad:expired", studioId: "bad", studio: "Studio bad" }] }));
  const result = await sync({ now: new Date("2026-09-24T12:00:00Z"), paths: [path], adapters: [adapter("bad", async () => { throw new Error("broken parse"); })] });
  assert.deepEqual(result.scenes.map(({ id }) => id), ["bad:recent"]);
});

test("Lancelot declares AnalVids as its authority", () => {
  assert.equal(studio.authority.role, "authoritative catalogue");
  assert.match(studio.authority.url, /analvids\.com/);
});
