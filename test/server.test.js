import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
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

test("POST /api/refresh syncs sources and returns the refreshed catalogue", async () => {
  const catalogue = { lastChecked: "2026-09-24T12:00:00.000Z", studios: [], scenes: [] };
  let calls = 0;
  await withServer({ syncCatalogue: async () => { calls += 1; return catalogue; } }, async (origin) => {
    const response = await fetch(`${origin}/api/refresh`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), catalogue);
  });
  assert.equal(calls, 1);
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
