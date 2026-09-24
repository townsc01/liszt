import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSxyprnLookup, enrichSxyprnLinks, enrichStoredCatalogue, searchSlug, validSxyprnUrl } from "../src/sxyprn.js";
import { renderSceneLinks } from "../public/scene-links.js";
import { isSxyprnVideo, topSxyprnUrl } from "../public/scene-video.js";
import { sync } from "../src/sync.js";

const scene = { id: "studio:1", sourceSceneId: "1", studioId: "studio", studio: "Studio", title: "Lana Wills Double Anal Debut", releaseDate: "2026-09-20", performers: ["Lana Wills"], releaseUrl: "https://source.example/1" };
const url = "https://sxyprn.com/post/6ab5422fa84b6.html";
const other = "https://sxyprn.com/post/6aaad4186a540.html";
const candidate = (videoUrl = url, title = scene.title, isExternal = false) => ({ url: videoUrl, title, isExternal });

function client({ videos = [candidate()], detailTitle = scene.title, failSearch = false, failDetails = false } = {}) {
  const calls = [];
  return {
    calls,
    videos: {
      search: async (slug) => { calls.push(["search", slug]); if (failSearch) throw new Error("offline"); return { videos }; },
      details: async ({ url: postUrl }) => { calls.push(["details", postUrl]); if (failDetails) throw new Error("offline"); return { url: postUrl, title: detailTitle, streamUrl: "https://sxyprn.com/cdn8/example", isExternal: videos.find((item) => item.url === postUrl)?.isExternal }; },
    },
  };
}

test("Sxyprn searches use the site's hyphenated form and verify the post", async () => {
  const source = client();
  assert.equal(searchSlug("Lana Wills"), "Lana-Wills");
  assert.deepEqual(await createSxyprnLookup({ client: source })(scene), [url]);
  assert.deepEqual(source.calls[0], ["search", "lana-wills"]);
  assert.deepEqual(source.calls.at(-1), ["details", url]);
});

test("matching prefers the site's native post when duplicate uploads have equal titles", async () => {
  const source = client({ videos: [candidate(other, scene.title, true), candidate(url, scene.title, false)] });
  assert.deepEqual(await createSxyprnLookup({ client: source, maxMatches: 2 })(scene), [url, other]);
});

test("Mambo scene codes recover posts with an alias or missing performer metadata", async () => {
  const coded = { ...scene, id: "mambo-perv:4846367", studioId: "mambo-perv", title: "Riley Rabbit pale skin white Brazilian goth fucked by a big black cock OB632 featuring Negro Top Oficial", performers: [] };
  const postTitle = "Riley Rabbit pale skin white Brazilian goth fucked by a big black cock OB632";
  const source = client({ videos: [candidate(url, postTitle)], detailTitle: postTitle });
  assert.deepEqual(await createSxyprnLookup({ client: source })(coded), [url]);
  assert.deepEqual(source.calls[0], ["search", "riley-rabbit-pale-skin-white"]);
  const wrongCode = client({ videos: [candidate(url, postTitle.replace("OB632", "OB633"))], detailTitle: postTitle.replace("OB632", "OB633") });
  assert.deepEqual(await createSxyprnLookup({ client: wrongCode })(coded), []);
});

test("unrelated, unverified and unsafe hits never become links", async () => {
  assert.deepEqual(await createSxyprnLookup({ client: client({ videos: [candidate(url, "Lana Wills Relaxing Massage Debut")] }) })(scene), []);
  assert.deepEqual(await createSxyprnLookup({ client: client({ videos: [candidate(url, "Double Anal Debut With Another Person")] }) })(scene), []);
  assert.deepEqual(await createSxyprnLookup({ client: client({ videos: [candidate("https://sxyprn.com.evil.example/post/6ab5422fa84b6.html")] }) })(scene), []);
  await assert.rejects(createSxyprnLookup({ client: client({ failSearch: true }) })(scene), /Sxyprn search unavailable/);
  await assert.rejects(createSxyprnLookup({ client: client({ failDetails: true }) })(scene), /Sxyprn post verification unavailable/);
  for (const unsafe of ["javascript:alert(1)", "http://sxyprn.com/post/6ab5422fa84b6.html", "https://sxyprn.com.evil.example/post/6ab5422fa84b6.html", "https://sxyprn.com/search/lana.html", `${url}?x=1`]) {
    assert.equal(validSxyprnUrl(unsafe), false);
    assert.equal(isSxyprnVideo(unsafe), false);
  }
});

