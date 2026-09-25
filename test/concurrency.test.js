import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FETCH_CONCURRENCY, mapWithConcurrency } from "../src/concurrency.js";
import { enrichStoredCatalogue } from "../src/sxyprn.js";
import { createTpdbStudio } from "../src/studios/tpdb.js";

// Prove the default bound regardless of the developer's environment.
delete process.env.LISZT_FETCH_CONCURRENCY;

const BOUND = DEFAULT_FETCH_CONCURRENCY;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function tracker() {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  return {
    state,
    async run(work) {
      state.inFlight += 1;
      state.calls += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        return await work();
      } finally {
        state.inFlight -= 1;
      }
    },
  };
}

test("studio-site enrichment during ingest is concurrency-bounded", async () => {
  const adapter = createTpdbStudio({ id: "example", name: "Example", siteId: 12 });
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: `scene-${index}`,
    title: `Scene ${index}`,
    date: "2026-09-20",
    performers: [{ name: "TPDB Alias", gender: "Female" }],
    url: `https://sexlikereal.com/scenes/${index}`,
  }));
  const studioSite = tracker();
  await adapter.fetchScenes({
    apiKey: "secret",
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "api.theporndb.net") return { ok: true, json: async () => ({ data: records }) };
      return studioSite.run(async () => {
        await pause(10);
        return { ok: true, url: url.href, text: async () => '<script type="application/ld+json">{"@type":"VideoObject","duration":"PT20M"}</script>' };
      });
    },
  });
  assert.equal(studioSite.state.calls, records.length, "every metadata-incomplete record should still be enriched");
  assert.ok(studioSite.state.peak <= BOUND, `expected at most ${BOUND} concurrent studio-site fetches, saw ${studioSite.state.peak}`);
  assert.ok(studioSite.state.peak > 1, `expected studio-site fetches to run concurrently, saw ${studioSite.state.peak}`);
});

test("playback-source checking across the stored catalogue is concurrency-bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-concurrency-playback-"));
  const path = join(directory, "catalogue.json");
  const scenes = Array.from({ length: 24 }, (_, index) => ({
    id: `studio:${index}`,
    sourceSceneId: String(index),
    studioId: "studio",
    studio: "Studio",
    title: `Scene ${index}`,
    releaseDate: "2026-09-23",
    performers: ["Performer One"],
    durationSec: 1800,
    releaseUrl: `https://source.example/${index}`,
  }));
  await writeFile(path, JSON.stringify({ lastChecked: null, studios: [], scenes }));
  const lookups = tracker();
  try {
    await enrichStoredCatalogue(path, {
      days: 14,
      lookup: () => lookups.run(async () => {
        await pause(10);
        return [];
      }),
    });
    assert.equal(lookups.state.calls, scenes.length, "every scene should still be checked");
    assert.ok(lookups.state.peak <= BOUND, `expected at most ${BOUND} concurrent playback lookups, saw ${lookups.state.peak}`);
    assert.ok(lookups.state.peak > 1, `expected playback lookups to run concurrently, saw ${lookups.state.peak}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the in-flight limit is configurable through LISZT_FETCH_CONCURRENCY", async () => {
  const lookups = tracker();
  process.env.LISZT_FETCH_CONCURRENCY = "2";
  try {
    await mapWithConcurrency(Array.from({ length: 12 }), () => lookups.run(async () => { await pause(5); }));
    assert.equal(lookups.state.calls, 12);
    assert.ok(lookups.state.peak <= 2, `expected at most 2 concurrent lookups, saw ${lookups.state.peak}`);
    assert.ok(lookups.state.peak > 1, `expected the override to still run concurrently, saw ${lookups.state.peak}`);
  } finally {
    delete process.env.LISZT_FETCH_CONCURRENCY;
  }
});
