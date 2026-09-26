import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyGlossary, createTranslator, loadTranslationCache, serializeTranslationCache } from "../src/translate.js";
import { applyCachedTranslation, createTranslationBackfill, translateStoredCatalogue } from "../src/translate-run.js";
import { TITLE_GLOSSARY } from "../src/studios/madouqu.js";

const llmResponse = (translations) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ translations }) } }] }),
});

test("the glossary pass renders known vocabulary and reports residual CJK", () => {
  const full = applyGlossary("人妻肛交内射", TITLE_GLOSSARY);
  assert.equal(full.translated, true);
  assert.equal(full.text, "wife anal sex creampie");
  assert.equal(full.residual, false);
  const partial = applyGlossary("神秘少女肛交", TITLE_GLOSSARY);
  assert.equal(partial.translated, false, "residual CJK means the glossary did not finish the job");
  assert.equal(partial.residual, true);
  assert.ok(partial.text.includes("anal sex"), "the partial rendering is kept as a draft");
});

test("glossary terms are applied longest-first so a compound term is not split", () => {
  const glossary = [{ term: "肛", english: "anus" }, { term: "肛交", english: "anal sex" }];
  assert.equal(applyGlossary("肛交", glossary).text, "anal sex");
});

test("a glossary-complete title never reaches the LLM", async () => {
  let calls = 0;
  const translator = createTranslator({ glossary: TITLE_GLOSSARY, apiKey: "test-key", fetchImpl: async () => { calls += 1; return llmResponse([]); } });
  const [result] = await translator.translate(["人妻肛交内射"]);
  assert.equal(result.provider, "glossary");
  assert.equal(result.translated, true);
  assert.equal(calls, 0, "glossary hits never touch the LLM");
});

test("unresolved titles are batched into ONE call, not one call per title", async () => {
  let calls = 0;
  let inputs = null;
  const titles = ["神秘少女一", "神秘少女二", "神秘少女三"];
  const translator = createTranslator({
    glossary: [],
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      inputs = JSON.parse(JSON.parse(options.body).messages[1].content.split("\n").at(-1));
      return llmResponse(titles.map((original) => ({ original, english: `EN ${original}` })));
    },
  });
  const results = await translator.translate(titles);
  assert.equal(calls, 1);
  assert.deepEqual(inputs, titles);
  assert.ok(results.every(({ provider }) => provider.startsWith("llm:")));
  assert.equal(results[0].title, "EN 神秘少女一");
});

test("a missing key degrades to untranslated: glossary-only, no throw, no LLM call", async () => {
  let calls = 0;
  const translator = createTranslator({ glossary: TITLE_GLOSSARY, apiKey: "", fetchImpl: async () => { calls += 1; return llmResponse([]); } });
  assert.equal(translator.available, false);
  const results = await translator.translate(["人妻肛交", "神秘少女"]);
  assert.deepEqual(results[0], { original: "人妻肛交", title: "wife anal sex", provider: "glossary", translated: true });
  assert.deepEqual(results[1], { original: "神秘少女", title: "神秘少女", provider: "untranslated", translated: false });
  assert.equal(calls, 0, "a missing key must never reach out to the LLM");
});

