import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createVideoProxy, streamExpiry } from "../src/video-proxy.js";

const postUrl = "https://sxyprn.com/post/6ab5422fa84b6.html";

function fakeUpstream(body, { status = 200, headers = { "content-type": "video/mp4" }, signal, chunkIntervalMs = 0 } = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers: new Headers(headers),
    body: new ReadableStream({
      offset: 0,
      // Behave like a fetch body: an abort of the combined signal fails the stream.
      start(controller) {
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
      async pull(controller) {
        if (this.offset >= bytes.length) return controller.close();
        if (chunkIntervalMs) await new Promise((resolve) => setTimeout(resolve, chunkIntervalMs));
        controller.enqueue(bytes.subarray(this.offset, this.offset += 64));
      },
    }),
  };
}

function fakeResponse() {
  const response = new PassThrough();
  response.socket = new PassThrough();
  let ended = false;
  Object.defineProperty(response, "writableEnded", { get: () => ended });
  response.writeHead = (status, headers) => {
    response.head = { status, headers };
    return response;
  };
  response.end = ((end) => function (...args) {
    ended = true;
    return end.apply(response, args);
  })(response.end);
  return response;
}

function fakeRequest(range) {
  const request = new PassThrough();
  request.headers = range ? { range } : {};
  return request;
}

const detail = { url: postUrl, streamUrl: "https://sxyprn.com/cdn8/token/file.vid" };
const videoDetails = async () => detail;

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

test("a healthy stream longer than the upstream timeout completes", async () => {
  const proxy = createVideoProxy({ videoDetails });
  const request = fakeRequest();
  const response = fakeResponse();
  const body = "x".repeat(1024);
  // A healthy upstream that is still streaming when the 30s upstream timeout fires:
  // 16 chunks at 2s intervals spans ~32s.
  const fetchImpl = async (_url, { signal }) => fakeUpstream(body, { signal, chunkIntervalMs: 2000 });
  const streamed = proxy.stream("scene:1", postUrl, request, response, { fetchImpl });
  await streamed;
  assert.equal(response.head.status, 200);
  assert.equal(response.writableEnded, true);
  assert.equal((await response.toArray()).join(""), body);
});

test("a stalled upstream still times out", async () => {
  const proxy = createVideoProxy({ videoDetails });
  const request = fakeRequest();
  const response = fakeResponse();
  // Never delivers a response; the 30s upstream timeout must still fire.
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
  await assert.rejects(proxy.stream("scene:1", postUrl, request, response, { fetchImpl }), /timeout/i);
});
