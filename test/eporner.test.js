import test from "node:test";
import assert from "node:assert/strict";
import { buildEpornerQueries, createEpornerLookup, createEpornerTrustedPoolLoader, matchEpornerScene, validEpornerEmbedUrl, validEpornerUrl } from "../src/eporner.js";

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

test("eporner tolerates a failed query when another retrieval pool succeeds", async () => {
  const lookup = createEpornerLookup({ fetchImpl: async (url) => {
    if (new URL(url).searchParams.get("query") === "maddie wren") throw new Error("performer search offline");
    return { ok: true, json: async () => ({ videos: [video] }) };
  } });
  assert.equal(await lookup(scene), video);
});

test("trusted uploader candidates are combined before disagreement rejection", async () => {
  const trustedScene = { ...scene, releaseDate: "2026-09-20" };
  const first = { ...video, title: "Maddie920", uploader: undefined };
  const second = { ...video, title: "Maddie Wren alternate 920", url: "https://www.eporner.com/video-DEF456/example/",
    embed: "https://www.eporner.com/embed/DEF456/", uploader: undefined };
  const lookup = createEpornerLookup({
    fetchImpl: async () => ({ ok: true, json: async () => ({ videos: [] }) }),
    trustedUploaders: ["one", "two"],
    trustedPoolLoader: async (account) => account === "one" ? [first] : [second],
  });
  assert.equal(await lookup(trustedScene), null);
});

test("profile loader collects uploaded posts and hydrates them through the video API", async () => {
  const calls = [];
  const loader = createEpornerTrustedPoolLoader({ maxPages: 2, fetchImpl: async (url) => {
    calls.push(String(url));
    if (String(url).includes("/uploaded-videos/")) return { ok: true, text: async () =>
      String(url).includes("page=2") ? "" : '<a href="/video-ABC123/example/">upload</a>' };
    return { ok: true, json: async () => ({ ...video, title: "Maddie920" }) };
  } });
  const trustedScene = { ...scene, releaseDate: "2026-09-20" };
  const lookup = createEpornerLookup({ trustedUploaders: ["Vovick17"], trustedPoolLoader: loader,
    fetchImpl: async () => ({ ok: true, json: async () => ({ videos: [] }) }) });
  assert.equal((await lookup(trustedScene))?.title, "Maddie920");
  assert.ok(calls.some((call) => call.includes("/profile/Vovick17/uploaded-videos/")));
  assert.ok(calls.some((call) => call.includes("/api/v2/video/id/?id=ABC123")));
});
