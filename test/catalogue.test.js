import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { validateResult, withinRollingWindow } from "../src/catalogue.js";
import { studio as lancelotStylesEvolution } from "../src/studios/lancelot-styles-evolution.js";
import { studio as mamboPerv } from "../src/studios/mambo-perv.js";
import { studios } from "../src/studios/index.js";
import { sync } from "../src/sync.js";
import { createTpdbStudio, fetchTushyScenes, parseTpdbScene } from "../src/studios/tpdb.js";
import { studio as tushy } from "../src/studios/tushy.js";
import { fetchBangOriginalsScenes, parseListing as parseBangListing, parseVideoPage as parseBangVideoPage, studio as bangOriginals } from "../src/studios/bang-originals.js";

const scene = (id, releaseDate = "2026-09-20") => ({ sourceSceneId: id, title: `Scene ${id}`, releaseDate, performers: [], thumbnailUrl: "", releaseUrl: `https://source/${id}`, source: "Test", provenance: { source: "Test", sourceUrl: "https://source", recordUrl: `https://source/${id}`, sourceSceneId: id } });
const adapter = (id, fetchScenes) => ({ id, name: `Studio ${id}`, authority: { name: "Test", url: `https://source/${id}`, role: "authoritative catalogue" }, fetchScenes });

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

test("Lancelot and Mambo Perv use TPDB with matching site filters", () => {
  assert.equal(lancelotStylesEvolution.authority.name, "ThePornDB");
  assert.equal(mamboPerv.authority.name, "ThePornDB");
  assert.equal(lancelotStylesEvolution.id, "lancelot-styles-evolution");
  assert.equal(mamboPerv.id, "mambo-perv");
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

test("maps TPDB scene records and tolerates absent optional metadata", async () => {
  const fixtureData = JSON.parse(await readFile(new URL("../fixtures/tpdb-tushy.json", import.meta.url), "utf8"));
  const [parsed] = fixtureData.data.map((record) => parseTpdbScene(record));
  assert.deepEqual(parsed, {
    sourceSceneId: "tpdb-scene-uuid-001",
    title: "Example Tushy Scene",
    releaseDate: "2026-09-20",
    durationSec: null,
    performers: ["Performer One"],
    thumbnailUrl: "https://cdn.example/tushy-scene.jpg",
    releaseUrl: "https://www.tushy.com/scenes/example-tushy-scene",
    source: "ThePornDB",
    provenance: { source: "ThePornDB", sourceUrl: tushy.authority.url, recordUrl: "https://www.tushy.com/scenes/example-tushy-scene", sourceSceneId: "tpdb-scene-uuid-001" },
  });
  assert.equal(parseTpdbScene({ id: 42, title: "Bare", date: "2026-09-20" }).thumbnailUrl, "");
  assert.deepEqual(parseTpdbScene({ id: 42, title: "Bare", date: "2026-09-20" }).performers, []);
  assert.deepEqual(parseTpdbScene({ id: 43, title: "Mixed", date: "2026-09-20", performers: [
    { name: "Jane", extras: { gender: "fEmAlE" } },
    { name: "John", extras: { gender: "Male" } },
    { name: "Unknown" },
    { name: "Trans man", extras: { gender: "TRANSGENDER_MALE" } },
  ] }).performers, ["Jane", "Unknown"]);
  assert.throws(() => parseTpdbScene({ title: "Missing ID", date: "2026-09-20" }), /missing its ID/);
});

test("TPDB scene parser records the correct shared API provenance for each studio", async () => {
  for (const adapter of [lancelotStylesEvolution, mamboPerv]) {
    const result = await adapter.fetchScenes({ apiKey: "test-secret", fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.pathname === "/sites" ? [{ id: adapter.id, name: adapter.name }] : [{ id: "scene-1", title: "Scene", date: "2026-09-20" }];
      return { ok: true, json: async () => ({ data }) };
    } });
    assert.equal(result.scenes[0].provenance.source, "ThePornDB");
    assert.equal(result.scenes[0].provenance.sourceUrl, adapter.authority.url);
  }
});

test("Tushy polls all TPDB pages with bearer auth and confirms empty results", async () => {
  const requests = [];
  const now = new Date("2026-09-24T12:00:00Z");
  const result = await fetchTushyScenes({ now, apiKey: "test-secret", fetchImpl: async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.authorization });
    const requestUrl = new URL(url);
    const data = requestUrl.pathname === "/sites"
      ? [{ id: 77, name: "Tushy", short_name: "tushy" }]
      : requestUrl.pathname === "/performers"
        ? requestUrl.searchParams.has("gender") ? null : requestUrl.searchParams.get("q") === "name only" ? [{ id: "female-search-result", name: "Name Only", extras: { gender: "FEMALE" } }] : []
      : requestUrl.pathname.startsWith("/performers/")
        ? { id: requestUrl.pathname.split("/").at(-1), extras: { gender: requestUrl.pathname.endsWith("female") ? "Female" : "Male" } }
      : Number(requestUrl.searchParams.get("page")) === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: `scene-${index}`, title: `Scene ${index}`, date: "2026-09-20", ...(index === 0 ? { performers: [{ id: "female", name: "Female Performer" }, { name: "Name Only" }, { name: "Unclassified" }] } : {}) }))
        : [{ id: "last-scene", title: "Last scene", date: "2026-09-21", performers: [{ id: "male", name: "Male Performer" }] }];
    if (requestUrl.pathname === "/performers" && requestUrl.searchParams.has("gender")) return { ok: false, status: 422 };
    return { ok: true, status: 200, json: async () => ({ data }) };
  } });
  const sceneRequests = requests.filter(({ url }) => new URL(url).pathname === "/scenes");
  assert.equal(result.scenes.length, 101);
  assert.deepEqual(requests.slice(0, 3).map(({ url }) => new URL(url).pathname), ["/sites", "/scenes", "/scenes"]);
  assert.deepEqual(sceneRequests.map(({ url }) => new URL(url).searchParams.get("page")), ["1", "2"]);
  assert.ok(sceneRequests.every(({ url }) => new URL(url).searchParams.get("site_id") === "77"));
  assert.ok(sceneRequests.every(({ url }) => new URL(url).searchParams.get("date") === "2026-06-26"));
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer test-secret"));
  assert.equal(requests[0].url.includes("test-secret"), false);
  assert.deepEqual(result.scenes[0].performers, ["Female Performer", "Name Only", "Unclassified"]);
  assert.deepEqual(result.scenes.at(-1).performers, []);

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

