import test from "node:test";
import assert from "node:assert/strict";
import { buildEpornerQueries, createEpornerLookup, matchEpornerScene, validEpornerEmbedUrl, validEpornerUrl } from "../src/eporner.js";

const scene = { studio: "Tushy", title: "Perfect Hottie Wants Anal", performers: ["Maddie Wren"], durationSec: 2160 };
const video = { title: "Tushy Maddie Wren Perfect Hottie Wants Anal", length_sec: 2159, views: 42,
  url: "https://www.eporner.com/video-ABC123/example/", embed: "https://www.eporner.com/embed/ABC123/", added: "2026-09-20" };

test("eporner accepts only canonical API links behind the duration and identity gates", () => {
  assert.equal(matchEpornerScene(scene, [video]), video);
  assert.equal(matchEpornerScene(scene, [{ ...video, length_sec: 2163 }]), null);
  assert.equal(matchEpornerScene(scene, [{ ...video, title: "Tushy Someone Else" }]), null);
  assert.equal(matchEpornerScene({ ...scene, durationSec: null }, [video]), null);
  assert.equal(validEpornerUrl(video.url), true);
  assert.equal(validEpornerEmbedUrl(video.embed), true);
  assert.equal(validEpornerEmbedUrl("https://eporner.com.evil.example/embed/ABC123/"), false);
});

test("eporner lookup caches performer, studio and title-keyword pools", async () => {
  const calls = [];
  const lookup = createEpornerLookup({ fetchImpl: async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ videos: [video] }) };
  } });
  assert.equal(await lookup(scene), video);
  assert.equal(await lookup({ ...scene, title: "No match", performers: ["Nobody"] }), null);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => new URL(call).searchParams.get("per_page") === "1000"));
  assert.ok(calls.some((call) => new URL(call).searchParams.get("query") === "Tushy"));
  assert.ok(buildEpornerQueries({ ...scene, creatorStudio: true }).every((query) => query !== "Tushy"));
});

test("eporner tolerates partial query failures and evaluates trusted accounts as one pool", async () => {
  const lookup = createEpornerLookup({
    fetchImpl: async (url) => new URL(url).searchParams.get("query") === "Tushy"
      ? { ok: true, json: async () => ({ videos: [] }) }
      : { ok: false, status: 503 },
    trustedUploaders: ["one", "two"],
    trustedPoolLoader: async (account) => [account === "one"
      ? { ...video, title: "Maddie", author: undefined }
      : { ...video, title: "Maddie Wren different scene", url: "https://www.eporner.com/video-XYZ789/example/",
        embed: "https://www.eporner.com/embed/XYZ789/", author: undefined }],
  });
  assert.equal(await lookup(scene), null);
});
