import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { validateResult, withinRollingWindow } from "../src/catalogue.js";
import { parseListing, parseScenePage, studio } from "../src/studios/lancelot-styles-evolution.js";
import { fetchAnalVidsScenes as fetchMamboPervScenes, parseListing as parseMamboPervListing, parseScenePage as parseMamboPervScenePage, studio as mamboPerv } from "../src/studios/mambo-perv.js";
import { studios } from "../src/studios/index.js";
import { sync } from "../src/sync.js";
import { fetchTushyScenes, parseTpdbScene, studio as tushy } from "../src/studios/tushy.js";

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

test("sync defaults to the local catalogue only and accepts explicit output paths", async () => {
  const source = await readFile(new URL("../src/sync.js", import.meta.url), "utf8");
  assert.match(source, /:\s*\[`\$\{root\}\/data\/catalogue\.json`\]/);
  assert.doesNotMatch(source, /docs\/catalogue\.json/);

  const path = join(tmpdir(), `liszt-${process.pid}-explicit-output.json`);
  const result = await sync({ paths: [path], adapters: [adapter("explicit", async () => ({ scenes: [scene("out")], verifiedEmpty: false }))] });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), result);

  const envPath = join(tmpdir(), `liszt-${process.pid}-env-output.json`);
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", "import { sync } from './src/sync.js'; await sync({ adapters: [] });"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, LISZT_DATA_PATH: envPath },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(JSON.parse(await readFile(envPath, "utf8")).lastChecked);
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

test("parses representative saved Mambo Perv listing and scene pages", async () => {
  const mamboFixture = (name) => readFile(new URL(`../fixtures/mambo-perv/${name}`, import.meta.url), "utf8");
  const [listing] = parseMamboPervListing(await mamboFixture("listing.html"));
  assert.deepEqual(listing, {
    title: "Lika Sanches & scene OB668",
    releaseUrl: "https://www.analvids.com/watch/5281264/19y_very_beautiful_brazilian_lika_sanches_first_double_anal_penetration_dapbreakin_dap_anal_2on1_bbc_dirty_talk_ob668",
    thumbnailUrl: "https://cdn.example/mambo-thumb.jpg?x=1&y=2",
  });
  const parsed = parseMamboPervScenePage(await mamboFixture("scene.html"), listing, new Set(["308317/lika_sanches"]));
  assert.equal(parsed.sourceSceneId, "5281264");
  assert.equal(parsed.releaseDate, "2026-09-20");
  assert.deepEqual(parsed.performers, ["Lika Sanches"]);
  assert.deepEqual(parsed.provenance, { source: "AnalVids", sourceUrl: mamboPerv.authority.url, recordUrl: listing.releaseUrl, sourceSceneId: "5281264" });
});

test("Mambo Perv treats a zero-card parse as a failed fetch", async () => {
  const response = { ok: true, text: async () => "<html><body>No scene cards</body></html>" };
  await assert.rejects(fetchMamboPervScenes({ now: new Date("2026-09-24T12:00:00Z"), fetchImpl: async () => response }), /no Mambo Perv scene cards/);
});

test("Mambo Perv is registered for the dashboard filter with its documented authority", async () => {
  assert.equal(studios.find(({ id }) => id === "mambo-perv"), mamboPerv);
  assert.equal(mamboPerv.authority.role, "authoritative catalogue");
  const dashboard = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(dashboard, /statuses\.map/);
  assert.match(dashboard, /<option value=/);
});

test("a failed Mambo Perv fetch preserves its last good catalogue", async () => {
  const path = join(tmpdir(), `liszt-${process.pid}-mambo-retention.json`);
  const prior = { ...scene("5281264", "2026-09-20"), id: "mambo-perv:5281264", studioId: "mambo-perv", studio: "Mambo Perv" };
  await writeFile(path, JSON.stringify({ lastChecked: "2026-09-21T00:00:00Z", studios: [{ id: "mambo-perv", name: "Mambo Perv", lastSuccessfulRefresh: "2026-09-21T00:00:00Z" }], scenes: [prior] }));
  const result = await sync({ now: new Date("2026-09-24T12:00:00Z"), paths: [path], adapters: [{ ...mamboPerv, fetchScenes: async () => { throw new Error("source unavailable"); } }] });
  assert.deepEqual(result.scenes.map(({ id }) => id), ["mambo-perv:5281264"]);
  assert.equal(result.studios[0].lastSuccessfulRefresh, "2026-09-21T00:00:00Z");
  assert.equal(result.studios[0].error, "source unavailable");
});

