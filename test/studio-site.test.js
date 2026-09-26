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
    durationSec: 4902,
    releaseDate: "2026-09-20",
    performers: ["Studio Name"],
  });
});

test("JSON-LD extraction takes the video entity's fields when a page entity comes first in @graph", () => {
  const html = `<script type="application/ld+json">{
    "@context":"https://schema.org",
    "@graph":[
      {"@type":"WebPage","datePublished":"2026-01-01T00:00:00Z","duration":"PT1M","actor":[{"@type":"Person","name":"Page Author"}]},
      {"@type":"VideoObject","datePublished":"2026-09-25T00:00:00Z","duration":"PT30M","actor":[{"@type":"Person","name":"Scene Performer"}]}
    ]
  }</script>`;
  assert.deepEqual(extractStudioMetadata(html, "https://sexlikereal.com/scenes/graph"), {
    durationSec: 1800,
    releaseDate: "2026-09-25",
    performers: ["Scene Performer"],
  });
});

test("JSON-LD extraction does not adopt a page entity's date as the scene release date", () => {
  const html = `<script type="application/ld+json">{
    "@type":"WebPage","datePublished":"2026-01-01T00:00:00Z","name":"Studio site"
  }</script>`;
  assert.deepEqual(extractStudioMetadata(html, "https://analvids.com/video/one"), {});
});

test("studio scraper uses a browser-like request and records field provenance", async () => {
  let request;
  const scene = { releaseUrl: "https://analvids.com/video/one", releaseDate: "2026-09-20", performers: [] };
  const result = await enrichFromStudioSite(scene, { fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, url: String(url), text: async () => '<meta itemprop="duration" content="PT24M"><meta itemprop="actor" content="Alias One, Alias Two">' };
  } });
  assert.match(request.options.headers["user-agent"], /Mozilla/);
  assert.equal(result.durationSec, 1440);
  assert.deepEqual(result.performers, ["Alias One", "Alias Two"]);
  assert.deepEqual(result.fieldProvenance, { durationSec: "studio-site", performers: "studio-site" });
  assert.equal(result.metadataPoor, false);
  assert.equal(metadataIncomplete(result), false);
});