test("parses Bang! Originals listing and video structured metadata", async () => {
  const listingHtml = await readFile(new URL("../fixtures/bang-originals/listing-page.html", import.meta.url), "utf8");
  const [listing] = parseBangListing(listingHtml);
  assert.equal(listing.releaseUrl, "https://www.bang.com/video/ajuEIS5bRIK_BcO-/luna-colombiana-gives-a-whole-new-meaning-to-hardcore-anal");
  const pageHtml = await readFile(new URL("../fixtures/bang-originals/video-page.html", import.meta.url), "utf8");
  const parsed = parseBangVideoPage(pageHtml, listing.releaseUrl);
  assert.equal(parsed.sourceSceneId, "ajuEIS5bRIK_BcO-");
  assert.equal(parsed.releaseDate, "2026-09-09");
  assert.equal(parsed.title, "Luna Colombiana Gives A Whole New Meaning To Hardcore Anal");
  assert.deepEqual(parsed.performers, ["Luna Colombiana", "Zac Wild"]);
  assert.match(parsed.thumbnailUrl, /62354\/285467\.jpg/);
  assert.equal(studios.find(({ id }) => id === "bang-originals"), bangOriginals);
});

test("Bang! Originals follows pagination, imports recent videos, and confirms an empty window", async () => {
  const listingHtml = await readFile(new URL("../fixtures/bang-originals/listing-page.html", import.meta.url), "utf8");
  const page2 = listingHtml.replace(/<link rel="next" href="[^"]+">/, "");
  const videoHtml = await readFile(new URL("../fixtures/bang-originals/video-page.html", import.meta.url), "utf8");
  const urls = [];
  const result = await fetchBangOriginalsScenes({ now: new Date("2026-09-24T12:00:00Z"), fetchImpl: async (url) => {
    urls.push(String(url));
    const body = String(url).includes("page=2") ? page2 : String(url).includes("/video/") ? videoHtml : listingHtml;
    return { ok: true, text: async () => body };
  } });
  assert.ok(urls.some((url) => url.includes("page=2")));
  assert.equal(result.scenes.length, 5);
  assert.ok(result.scenes.some(({ sourceSceneId }) => sourceSceneId === "ajuEIS5bRIK_BcO-"));
  assert.equal(result.verifiedEmpty, false);
  const empty = await fetchBangOriginalsScenes({ now: new Date("2027-01-01T12:00:00Z"), fetchImpl: async (url) => ({ ok: true, text: async () => String(url).includes("/video/") ? videoHtml : listingHtml }) });
  assert.deepEqual(empty, { scenes: [], verifiedEmpty: true });
});


test("TPDB bounds concurrent studio-site enrichment", async () => {
  let active = 0;
  let peak = 0;
  const result = await fetchTushyScenes({
    apiKey: "test-secret",
    studioSiteConcurrency: 2,
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const data = requestUrl.pathname === "/sites"
        ? [{ id: 77, name: "Tushy" }]
        : Array.from({ length: 8 }, (_, index) => ({
          id: `scene-${index}`,
          title: `Scene ${index}`,
          date: "2026-09-20",
          releaseUrl: `https://studio.example/scene-${index}`,
        }));
      return { ok: true, status: 200, json: async () => ({ data }) };
    },
    enrichStudioSite: async (item) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return item;
    },
  });
  assert.equal(result.scenes.length, 8);
  assert.equal(peak, 2);
});
