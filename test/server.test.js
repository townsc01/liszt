import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLisztServer } from "../src/server.js";

async function withServer(options, callback) {
  const testServer = createLisztServer(options);
  testServer.listen(0, "127.0.0.1");
  await once(testServer, "listening");
  try {
    await callback(`http://127.0.0.1:${testServer.address().port}`);
  } finally {
    testServer.close();
    await once(testServer, "close");
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("POST /api/refresh syncs sources and returns the refreshed catalogue", async () => {
  const catalogue = { lastChecked: "2026-09-24T12:00:00.000Z", studios: [], scenes: [] };
  let calls = 0;
  await withServer({ syncCatalogue: async () => { calls += 1; return catalogue; } }, async (origin) => {
    const response = await fetch(`${origin}/api/refresh`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(typeof body.enrichmentPending, "boolean");
    delete body.enrichmentPending;
    assert.deepEqual(body, catalogue);
  });
  assert.equal(calls, 1);
});

test("server serves the dashboard and the catalogue API", async () => {
  const catalogue = { lastChecked: "2026-09-24T12:00:00.000Z", studios: [], scenes: [] };
  const directory = await mkdtemp(join(tmpdir(), "liszt-server-"));
  const path = join(directory, "catalogue.json");
  try {
    await writeFile(path, JSON.stringify(catalogue));
    await withServer({ cataloguePath: path }, async (origin) => {
      const page = await fetch(origin);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Liszt — Recent releases/);
      const response = await fetch(`${origin}/api/scenes`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ...catalogue, enrichmentPending: false });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("boot sync runs in the background without delaying the port binding", async () => {
  const bundled = { lastChecked: "2026-09-24T12:00:00.000Z", studios: [], scenes: [] };
  let calls = 0;
  let finishSync;
  const pendingSync = new Promise((resolve) => { finishSync = resolve; });
  const directory = await mkdtemp(join(tmpdir(), "liszt-boot-sync-"));
  const path = join(directory, "catalogue.json");
  try {
    await writeFile(path, JSON.stringify(bundled));
    await withServer({
      cataloguePath: path,
      bootSync: true,
      syncCatalogue: async () => { calls += 1; await pendingSync; return { lastChecked: "2026-09-25T00:00:00.000Z", studios: [], scenes: [] }; },
    }, async (origin) => {
      assert.equal(calls, 1, "boot should have started exactly one sync");
      const during = await fetch(`${origin}/api/scenes`);
      assert.equal(during.status, 200);
      assert.equal((await during.json()).lastChecked, bundled.lastChecked, "the bundled catalogue is served while boot sync is still in flight");
      finishSync();
      await new Promise((resolve) => setImmediate(resolve));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("boot sync and a manual refresh share one in-flight sync", async () => {
  const catalogue = { lastChecked: "2026-09-25T00:00:00.000Z", studios: [], scenes: [] };
  let calls = 0;
  let finishSync;
  const pendingSync = new Promise((resolve) => { finishSync = resolve; });
  await withServer({
    bootSync: true,
    syncCatalogue: async () => { calls += 1; await pendingSync; return catalogue; },
  }, async (origin) => {
    assert.equal(calls, 1, "boot should have started the sync");
    const refresh = fetch(`${origin}/api/refresh`, { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1, "a refresh click must join the boot sync instead of starting a second one");
    finishSync();
    const response = await refresh;
    assert.equal(response.status, 200);
  });
  assert.equal(calls, 1);
});

test("a failed boot sync leaves the server serving the retained catalogue", async () => {
  const bundled = {
    lastChecked: "2026-09-24T12:00:00.000Z",
    studios: [{ id: "tushy", name: "Tushy", authority: { name: "TPDB", url: "https://api.theporndb.net" }, lastSuccessfulRefresh: "2026-09-23T00:00:00.000Z", error: "TPDB_API_KEY is not configured" }],
    scenes: [],
  };
  let calls = 0;
  const directory = await mkdtemp(join(tmpdir(), "liszt-boot-sync-failure-"));
  const path = join(directory, "catalogue.json");
  try {
    await writeFile(path, JSON.stringify(bundled));
    await withServer({
      cataloguePath: path,
      bootSync: true,
      syncCatalogue: async () => { calls += 1; throw new Error("TPDB_API_KEY is not configured"); },
    }, async (origin) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(calls, 1, "boot should have attempted one sync");
      const response = await fetch(`${origin}/api/scenes`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.lastChecked, bundled.lastChecked, "the retained catalogue survives a failed boot sync");
      assert.equal(body.studios[0].error, "TPDB_API_KEY is not configured", "the per-studio error state is unchanged");
      assert.equal((await fetch(origin)).status, 200, "the dashboard still serves after a failed boot sync");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("boot sync stays off unless the server opts in", async () => {
  let calls = 0;
  await withServer({ syncCatalogue: async () => { calls += 1; return { scenes: [] }; } }, async (origin) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 0, "an embedded server without bootSync must not sync on start");
    assert.equal((await fetch(`${origin}/api/scenes`)).status, 200);
  });
});

test("manual refresh rejects non-POST requests", async () => {
  await withServer({}, async (origin) => {
    const response = await fetch(`${origin}/api/refresh`);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});

test("simultaneous manual refresh requests share one source sync", async () => {
  let calls = 0;
  let finishSync;
  const pendingSync = new Promise((resolve) => { finishSync = resolve; });
  await withServer({ syncCatalogue: async () => { calls += 1; await pendingSync; return { scenes: [] }; } }, async (origin) => {
    const first = fetch(`${origin}/api/refresh`, { method: "POST" });
    const second = fetch(`${origin}/api/refresh`, { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishSync();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  });
  assert.equal(calls, 1);
});

test("manual refresh returns while Sxyprn matching continues", async () => {
  let finishEnrichment;
  const pending = new Promise((resolve) => { finishEnrichment = resolve; });
  await withServer({ syncCatalogue: async () => ({ scenes: [] }), enrichCatalogue: async () => pending }, async (origin) => {
    const refreshed = await fetch(`${origin}/api/refresh`, { method: "POST" });
    assert.equal((await refreshed.json()).enrichmentPending, true);
    const during = await fetch(`${origin}/api/scenes`);
    assert.equal((await during.json()).enrichmentPending, true);
    finishEnrichment();
    await new Promise((resolve) => setImmediate(resolve));
    const after = await fetch(`${origin}/api/scenes`);
    assert.equal((await after.json()).enrichmentPending, false);
  });
});

test("video endpoint warms and caches a stream, then proxies range requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-server-video-"));
  const path = join(directory, "catalogue.json");
  const postUrl = "https://sxyprn.com/post/6ab5422fa84b6.html";
  let calls = 0;
  const upstreamRanges = [];
  try {
    await writeFile(path, JSON.stringify({ scenes: [{ id: "studio:1", videoUrls: [{ source: "sxyprn", url: postUrl, embedUrl: null, verifiedAt: "2026-09-25T00:00:00.000Z" }] }] }));
    await withServer({
      cataloguePath: path,
      videoDetails: async ({ url }) => { calls++; assert.equal(url, postUrl); return { url, streamUrl: "https://sxyprn.com/cdn8/fresh-token" }; },
      fetchVideo: async (_url, options) => {
        upstreamRanges.push(options.headers.range);
        return new Response("video bytes", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 100-110/1000", "accept-ranges": "bytes" } });
      },
    }, async (origin) => {
      const resolved = await fetch(`${origin}/api/video/resolve?scene=studio%3A1`);
      assert.equal(resolved.status, 204);
      const response = await fetch(`${origin}/api/video?scene=studio%3A1`, { headers: { range: "bytes=100-" } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-type"), "video/mp4");
      assert.equal(response.headers.get("content-range"), "bytes 100-110/1000");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "video bytes");
      const missing = await fetch(`${origin}/api/video?scene=studio%3A2`);
      assert.equal(missing.status, 404);
    });
    assert.equal(calls, 1);
    assert.deepEqual(upstreamRanges, ["bytes=100-"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video endpoint falls back to legacy sxyprnUrls for pre-migration scenes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-server-video-legacy-"));
  const path = join(directory, "catalogue.json");
  const postUrl = "https://sxyprn.com/post/6ab5422fa84b6.html";
  try {
    await writeFile(path, JSON.stringify({ scenes: [
      { id: "studio:1", sxyprnUrls: [postUrl], sxyprnCheckedAt: "2026-09-24T22:03:36.556Z" },
      { id: "studio:2", sxyprnUrls: ["http://sxyprn.com/post/6ab5422fa84b6.html", "https://sxyprn.com.evil.example/post/6ab5422fa84b6.html"] },
    ] }));
    await withServer({
      cataloguePath: path,
      videoDetails: async ({ url }) => { assert.equal(url, postUrl); return { url, streamUrl: "https://sxyprn.com/cdn8/fresh-token" }; },
      fetchVideo: async () => new Response("video bytes", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-10/11", "accept-ranges": "bytes" } }),
    }, async (origin) => {
      const resolved = await fetch(`${origin}/api/video/resolve?scene=studio%3A1`);
      assert.equal(resolved.status, 204);
      const response = await fetch(`${origin}/api/video?scene=studio%3A1`);
      assert.equal(response.status, 206);
      assert.equal(await response.text(), "video bytes");
      const unsafe = await fetch(`${origin}/api/video?scene=studio%3A2`);
      assert.equal(unsafe.status, 404);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video endpoint rejects an off-site stream returned by the extractor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-server-video-unsafe-"));
  const path = join(directory, "catalogue.json");
  const postUrl = "https://sxyprn.com/post/6ab5422fa84b6.html";
  try {
    await writeFile(path, JSON.stringify({ scenes: [{ id: "studio:1", videoUrls: [{ source: "sxyprn", url: postUrl, embedUrl: null, verifiedAt: "2026-09-25T00:00:00.000Z" }] }] }));
    await withServer({ cataloguePath: path, videoDetails: async ({ url }) => ({ url, streamUrl: "https://evil.example/video.mp4" }) }, async (origin) => {
      const response = await fetch(`${origin}/api/video?scene=studio%3A1`);
      assert.equal(response.status, 502);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
