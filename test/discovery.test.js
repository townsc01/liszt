import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load } from "cheerio";
import { discoverStudio, validateStudioUrl } from "../src/discovery.js";
import { addStudio, readStudios } from "../src/studio-store.js";

const publicDns = async () => ["203.0.113.10"];
const fixture = await readFile(new URL("../fixtures/generic-studio/home.html", import.meta.url), "utf8");
const crawlerFactory = (handler) => ({ run: async ([request]) => handler({ request: { ...request, loadedUrl: request.url, depth: 0 }, $: load(fixture), enqueueLinks: async () => {} }) });

test("generic discovery extracts dated scenes and provenance inputs from JSON-LD", async () => {
  const result = await discoverStudio("https://northstar.example", { resolve: publicDns, crawlerFactory, now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(result.name, "Northstar Films");
  assert.equal(result.supported, true);
  assert.deepEqual(result.scenes.map(({ title, releaseDate, performers }) => ({ title, releaseDate, performers })), [{ title: "Aurora", releaseDate: "2026-09-20", performers: ["Ada North"] }]);
  assert.match(result.scenes[0].sourceSceneId, /^[a-f0-9]{20}$/);
});

test("unsupported sites say exactly which evidence is missing", async () => {
  const emptyCrawler = (handler) => ({ run: async ([request]) => handler({ request: { ...request, loadedUrl: request.url, depth: 0 }, $: load("<title>Empty Studio</title>"), enqueueLinks: async () => {} }) });
  const result = await discoverStudio("https://empty.example", { resolve: publicDns, crawlerFactory: emptyCrawler });
  assert.equal(result.supported, false);
  assert.deepEqual(result.missing, ["structured VideoObject, Movie, or Episode records", "machine-readable publication dates", "stable canonical scene URLs"]);
});

test("URL validation blocks local targets and unsafe ports", async () => {
  await assert.rejects(validateStudioUrl("http://127.0.0.1"), /Private or local/);
  await assert.rejects(validateStudioUrl("https://example.com:8080", { resolve: publicDns }), /standard web ports/);
});

test("studio persistence deduplicates equivalent homepages", async () => {
  const path = join(tmpdir(), `liszt-studios-${process.pid}.json`);
  const preview = { name: "Northstar Films", homepageUrl: "https://northstar.example/" };
  const first = await addStudio(path, preview);
  const second = await addStudio(path, { ...preview, homepageUrl: "https://northstar.example/about" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal((await readStudios(path)).length, 1);
});
