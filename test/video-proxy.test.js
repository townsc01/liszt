import test from "node:test";
import assert from "node:assert/strict";
import { createVideoProxy, streamExpiry } from "../src/video-proxy.js";

const postUrl = "https://sxyprn.com/post/6ab5422fa84b6.html";

test("stream expiry uses the signed URL timestamp with a safety margin", () => {
  assert.equal(streamExpiry("https://sxyprn.com/cdn8/token/1790324543/file.vid", 1_700_000_000_000), 1_790_324_483_000);
  assert.equal(streamExpiry("https://sxyprn.com/cdn8/no-expiry/file.vid", 1_700_000_000_000), 1_700_000_900_000);
});

test("concurrent resolves coalesce into one mint", async () => {
  let calls = 0;
  let finish;
  const details = new Promise((resolve) => { finish = resolve; });
  const proxy = createVideoProxy({ videoDetails: async () => { calls++; return details; } });
  const first = proxy.resolve("scene:1", postUrl);
  const second = proxy.resolve("scene:1", postUrl);
  finish({ url: postUrl, streamUrl: "https://sxyprn.com/cdn8/token" });
  assert.equal(await first, "https://sxyprn.com/cdn8/token");
  assert.equal(await second, "https://sxyprn.com/cdn8/token");
  assert.equal(calls, 1);
});