test("AnalVids retries transient network failures and identifies exhausted URL", async () => {
  const { fetchAnalVidsText } = await import("../src/studios/analvids-fetch.js");
  let calls = 0;
  const url = "https://www.analvids.com/watch/123/example";
  const text = await fetchAnalVidsText(url, async () => {
    if (++calls < 3) throw new TypeError("fetch failed");
    return { ok: true, text: async () => "scene" };
  }, { delay: async () => {} });
  assert.equal(text, "scene");
  assert.equal(calls, 3);
  await assert.rejects(fetchAnalVidsText(url, async () => { throw new TypeError("fetch failed"); }, { delay: async () => {} }), /fetch failed for https:\/\/www\.analvids\.com\/watch\/123\/example after 3 attempts/);
});

test("maps TPDB scene records and tolerates absent optional metadata", async () => {
  const fixtureData = JSON.parse(await readFile(new URL("../fixtures/tpdb-tushy.json", import.meta.url), "utf8"));
  const [parsed] = fixtureData.data.map(parseTpdbScene);
  assert.deepEqual(parsed, {
    sourceSceneId: "tpdb-scene-uuid-001",
    title: "Example Tushy Scene",
    releaseDate: "2026-09-20",
    performers: ["Performer One", "Performer Two"],
    thumbnailUrl: "https://cdn.example/tushy-scene.jpg",
    releaseUrl: "https://www.tushy.com/scenes/example-tushy-scene",
    source: "ThePornDB",
    provenance: { source: "ThePornDB", sourceUrl: tushy.authority.url, recordUrl: "https://www.tushy.com/scenes/example-tushy-scene", sourceSceneId: "tpdb-scene-uuid-001" },
  });
  assert.equal(parseTpdbScene({ id: 42, title: "Bare", date: "2026-09-20" }).thumbnailUrl, "");
  assert.deepEqual(parseTpdbScene({ id: 42, title: "Bare", date: "2026-09-20" }).performers, []);
  assert.throws(() => parseTpdbScene({ title: "Missing ID", date: "2026-09-20" }), /missing its ID/);
});

test("Tushy polls all TPDB pages with bearer auth and confirms empty results", async () => {
  const requests = [];
  const now = new Date("2026-09-24T12:00:00Z");
  const result = await fetchTushyScenes({ now, apiKey: "test-secret", fetchImpl: async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.authorization });
    const requestUrl = new URL(url);
    const data = requestUrl.pathname === "/sites"
      ? [{ id: 77, name: "Tushy", short_name: "tushy" }]
      : Number(requestUrl.searchParams.get("page")) === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: `scene-${index}`, title: `Scene ${index}`, date: "2026-09-20" }))
        : [{ id: "last-scene", title: "Last scene", date: "2026-09-21" }];
    return { ok: true, json: async () => ({ data }) };
  } });
  assert.equal(result.scenes.length, 101);
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ["/sites", "/scenes", "/scenes"]);
  assert.deepEqual(requests.slice(1).map(({ url }) => new URL(url).searchParams.get("page")), ["1", "2"]);
  assert.ok(requests.slice(1).every(({ url }) => new URL(url).searchParams.get("site_id") === "77"));
  assert.ok(requests.slice(1).every(({ url }) => new URL(url).searchParams.get("date") === "2026-06-26"));
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer test-secret"));
  assert.equal(requests[0].url.includes("test-secret"), false);

  let emptyCall = 0;
  const empty = await fetchTushyScenes({ apiKey: "test-secret", fetchImpl: async () => {
    emptyCall += 1;
    return { ok: true, json: async () => ({ data: emptyCall === 1 ? [{ id: 77, name: "Tushy" }] : [] }) };
  } });
  assert.deepEqual(empty, { scenes: [], verifiedEmpty: true });
});

test("Tushy reports missing credentials, HTTP errors, and malformed responses without leaking the key", async () => {
  await assert.rejects(fetchTushyScenes({ apiKey: "" }), /TPDB_API_KEY is not configured/);
  await assert.rejects(fetchTushyScenes({ apiKey: "secret", fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  let malformedCall = 0;
  await assert.rejects(fetchTushyScenes({ apiKey: "secret", fetchImpl: async () => {
    malformedCall += 1;
    return { ok: true, json: async () => (malformedCall === 1 ? { data: [{ id: 77, name: "Tushy" }] } : { nope: [] }) };
  } }), /invalid response/);
  assert.equal(studios.find(({ id }) => id === "tushy"), tushy);
});