test("dead and unparseable release URLs become metadata-poor", async () => {
  assert.deepEqual(await scrapeStudioSite({ releaseUrl: "https://sexlikereal.com/dead" }, {
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
  assert.equal(result.scenes[0].durationSec, 1200);
  assert.equal(result.scenes[0].fieldProvenance.durationSec, "studio-site");
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

test("a fresh TPDB alias list reuses the stored canonical names instead of re-scraping", async () => {
  const aliases = ["TPDB Alias"];
  const canonical = ["Studio Name"];
  const poll = () => ({ id: "studio:1", studioId: "studio", title: "A sufficiently descriptive scene title",
    releaseDate: "2026-09-23", releaseUrl: "https://analvids.com/one", performers: [...aliases] });
  const queries = [];
  const lookup = async (input) => { queries.push([...input.performers]); return []; };
  let scrapes = 0;
  const scrape = async (input) => { scrapes++; return { ...input, performers: [...canonical], fieldProvenance: { performers: "studio-site" } }; };

  const [aligned] = await enrichSxyprnLinks([poll()], [], lookup, { now: new Date("2026-09-24T12:00:00Z"), scrape });
  assert.deepEqual(aligned.performers, canonical);
  assert.equal(aligned.studioSiteNamingVersion, JSON.stringify(canonical));
  assert.equal(scrapes, 1);

  // The next sync re-fetches the same TPDB aliases; the aligned record is the prior.
  const [reused] = await enrichSxyprnLinks([poll()], [aligned], lookup, { now: new Date("2026-09-26T12:00:00Z"), scrape });
  assert.deepEqual(queries.at(-1), canonical, "the next lookup must search the canonical names");
  assert.deepEqual(reused.performers, canonical);
  assert.equal(reused.studioSiteNamingVersion, JSON.stringify(canonical));
  assert.equal(scrapes, 1, "an aligned scene must not scrape again for the same naming version");
});

test("SSRF: redirect to internal IP is blocked", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let redirectCount = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      redirectCount++;
      if (redirectCount === 1) {
        // First request returns redirect to internal IP
        return { status: 302, headers: { get: (h) => h === "location" ? "http://127.0.0.1:8080/internal" : null } };
      }
      // Should never reach here if redirect is blocked
      return { ok: true, url: String(url), text: async () => "internal" };
    }
  });
  assert.equal(result.metadataPoor, true);
  assert.equal(redirectCount, 1); // Should not follow the redirect
});

test("SSRF: redirect to private IP range is blocked", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let redirectCount = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      redirectCount++;
      if (redirectCount === 1) {
        return { status: 302, headers: { get: (h) => h === "location" ? "http://10.0.0.1:8080/internal" : null } };
      }
      return { ok: true, url: String(url), text: async () => "internal" };
    }
  });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: redirect to 169.254 metadata endpoint is blocked", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let redirectCount = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      redirectCount++;
      if (redirectCount === 1) {
        return { status: 302, headers: { get: (h) => h === "location" ? "http://169.254.169.254/latest/meta-data/" : null } };
      }
      return { ok: true, url: String(url), text: async () => "internal" };
    }
  });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: redirect to localhost is blocked", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let redirectCount = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      redirectCount++;
      if (redirectCount === 1) {
        return { status: 302, headers: { get: (h) => h === "location" ? "http://localhost:8080/internal" : null } };
      }
      return { ok: true, url: String(url), text: async () => "internal" };
    }
  });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: non-http scheme is rejected", async () => {
  const result = await scrapeStudioSite({ releaseUrl: "ftp://sexlikereal.com/file" });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: disallowed host is rejected", async () => {
  const result = await scrapeStudioSite({ releaseUrl: "https://evil.com/page" });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: direct request to private IP is rejected", async () => {
  const result = await scrapeStudioSite({ releaseUrl: "http://192.168.1.1/page" });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: direct request to localhost is rejected", async () => {
  const result = await scrapeStudioSite({ releaseUrl: "http://localhost/page" });
  assert.equal(result.metadataPoor, true);
});

test("SSRF: redirect chain with final allowed host is allowed", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let step = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      step++;
      if (step === 1) {
        return { status: 302, headers: { get: (h) => h === "location" ? "https://www.sexlikereal.com/scene/123" : null } };
      }
      return { ok: true, url: String(url), text: async () => '<meta itemprop="duration" content="PT10M">' };
    }
  });
  assert.equal(result.metadataPoor, false);
  assert.equal(result.durationSec, 600);
});

test("SSRF: redirect chain to disallowed host is blocked", async () => {
  const scene = { releaseUrl: "https://sexlikereal.com/redirect" };
  let step = 0;
  const result = await scrapeStudioSite(scene, {
    fetchImpl: async (url) => {
      step++;
      if (step === 1) {
        return { status: 302, headers: { get: (h) => h === "location" ? "https://www.sexlikereal.com/step2" : null } };
      }
      if (step === 2) {
        return { status: 302, headers: { get: (h) => h === "location" ? "http://127.0.0.1:8080/internal" : null } };
      }
      return { ok: true, url: String(url), text: async () => "internal" };
    }
  });
  assert.equal(result.metadataPoor, true);
});

test("cleanText decodes HTML entities in scraped content", () => {
  // Test cleanText via extractStudioMetadata which uses cleanText internally
  // The performers meta tag content will be processed through cleanText
  // Use single quotes for the HTML attribute to avoid issues with double quotes
  const html = `<meta itemprop="actor" content="Test &quot;Quote&quot; Plus">`;
  const result = extractStudioMetadata(html, "https://analvids.com/video/one");
  assert.deepEqual(result.performers, ["Test \"Quote\" Plus"]);
});
