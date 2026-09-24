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

test("shared page fetch falls back to FlareSolverr on HTTP 403", async () => {
  const { fetchPageText } = await import("../src/fetch-page.js");
  const priorEndpoint = process.env.FLARESOLVERR_URL;
  process.env.FLARESOLVERR_URL = "http://flaresolverr:8191/v1";
  const requests = [];
  try {
    const html = await fetchPageText("https://studio.example/videos", async (url, options) => {
      requests.push({ url, options });
      if (url === "https://studio.example/videos") return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ status: "ok", solution: { status: 200, response: "<html>solved</html>" } }) };
    }, { source: "Example Studio" });
    assert.equal(html, "<html>solved</html>");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "http://flaresolverr:8191/v1");
    assert.deepEqual(JSON.parse(requests[1].options.body), { cmd: "request.get", url: "https://studio.example/videos", maxTimeout: 60_000 });
  } finally {
    if (priorEndpoint === undefined) delete process.env.FLARESOLVERR_URL;
    else process.env.FLARESOLVERR_URL = priorEndpoint;
  }
});

test("shared page fetch does not call FlareSolverr for successful pages", async () => {
  const { fetchPageText } = await import("../src/fetch-page.js");
  const priorEndpoint = process.env.FLARESOLVERR_URL;
  process.env.FLARESOLVERR_URL = "http://flaresolverr:8191/v1";
  let calls = 0;
  try {
    const html = await fetchPageText("https://studio.example/videos", async () => {
      calls++;
      return { ok: true, text: async () => "ordinary html" };
    });
    assert.equal(html, "ordinary html");
    assert.equal(calls, 1);
  } finally {
    if (priorEndpoint === undefined) delete process.env.FLARESOLVERR_URL;
    else process.env.FLARESOLVERR_URL = priorEndpoint;
  }
});
