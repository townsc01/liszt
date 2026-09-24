import test from "node:test";
import assert from "node:assert/strict";
import { createEpornerLookup, enrichEpornerLinks, validEpornerUrl } from "../src/eporner.js";
import { renderSceneLinks } from "../public/scene-links.js";
import { sync } from "../src/sync.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scene = { id: "studio:1", sourceSceneId: "1", studioId: "studio", studio: "Studio", title: "Lana Wills Double Anal Debut", releaseDate: "2026-09-20", performers: ["Lana Wills"], releaseUrl: "https://source.example/1" };
const url = "https://www.eporner.com/video-AbC123xyZ90/lana-wills-double-anal-debut/";
const candidate = (id = "AbC123xyZ90", title = scene.title, link = url) => ({ id, title, url: link, keywords: "Lana Wills, anal" });
const response = (data, source) => ({ ok: true, json: async () => ({ success: true, data, source }) });

function api({ candidates = [candidate()], details = { title: scene.title, models: [] }, source, searchError = false, titleOnly = false } = {}) {
  const calls = [];
  const fetchImpl = async (input) => {
    const target = new URL(input);
    calls.push(target);
    if (target.pathname.endsWith("/search/")) {
      if (searchError) throw new Error("upstream unavailable");
      return { ok: true, json: async () => ({ videos: titleOnly && target.searchParams.get("query") === "lana wills" ? [] : candidates }) };
    }
    const id = target.searchParams.get("id")?.replace(/^video-/, "");
    return response(details, source || candidates.find((item) => item.id === id)?.url);
  };
  return { lookup: createEpornerLookup({ baseUrl: "http://127.0.0.1:3001", fetchImpl }), calls };
}

test("confident title and performer agreement produces a verified Eporner link", async () => {
  const { lookup, calls } = api();
  assert.equal(await lookup(scene), url);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].searchParams.get("query"), "lana wills");
  assert.equal(calls[1].searchParams.get("query"), "double anal debut");
  assert.equal(calls[2].searchParams.get("id"), "video-AbC123xyZ90");
});

test("title search finds a match when performer search returns nothing", async () => {
  const { lookup } = api({ titleOnly: true });
  assert.equal(await lookup(scene), url);
});

test("near title matches and missing performer evidence do not produce links", async () => {
  assert.equal(await api({ details: { title: "Lana Wills Relaxing Massage Debut", models: ["Lana Wills"] } }).lookup(scene), null);
  assert.equal(await api({ details: { title: "Double Anal Debut From Studio", models: ["Another Person"] }, candidates: [{ ...candidate(), title: "Double Anal Debut From Studio", keywords: "unrelated" }] }).lookup({ ...scene, title: "Double Anal Debut From Studio" }), null);
  const noPerformer = api();
  assert.equal(await noPerformer.lookup({ ...scene, performers: [] }), null);
  assert.equal(noPerformer.calls.length, 0);
});

test("ambiguous equally strong candidates are withheld", async () => {
  const second = candidate("XyZ999abC12", scene.title, "https://www.eporner.com/video-XyZ999abC12/duplicate/");
  const { lookup } = api({ candidates: [candidate(), second] });
  assert.equal(await lookup(scene), null);
});

test("malformed and off-site URLs are rejected", async () => {
  for (const unsafe of ["https://eporner.com.evil.example/video-AbC123xyZ90/x/", "http://www.eporner.com/video-AbC123xyZ90/x/", "https://www.eporner.com/search/?q=x", "javascript:alert(1)"]) {
    assert.equal(validEpornerUrl(unsafe), false);
    assert.equal(await api({ source: unsafe }).lookup(scene), null);
  }
  assert.equal(await api({ candidates: [candidate("AbC123xyZ90", scene.title, "https://other.example/video-AbC123xyZ90/x/")] }).lookup(scene), null);
});

test("empty searches and Lustpress failures leave scenes unlinked", async () => {
  assert.equal(await api({ candidates: [] }).lookup(scene), null);
  assert.equal(await api({ searchError: true }).lookup(scene), null);
  const path = join(tmpdir(), `liszt-eporner-${process.pid}.json`);
  const adapter = { id: "studio", name: "Studio", authority: { name: "Test", url: "https://source.example" }, fetchScenes: async () => ({ scenes: [{ ...scene, id: undefined }], verifiedEmpty: false }) };
  const catalogue = await sync({ now: new Date("2026-09-24T12:00:00Z"), paths: [path], adapters: [adapter], epornerLookup: async () => { throw new Error("Lustpress down"); } });
  assert.equal(catalogue.scenes.length, 1);
  assert.equal(catalogue.studios[0].error, null);
  assert.equal(catalogue.scenes[0].epornerUrl, undefined);
});

test("existing verified links survive refresh and unverified rows show only Source", async () => {
  const [linked] = await enrichEpornerLinks([scene], [{ ...scene, epornerUrl: url }], async () => { throw new Error("should not recheck"); });
  assert.equal(linked.epornerUrl, url);
  assert.match(renderSceneLinks(linked), /Eporner ↗/);
  assert.match(renderSceneLinks(scene), /Source ↗/);
  assert.doesNotMatch(renderSceneLinks(scene), /Eporner ↗/);
  assert.doesNotMatch(renderSceneLinks({ ...scene, epornerUrl: "https://evil.example/" }), /Eporner ↗/);
});
