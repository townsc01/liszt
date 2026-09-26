import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANAL_TERMS, LABEL_DISPLAY, TITLE_GLOSSARY, classifyTitle, createJsonFetcher, fetchMadouquScenes,
  mapCategories, parsePost, studio, walkSearch,
} from "../src/studios/madouqu.js";
import { validateResult } from "../src/catalogue.js";
import { studios } from "../src/studios/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readFixture = (name) => readFile(new URL(`../fixtures/madouqu/${name}`, import.meta.url), "utf8").then(JSON.parse);

async function seedRows() {
  const text = (await readFile(new URL("../data/seeds/madouqu-anal-2026-09-24.csv", import.meta.url), "utf8")).replace(/^\uFEFF/, "");
  const [header, ...lines] = text.split("\n").filter(Boolean);
  const columns = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])));
}

// A fake WordPress response: each entry is [url, body, headers]. Requests are recorded.
function fakeFetch(routes) {
  const requests = [];
  const impl = async (url) => {
    const href = String(url);
    requests.push(href);
    for (const [match, body, headers = {}] of routes) {
      if (href.includes(match)) {
        return { ok: true, status: 200, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  impl.requests = requests;
  return impl;
}

test("the anal gate covers the seven spec terms plus the compound family the seed matched", async () => {
  const rows = await seedRows();
  const kept = rows.filter(({ content_type }) => content_type === "anal sex");
  assert.equal(kept.length, 151);
  // Every kept seed row carries a gate term recorded in matched_terms; the title classifier
  // must reach the same verdict from the title alone.
  for (const row of rows) {
    const verdict = classifyTitle(row.title);
    if (row.content_type === "anal sex") assert.equal(verdict.content, "anal sex", `${row.post_id} ${row.title}`);
    else assert.equal(verdict.content, "anal play", `${row.post_id} ${row.title}`);
  }
  assert.deepEqual(ANAL_TERMS, ["肛交", "后庭", "屁眼", "肛门", "三通", "爆菊", "爆肛"]);
});

test("the classifier reproduces the seed's exact 151/12 split", async () => {
  const rows = await seedRows();
  const counts = rows.reduce((acc, row) => {
    const verdict = classifyTitle(row.title);
    acc[verdict.content] = (acc[verdict.content] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { "anal sex": 151, "anal play": 12 });
  const playOnly = rows.filter(({ content_type }) => content_type !== "anal sex").map(({ post_id }) => post_id).sort();
  const classifiedPlay = rows.filter(({ title }) => classifyTitle(title).content === "anal play").map(({ post_id }) => post_id).sort();
  assert.deepEqual(classifiedPlay, playOnly, "exactly the 12 play-only rows are dropped and no kept row");
});

test("the documented borderline keeps stay kept while pure play terms drop", () => {
  assert.equal(classifyTitle("母狗三通后的捆绑肛塞玩具震逼调教").content, "anal sex", "三通 beats the plug (68418)");
  assert.equal(classifyTitle("肛塞调教大一蜜臀母狗羞耻屁眼跪着吞吐肉棒").content, "anal sex", "penetration verb beats the plug (64342)");
  assert.equal(classifyTitle("肛钩调教屁眼链接头发汉服抽逼").content, "anal play");
  assert.equal(classifyTitle("巨乳御姐淫语挑逗裸舞幻龙自慰钢球塞屁眼").content, "anal play");
});

test("safety and trans lexicons hard-block on titles", () => {
  assert.equal(classifyTitle("萝莉肛交").content, "excluded");
  assert.equal(classifyTitle("迷奸后庭").reason, "safety");
  assert.equal(classifyTitle("偷拍肛门").content, "excluded");
  assert.equal(classifyTitle("伪娘三通").reason, "trans");
  assert.equal(classifyTitle("ladyboy anal 肛交").reason, "trans");
  // Genre convention vocabulary stays.
  assert.equal(classifyTitle("人妻调教肛交").content, "anal sex");
});

test("a content-only term mention is rejected: the title is the gate, not the search hit", () => {
  const post = { id: 1, date_gmt: "2026-09-20T00:00:00", slug: "tx1", link: "https://madouqu.com/video/tx1/", title: { rendered: "温柔人妻的日常" }, content: { rendered: "肛交 三通 后庭" }, categories: [720], featured_media: 0, jetpack_featured_media_url: "" };
  assert.equal(classifyTitle(post.title.rendered).content, "excluded");
});

test("the REST walk stops on a short page, the last page, or a page of known ids", async () => {
  const full = (start) => Array.from({ length: 100 }, (_, index) => ({ id: start + index }));
  const pages = [];
  const fetchJson = async (href) => {
    pages.push(new URL(href).searchParams.get("page"));
    if (pages.length === 1) return { json: full(1), headers: { get: () => "3" } };
    return { json: full(101).slice(0, 40), headers: { get: () => "3" } };
  };
  const posts = await walkSearch("肛交", { fetchJson });
  assert.equal(posts.length, 140);
  assert.deepEqual(pages, ["1", "2"]);

  const seenPages = [];
  const seenFetch = async (href) => {
    seenPages.push(new URL(href).searchParams.get("page"));
    return { json: full(1), headers: { get: () => "5" } };
  };
  await walkSearch("肛交", { fetchJson: seenFetch, isSeen: () => true, maxPages: 5 });
  assert.deepEqual(seenPages, ["1"], "a full page of known ids stops the walk");

  const lastPage = [];
  const lastFetch = async (href) => {
    lastPage.push(new URL(href).searchParams.get("page"));
    return { json: full(1), headers: { get: () => "1" } };
  };
  await walkSearch("肛交", { fetchJson: lastFetch, maxPages: 5 });
  assert.deepEqual(lastPage, ["1"], "X-WP-TotalPages bounds the walk");
});

test("the fetcher paces requests and retries a 429", async () => {
  let calls = 0;
  const waits = [];
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { status: 429, ok: false, headers: { get: () => "0" } };
    return { status: 200, ok: true, headers: { get: () => "1" }, json: async () => [] };
  };
  const fetchJson = createJsonFetcher({ fetchImpl, delayMs: 0, maxRetries: 2, onRequest: () => waits.push(Date.now()) });
  const { json } = await fetchJson("https://madouqu.com/wp-json/wp/v2/posts?search=x");
  assert.deepEqual(json, []);
  assert.equal(calls, 2, "a 429 is retried");
});

test("categories map to per-label studios and unknown ids are logged, never guessed", async () => {
  const categories = await readFixture("categories.json");
  const logged = [];
  const byId = mapCategories(categories, { onLog: (line) => logged.push(line) });
  assert.equal(byId.get(779).slug, "xb");
  assert.equal(byId.get(779).display, "Xingba Media");
  assert.equal(byId.get(2).display, "Madou Media", "麻豆传媒 maps live, so the namesake label is not flattened");
  const unknown = mapCategories([{ id: 9999, slug: "new-label", name: "新传媒" }], { onLog: (line) => logged.push(line) });
  assert.equal(unknown.get(9999).display, "新传媒");
  assert.equal(unknown.get(9999).unmapped, true);
  assert.match(logged.at(-1), /unmapped category 9999/);
  // Every label in the seed has a romanisation entry.
  for (const label of ["杏吧传媒", "糖心VLOG", "麻豆传媒", "草莓视频", "JVID", "精东影业", "大象传媒"]) {
    assert.ok(Object.values(LABEL_DISPLAY).length, "table present");
    assert.ok(categories.some((category) => category.name === label), `${label} is a live category`);
  }
});

test("a post becomes a scene with per-label studio identity, release code and provenance", async () => {
  const categories = mapCategories(await readFixture("categories.json"));
  const [post] = await readFixture("posts-search-anal.json");
  const scene = parsePost(post, { categories });
  assert.equal(scene.sourceSceneId, "90386");
  assert.equal(scene.studioId, "madouqu-xb");
  assert.equal(scene.studio, "Xingba Media");
  assert.equal(scene.studioCode, "xb6340");
  assert.equal(scene.releaseDate, "2026-09-22");
  assert.equal(scene.title, scene.originalTitle, "sync serves the original title; translation backfills");
  assert.equal(scene.titleTranslated, false);
  assert.deepEqual(scene.performers, []);
  assert.deepEqual(scene.tags, ["anal"]);
  assert.equal(scene.provenance.categoryId, "xb");
  assert.equal(scene.provenance.dateGmt, post.date_gmt);
  const validated = validateResult(studio, { scenes: [scene], verifiedEmpty: false })[0];
  assert.equal(validated.id, "madouqu:90386");
  assert.equal(validated.studioId, "madouqu-xb", "the lane's per-label studio survives validation");
  assert.equal(validated.videoMatching, false, "the lane declares NO matcher");
});

test("the five existing adapters keep the adapter default identity", () => {
  const scene = { sourceSceneId: "1", title: "Scene", releaseDate: "2026-09-20" };
  const adapter = { id: "tushy", name: "Tushy" };
  const [validated] = validateResult(adapter, { scenes: [scene], verifiedEmpty: false });
  assert.equal(validated.studioId, "tushy");
  assert.equal(validated.studio, "Tushy");
  assert.equal(validated.videoMatching, undefined, "only a lane with matcher:null carries the flag");
});

test("the lane registers with the sync as a no-matcher metadata lane", () => {
  assert.equal(studio.id, "madouqu");
  assert.equal(studio.matcher, null);
  assert.equal(studio.windowDays, 90);
  assert.equal(studio.authority.name, "madouqu.com");
  assert.equal(studios.find(({ id }) => id === "madouqu"), studio);
});

test("the full sync fetch unions the seven searches, filters by title and window, and never throws on content hits", async () => {
  const posts = await readFixture("posts-search-anal.json");
  const categories = await readFixture("categories.json");
  const fetchImpl = fakeFetch([
    ["wp/v2/categories", categories],
    ["wp/v2/posts", posts, { "x-wp-totalpages": "1" }],
  ]);
  const result = await fetchMadouquScenes({ now: new Date("2026-09-23T00:00:00Z"), days: 90, fetchImpl, delayMs: 0, resolveThumbnails: false });
  assert.equal(result.scenes.length, 5);
  assert.equal(result.verifiedEmpty, false);
  assert.ok(result.scenes.every((scene) => scene.studioId === "madouqu-xb"));
  // The same five posts come back for every search term; the union must not duplicate them.
  assert.equal(new Set(result.scenes.map((scene) => scene.sourceSceneId)).size, 5);
});

test("a search failure throws so the sync retains the lane's last-good scenes", async () => {
  const fetchImpl = async (url) => String(url).includes("categories")
    ? { ok: true, status: 200, headers: { get: () => "1" }, json: async () => [] }
    : { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) };
  await assert.rejects(fetchMadouquScenes({ fetchImpl, delayMs: 0 }), /HTTP 503/);
});

test("the glossary covers the spec's heavy genre vocabulary", () => {
  const terms = new Set(TITLE_GLOSSARY.map(({ term }) => term));
  for (const term of ["人妻", "极品", "调教", "淫荡", "母狗", "白丝", "黑丝", "空姐", "约炮", "内射", "吞精", "喷水", "群交", "4P", "3P", "爆菊", "三通"]) {
    assert.ok(terms.has(term), `${term} is in the glossary`);
  }
});

test("sync never fires western tube matching at the madouqu lane", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-madouqu-sync-"));
  const path = join(directory, "catalogue.json");
  const looked = [];
  const { sync } = await import("../src/sync.js");
  const { enrichSxyprnLinks } = await import("../src/sxyprn.js");
  const adapter = {
    ...studio,
    fetchScenes: async () => ({ scenes: [{
      sourceSceneId: "90386", title: "淫荡人妻王肛交", originalTitle: "淫荡人妻王肛交",
      releaseDate: "2026-09-22", studioId: "madouqu-xb", studio: "Xingba Media", durationSec: 1800,
    }], verifiedEmpty: false }),
  };
  try {
    const result = await sync({ now: new Date("2026-09-23T00:00:00Z"), paths: [path], adapters: [adapter] });
    const scene = result.scenes.find((item) => item.id === "madouqu:90386");
    assert.equal(scene.videoMatching, false);
    assert.equal(scene.videoUrls, undefined, "a no-matcher lane carries no tube links");
    // The lookup is the tube matcher: a no-matcher lane must never reach it.
    await enrichSxyprnLinks(result.scenes, result.scenes, async (item) => { looked.push(item.id); return []; }, { now: new Date("2026-09-23T00:00:00Z") });
    assert.deepEqual(looked, [], "no western tube matching fired at the madouqu lane");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync publishes per-label studios so the watchlist can filter by real label", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-madouqu-labels-"));
  const path = join(directory, "catalogue.json");
  const { sync } = await import("../src/sync.js");
  const adapter = {
    ...studio,
    fetchScenes: async () => ({ scenes: [
      { sourceSceneId: "1", title: "淫荡人妻肛交", originalTitle: "淫荡人妻肛交", releaseDate: "2026-09-22", studioId: "madouqu-xb", studio: "Xingba Media" },
      { sourceSceneId: "2", title: "肛交内射", originalTitle: "肛交内射", releaseDate: "2026-09-21", studioId: "madouqu-tx", studio: "Tangxin VLOG" },
    ], verifiedEmpty: false }),
  };
  try {
    const result = await sync({ now: new Date("2026-09-23T00:00:00Z"), paths: [path], adapters: [adapter] });
    const ids = result.studios.map(({ id }) => id);
    assert.ok(ids.includes("madouqu"), "the adapter status remains");
    assert.ok(ids.includes("madouqu-xb") && ids.includes("madouqu-tx"), "one status per label");
    assert.equal(result.studios.find(({ id }) => id === "madouqu-xb").name, "Xingba Media");
    // The UI counts scenes by status id, so each label's option shows its own count.
    assert.equal(result.scenes.filter(({ studioId }) => studioId === "madouqu-xb").length, 1);

    // A background LLM label rename is durable: the next sync must not overwrite it.
    const renamed = { ...result, studios: result.studios.map((status) => status.id === "madouqu-xb" ? { ...status, name: "Crow Media" } : status), scenes: result.scenes.map((scene) => scene.studioId === "madouqu-xb" ? { ...scene, studio: "Crow Media" } : scene) };
    await writeFile(path, JSON.stringify(renamed));
    const second = await sync({ now: new Date("2026-09-24T00:00:00Z"), paths: [path], adapters: [adapter] });
    assert.equal(second.studios.find(({ id }) => id === "madouqu-xb").name, "Crow Media", "the durable label rename survives the next sync");
    assert.equal(second.scenes.find(({ studioId }) => studioId === "madouqu-xb").studio, "Crow Media", "and reaches the row");

    // A background translation is durable too: the next sync must not discard it.
    const translated = { ...second, scenes: second.scenes.map((scene) => scene.id === "madouqu:1" ? { ...scene, title: "Wife anal sex", titleTranslated: true, translationProvider: "glossary" } : scene) };
    await writeFile(path, JSON.stringify(translated));
    const third = await sync({ now: new Date("2026-09-25T00:00:00Z"), paths: [path], adapters: [adapter] });
    assert.equal(third.scenes.find(({ id }) => id === "madouqu:1").title, "Wife anal sex", "the durable translation survives the next sync");
    assert.equal(third.scenes.find(({ id }) => id === "madouqu:1").originalTitle, "淫荡人妻肛交", "the canonical original is preserved");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync preserves a no-matcher lane's per-label studios through a failed refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-madouqu-retain-"));
  const path = join(directory, "catalogue.json");
  const { sync } = await import("../src/sync.js");
  const prior = {
    id: "madouqu:90386", sourceSceneId: "90386", title: "淫荡人妻王肛交", originalTitle: "淫荡人妻王肛交",
    releaseDate: "2026-09-22", studioId: "madouqu-xb", studio: "Xingba Media", videoMatching: false,
  };
  await writeFile(path, JSON.stringify({ lastChecked: "2026-09-22T00:00:00Z", studios: [{ id: "madouqu", name: "Madouqu (mainland/Taiwan)", lastSuccessfulRefresh: "2026-09-22T00:00:00Z" }], scenes: [prior] }));
  try {
    const result = await sync({ now: new Date("2026-09-23T00:00:00Z"), paths: [path], adapters: [{ ...studio, fetchScenes: async () => { throw new Error("madouqu down"); } }] });
    assert.equal(result.scenes.length, 1, "last-good scenes are retained inside the window");
    assert.equal(result.scenes[0].studioId, "madouqu-xb", "the per-label identity survives retention");
    assert.equal(result.studios[0].error, "madouqu down");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
