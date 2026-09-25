import test from "node:test";
import assert from "node:assert/strict";
import { enrichFromStudioSite, extractStudioMetadata, metadataIncomplete, parseIsoDuration, scrapeStudioSite } from "../src/studio-site.js";
import { enrichSxyprnLinks } from "../src/sxyprn.js";
import { createTpdbStudio } from "../src/studios/tpdb.js";

test("studio metadata prefers structured data and normalises ISO durations", () => {
  const html = `<!doctype html><script type="application/ld+json">{
    "@type":"VideoObject", "duration":"PT1H21M42S", "datePublished":"2026-09-20T10:00:00Z",
    "actor":[{"@type":"Person","name":"Studio Name"}]
  }</script>`;
  assert.equal(parseIsoDuration("PT1H21M42S"), 4902);
  assert.equal(parseIsoDuration("01:21:42"), 4902);
  assert.deepEqual(extractStudioMetadata(html, "https://sexlikereal.com/scenes/one"), {
    durationSeconds: 4902,
    releaseDate: "2026-09-20",
    performers: ["Studio Name"],
  });
});

test("studio scraper uses a browser-like request and records field provenance", async () => {
  let request;
  const scene = { releaseUrl: "https://analvids.com/video/one", releaseDate: "2026-09-20", performers: [] };
  const result = await enrichFromStudioSite(scene, { fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, url: String(url), text: async () => '<meta itemprop="duration" content="PT24M"><meta itemprop="actor" content="Alias One, Alias Two">' };
  } });
  assert.match(request.options.headers["user-agent"], /Mozilla/);
  assert.equal(result.durationSeconds, 1440);
  assert.deepEqual(result.performers, ["Alias One", "Alias Two"]);
  assert.deepEqual(result.fieldProvenance, { durationSeconds: "studio-site", performers: "studio-site" });
  assert.equal(result.metadataPoor, false);
  assert.equal(metadataIncomplete(result), false);
});

test("dead and unparseable release URLs become metadata-poor", async () => {
  assert.deepEqual(await scrapeStudioSite({ releaseUrl: "https://example.test/dead" }, {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), { metadataPoor: true, studioSiteStatus: 404 });
  assert.deepEqual(await scrapeStudioSite({ releaseUrl: "not a URL" }), { metadataPoor: true });
});

test("incomplete TPDB results are enriched immediately from their release URL", async () => {
  const adapter = createTpdbStudio({ id: "example", name: "Example", siteId: 12 });
  const calls = [];
  const result = await adapter.fetchScenes({ apiKey: "secret", fetchImpl: async (input) => {
    const url = new URL(input);
    calls.push(url.href);
    if (url.hostname === "api.theporndb.net") return { ok: true, json: async () => ({ data: [{
      id: "one", title: "A scene", date: "2026-09-20", performers: [{ name: "TPDB Alias", gender: "Female" }],
      url: "https://sexlikereal.com/scenes/one",
    }] }) };
    return { ok: true, url: url.href, text: async () => '<script type="application/ld+json">{"@type":"VideoObject","duration":"PT20M"}</script>' };
  } });
  assert.equal(result.scenes[0].durationSeconds, 1200);
  assert.equal(result.scenes[0].fieldProvenance.durationSeconds, "studio-site");
  assert.equal(calls.filter((url) => url.startsWith("https://sexlikereal.com/")).length, 1);
});

test("a zero-match pass aligns names once and defers retrieval to the next pass", async () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const scene = { id: "studio:1", studioId: "studio", title: "A sufficiently descriptive scene title", releaseDate: "2026-09-23",
    releaseUrl: "https://analvids.com/one", performers: ["TPDB Alias"] };
  let scrapes = 0;
  const scrape = async (input) => { scrapes++; return { ...input, performers: ["Studio Name"], fieldProvenance: { performers: "studio-site" } }; };
  const [aligned] = await enrichSxyprnLinks([scene], [], async () => [], { now, scrape });
  assert.deepEqual(aligned.performers, ["Studio Name"]);
  assert.equal(scrapes, 1);
  const [stillMissing] = await enrichSxyprnLinks([aligned], [aligned], async () => [], {
    now: new Date("2026-09-26T12:00:00Z"), scrape,
  });
  assert.equal(scrapes, 1);
  assert.deepEqual(stillMissing.performers, ["Studio Name"]);
});