test("existing links survive failures and refreshes but old Eporner fields are removed", async () => {
  const checkedAt = "2026-09-23T12:00:00.000Z";
  const prior = { ...scene, sxyprnUrls: [url], sxyprnCheckedAt: checkedAt, epornerUrls: ["https://www.eporner.com/video-ABC/x/"] };
  const [cached] = await enrichSxyprnLinks([scene], [prior], async () => { throw new Error("should not recheck"); }, { now: new Date("2026-09-24T00:00:00Z") });
  assert.deepEqual(cached.sxyprnUrls, [url]);
  assert.equal(cached.sxyprnCheckedAt, checkedAt);
  assert.equal(cached.epornerUrls, undefined);
  const [retained] = await enrichSxyprnLinks([scene], [prior], async () => { throw new Error("offline"); }, { now: new Date("2026-09-25T00:00:00Z") });
  assert.deepEqual(retained.sxyprnUrls, [url]);
  assert.equal(topSxyprnUrl(retained), url);
  assert.match(renderSceneLinks(retained), /Sxyprn ↗/);
  assert.doesNotMatch(renderSceneLinks(retained), /Eporner/);
  assert.match(renderSceneLinks(scene), /Source ↗/);
});

test("the recent window bounds automatic checks while retaining older Sxyprn links", async () => {
  const old = { ...scene, releaseDate: "2026-07-01", sxyprnUrls: [url] };
  let calls = 0;
  const [recent, older] = await enrichSxyprnLinks([scene, old], [old], async () => { calls++; return [url]; }, { now: new Date("2026-09-24T12:00:00Z") });
  assert.equal(calls, 1);
  assert.deepEqual(recent.sxyprnUrls, [url]);
  assert.deepEqual(older.sxyprnUrls, [url]);
});

test("a stable source URL carries a verified link across source ID changes", async () => {
  const prior = { ...scene, id: "studio:old", sxyprnUrls: [url] };
  const current = { ...scene, id: "studio:new", title: scene.title.toUpperCase() };
  const [updated] = await enrichSxyprnLinks([current], [prior], null);
  assert.deepEqual(updated.sxyprnUrls, [url]);
  const [changed] = await enrichSxyprnLinks([{ ...current, title: "A different scene" }], [prior], null);
  assert.equal(changed.sxyprnUrls, undefined);
});

test("the user-confirmed Naty Heat scene retains both Sxyprn uploads", async () => {
  const naty = { ...scene, id: "lancelot-styles-evolution:4683299", title: "Newcomer Naty Heat debuts with her first anal scene", performers: ["Naty Heat"] };
  const [linked] = await enrichSxyprnLinks([naty], [], async () => { throw new Error("override should bypass search"); });
  assert.deepEqual(linked.sxyprnUrls, [
    "https://sxyprn.com/post/6ab3e3c4edbd5.html",
    "https://sxyprn.com/post/6ab46356de33e.html",
  ]);
  assert.match(renderSceneLinks(linked), /Sxyprn 1 ↗/);
  assert.match(renderSceneLinks(linked), /Sxyprn 2 ↗/);
});

test("studio sync remains available when Sxyprn is not available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-sxyprn-sync-"));
  const path = join(directory, "catalogue.json");
  const adapter = { id: "studio", name: "Studio", authority: { name: "Test", url: "https://source.example" }, fetchScenes: async () => ({ scenes: [{ ...scene, id: undefined }], verifiedEmpty: false }) };
  try {
    await writeFile(path, JSON.stringify({ scenes: [{ ...scene, sxyprnUrls: [url], epornerUrls: ["https://www.eporner.com/video-ABC/x/"] }], studios: [] }));
    const result = await sync({ now: new Date("2026-09-24T12:00:00Z"), paths: [path], adapters: [adapter] });
    assert.deepEqual(result.scenes[0].sxyprnUrls, [url]);
    assert.equal(result.scenes[0].epornerUrls, undefined);
    await enrichStoredCatalogue(path, { lookup: async () => { throw new Error("offline"); } });
    assert.deepEqual(result.scenes[0].sxyprnUrls, [url]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
