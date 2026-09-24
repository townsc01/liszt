import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createLisztServer } from "../src/server.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withServer(options, callback) {
  const testServer = createLisztServer({ authToken: "secret", ...options });
  testServer.listen(0, "127.0.0.1");
  await once(testServer, "listening");
  try {
    await callback(`http://127.0.0.1:${testServer.address().port}`);
  } finally {
    testServer.close();
    await once(testServer, "close");
  }
}

test("POST /api/refresh syncs sources and returns the refreshed catalogue", async () => {
  const catalogue = { lastChecked: "2026-09-24T12:00:00.000Z", studios: [], scenes: [] };
  let calls = 0;
  await withServer({ syncCatalogue: async () => { calls += 1; return catalogue; } }, async (origin) => {
    const response = await fetch(`${origin}/api/refresh`, { method: "POST", headers: { authorization: "Bearer secret" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), catalogue);
  });
  assert.equal(calls, 1);
});

test("manual refresh rejects non-POST requests", async () => {
  await withServer({}, async (origin) => {
    const response = await fetch(`${origin}/api/refresh`, { headers: { authorization: "Bearer secret" } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});

test("simultaneous manual refresh requests share one source sync", async () => {
  let calls = 0;
  let finishSync;
  const pendingSync = new Promise((resolve) => { finishSync = resolve; });
  await withServer({ syncCatalogue: async () => { calls += 1; await pendingSync; return { scenes: [] }; } }, async (origin) => {
    const first = fetch(`${origin}/api/refresh`, { method: "POST", headers: { authorization: "Bearer secret" } });
    const second = fetch(`${origin}/api/refresh`, { method: "POST", headers: { authorization: "Bearer secret" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishSync();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  });
  assert.equal(calls, 1);
});

test("authenticated preview and add flow saves once and reports first-sync progress", async () => {
  const path = join(tmpdir(), `liszt-server-studios-${process.pid}.json`);
  const preview = { name: "Northstar", homepageUrl: "https://northstar.example/", supported: true, missing: [], pages: [{ url: "https://northstar.example/", records: 1 }], scenes: [{ title: "Aurora", releaseDate: "2026-09-20" }] };
  const catalogue = { lastChecked: "2026-09-24T00:00:00Z", studios: [{ id: "northstar" }], scenes: [] };
  await withServer({ studioDefinitionsPath: path, discover: async () => preview, syncCatalogue: async () => catalogue }, async (origin) => {
    const headers = { authorization: "Bearer secret", "content-type": "application/json" };
    const unauthorised = await fetch(`${origin}/api/studios/preview`, { method: "POST", body: JSON.stringify({ url: preview.homepageUrl }) });
    assert.equal(unauthorised.status, 401);
    const shown = await (await fetch(`${origin}/api/studios/preview`, { method: "POST", headers, body: JSON.stringify({ url: preview.homepageUrl }) })).json();
    assert.equal(shown.name, "Northstar");
    const accepted = await (await fetch(`${origin}/api/studios`, { method: "POST", headers, body: JSON.stringify({ previewId: shown.previewId }) })).json();
    let job;
    do { await new Promise((resolve) => setTimeout(resolve, 5)); job = await (await fetch(`${origin}/api/jobs/${accepted.jobId}`, { headers })).json(); } while (job.state !== "complete");
    assert.deepEqual(job.catalogue, catalogue);
  });
});