test("an LLM failure or a malformed response falls back to untranslated, never throwing", async () => {
  const failing = createTranslator({ glossary: [], apiKey: "k", fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal((await failing.translate(["神秘少女"]))[0].provider, "untranslated");
  const malformed = createTranslator({ glossary: [], apiKey: "k", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }) });
  assert.equal((await malformed.translate(["神秘少女"]))[0].provider, "untranslated");
  const offline = createTranslator({ glossary: [], apiKey: "k", fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal((await offline.translate(["神秘少女"]))[0].provider, "untranslated");
});

test("results are cached so a second pass makes no second call", async () => {
  let calls = 0;
  const translator = createTranslator({ glossary: [], apiKey: "k", fetchImpl: async () => { calls += 1; return llmResponse([{ original: "神秘少女", english: "Mystery Girl" }]); } });
  await translator.translate(["神秘少女"]);
  const [again] = await translator.translate(["神秘少女"]);
  assert.equal(calls, 1);
  assert.equal(again.title, "Mystery Girl");
  assert.equal(again.provider.startsWith("llm:"), true);
});

test("the cache serialises to and reloads from a durable file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-translate-"));
  const path = join(directory, "translations.json");
  try {
    await writeFile(path, JSON.stringify({ translations: { "神秘少女": { title: "Mystery Girl", provider: "llm:test", translated: true } } }));
    const cache = await loadTranslationCache(path);
    assert.equal(cache.get("神秘少女").title, "Mystery Girl");
    assert.deepEqual(serializeTranslationCache(cache), { translations: { "神秘少女": { title: "Mystery Girl", provider: "llm:test", translated: true } } });
    assert.equal((await loadTranslationCache(join(directory, "missing.json"))).size, 0);
    await writeFile(path, "not json");
    assert.equal((await loadTranslationCache(path)).size, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a stored catalogue backfill persists the catalogue AND the durable cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-translate-run-"));
  const cataloguePath = join(directory, "catalogue.json");
  const cachePath = join(directory, "translations.json");
  const scenes = [
    { id: "madouqu:1", title: "神秘少女", originalTitle: "神秘少女", titleTranslated: false, translationProvider: "none" },
    { id: "madouqu:2", title: "人妻肛交", originalTitle: "人妻肛交", titleTranslated: false, translationProvider: "none" },
  ];
  await writeFile(cataloguePath, JSON.stringify({ lastChecked: null, studios: [], scenes }));
  try {
    const translator = createTranslator({ glossary: TITLE_GLOSSARY, apiKey: "k", fetchImpl: async (url, options) => {
      const inputs = JSON.parse(JSON.parse(options.body).messages[1].content.split("\n").at(-1));
      return llmResponse(inputs.map((original) => ({ original, english: "Mystery Girl" })));
    } });
    const result = await translateStoredCatalogue(cataloguePath, { cachePath, translator });
    assert.equal(result.translated, 2);
    const stored = JSON.parse(await readFile(cataloguePath, "utf8"));
    assert.equal(stored.scenes[0].title, "Mystery Girl");
    assert.equal(stored.scenes[1].title, "wife anal sex");
    assert.equal(stored.scenes[1].translationProvider, "glossary");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    assert.equal(cache.translations["神秘少女"].title, "Mystery Girl");

    // A cold boot re-applies the committed cache without any LLM call.
    const second = await translateStoredCatalogue(cataloguePath, { cachePath, translator: createTranslator({ glossary: TITLE_GLOSSARY, apiKey: "", cache: await loadTranslationCache(cachePath) }) });
    assert.equal(second.translated, 0, "already-translated scenes are skipped");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("label naming romanises unmapped category names once and leaves them on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-label-name-"));
  const cataloguePath = join(directory, "catalogue.json");
  const cachePath = join(directory, "translations.json");
  const catalogue = {
    lastChecked: null,
    studios: [
      { id: "madouqu-xb", name: "Xingba Media" },
      { id: "madouqu-wy", name: "乌鸦传媒" },
    ],
    scenes: [{ id: "madouqu:1", studioId: "madouqu-wy", studio: "乌鸦传媒", title: "肛交", originalTitle: "肛交" }],
  };
  await writeFile(cataloguePath, JSON.stringify(catalogue));
  try {
    let calls = 0;
    const labelNamer = { nameLabels: async (names) => { calls += 1; return new Map(names.map((name) => [name, "Crow Media"])); } };
    const result = await translateStoredCatalogue(cataloguePath, { cachePath, labelNamer });
    assert.equal(result.named, 1);
    assert.equal(calls, 1);
    const stored = JSON.parse(await readFile(cataloguePath, "utf8"));
    assert.equal(stored.studios.find(({ id }) => id === "madouqu-wy").name, "Crow Media");
    assert.equal(stored.studios.find(({ id }) => id === "madouqu-xb").name, "Xingba Media", "already-romanised labels are untouched");
    assert.equal(stored.scenes[0].studio, "Crow Media", "the renamed label reaches the watchlist rows");

    // A namer that yields nothing (missing key / failure) leaves the original name.
    await writeFile(cataloguePath, JSON.stringify({ ...catalogue, studios: [{ id: "madouqu-wy", name: "乌鸦传媒" }] }));
    const failed = await translateStoredCatalogue(cataloguePath, { cachePath, labelNamer: { nameLabels: async () => new Map() } });
    assert.equal(failed.named, 0);
    assert.equal(JSON.parse(await readFile(cataloguePath, "utf8")).studios[0].name, "乌鸦传媒");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the production backfill loads the durable cache, so a cold boot makes no LLM call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-translate-boot-"));
  const cataloguePath = join(directory, "catalogue.json");
  const cachePath = join(directory, "translations.json");
  await writeFile(cataloguePath, JSON.stringify({
    lastChecked: null, studios: [],
    scenes: [{ id: "madouqu:1", title: "神秘少女", originalTitle: "神秘少女", titleTranslated: false, translationProvider: "none" }],
  }));
  await writeFile(cachePath, JSON.stringify({ translations: { "神秘少女": { title: "Mystery Girl", provider: "llm:cached", translated: true } } }));
  try {
    // No OPENROUTER_API_KEY in this environment: the durable cache alone must apply.
    const result = await createTranslationBackfill({ path: cataloguePath, cachePath })();
    assert.equal(result.translated, 1);
    const stored = JSON.parse(await readFile(cataloguePath, "utf8"));
    assert.equal(stored.scenes[0].title, "Mystery Girl");
    assert.equal(stored.scenes[0].translationProvider, "llm:cached");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("applyCachedTranslation never touches identity and leaves untranslated titles alone", () => {
  const cache = new Map([["神秘少女", { title: "Mystery Girl", provider: "llm:test", translated: true }]]);
  const scene = { id: "madouqu:1", title: "神秘少女", originalTitle: "神秘少女", sourceSceneId: "1" };
  const translated = applyCachedTranslation(scene, cache);
  assert.equal(translated.title, "Mystery Girl");
  assert.equal(translated.id, "madouqu:1");
  assert.equal(translated.originalTitle, "神秘少女");
  assert.equal(translated.translationProvider, "llm:test");
  assert.equal(applyCachedTranslation({ ...scene, originalTitle: "别的" }, cache).title, "神秘少女");
});
