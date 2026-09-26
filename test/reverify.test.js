import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FETCH_CONCURRENCY } from "../src/concurrency.js";
import { enrichSxyprnLinks, enrichStoredCatalogue } from "../src/sxyprn.js";
import { createCatalogueEnricher } from "../src/server.js";
import { REVERIFY_SLICE_SIZE, REVERIFY_STRIKE_LIMIT, VERIFY_TIMEOUT_MS, createLinkVerifier, reverifyLinks, reverifyStoredCatalogue, selectReverifySlice } from "../src/reverify.js";

// Prove the default bound regardless of the developer's environment.
delete process.env.LISZT_FETCH_CONCURRENCY;
const BOUND = DEFAULT_FETCH_CONCURRENCY;

const VERIFIED_AT = "2026-09-20T00:00:00.000Z";
const sxyprn = (id, extra = {}) => ({ source: "sxyprn", url: `https://sxyprn.com/post/${id}.html`, embedUrl: null, verifiedAt: VERIFIED_AT, ...extra });
const eporner = (id, extra = {}) => ({ source: "eporner", url: `https://www.eporner.com/video-${id}/example/`, embedUrl: `https://www.eporner.com/embed/${id}/`, verifiedAt: VERIFIED_AT, ...extra });
const hex = (index) => index.toString(16).padStart(13, "0");
const scene = (id, links = [], extra = {}) => ({ id, sourceSceneId: id, studioId: "studio", studio: "Studio",
  title: `Scene ${id}`, releaseDate: "2026-09-20", performers: ["Performer One"], durationSec: 1800,
  releaseUrl: `https://source.example/${id}`, ...(links.length ? { videoUrls: links } : {}), ...extra });

test("one definitive failure keeps the link live and records a single strike", async () => {
  const link = sxyprn(hex(1));
  const [updated] = await reverifyLinks([scene("a", [link])], {
    verify: async () => ({ status: "dead", reason: "sxyprn watch page returned HTTP 404" }),
    now: new Date("2026-09-26T00:00:00Z"),
  });
  assert.equal(updated.videoUrls.length, 1, "a first strike does not move the link");
  assert.equal(updated.videoUrls[0].url, link.url);
  assert.equal(updated.videoUrls[0].verifyFailures, 1);
  assert.equal(updated.videoUrls[0].verifiedAt, VERIFIED_AT, "the strike leaves verifiedAt stale so the next sync re-checks it");
  assert.equal(updated.deadVideoUrls, undefined, "no dead array until the link actually dies");
});

test("a second consecutive definitive failure moves the link to deadVideoUrls", async () => {
  const struck = sxyprn(hex(2), { verifyFailures: 1 });
  const [updated] = await reverifyLinks([scene("a", [struck], { videoCheckedAt: "2026-09-25T00:00:00.000Z" })], {
    verify: async () => ({ status: "dead", reason: "sxyprn watch page returned HTTP 410" }),
    now: new Date("2026-09-27T00:00:00Z"),
  });
  assert.equal(updated.videoUrls, undefined, "videoUrls stays live-links-only");
  assert.deepEqual(updated.deadVideoUrls, [{
    source: "sxyprn",
    url: struck.url,
    embedUrl: null,
    verifiedAt: VERIFIED_AT,
    deadAt: "2026-09-27T00:00:00.000Z",
    deadReason: "sxyprn watch page returned HTTP 410",
  }]);
  assert.equal(updated.videoCheckedAt, undefined, "the scene's last live link died, so it re-enters resolution");
});

test("strikes accumulate across syncs while a sibling link keeps the scene checked", async () => {
  const dying = sxyprn(hex(3), { verifyFailures: 1 });
  const healthy = eporner("ABC123");
  const [updated] = await reverifyLinks([scene("a", [dying, healthy], { videoCheckedAt: "2026-09-25T00:00:00.000Z" })], {
    verify: async (link) => link.source === "sxyprn"
      ? { status: "dead", reason: "sxyprn watch page returned HTTP 404" }
      : { status: "inconclusive", reason: "eporner lookup returned HTTP 503" },
    now: new Date("2026-09-27T00:00:00Z"),
  });
  assert.deepEqual(updated.videoUrls.map((link) => link.source), ["eporner"], "only the dead link leaves the live list");
  assert.equal(updated.deadVideoUrls.length, 1);
  assert.equal(updated.videoCheckedAt, "2026-09-25T00:00:00.000Z", "a remaining live link keeps the scene's check time");
});

test("an inconclusive outcome leaves the link untouched and does not strike", async () => {
  const link = sxyprn(hex(4));
  const [updated] = await reverifyLinks([scene("a", [link])], {
    verify: async () => ({ status: "inconclusive", reason: "sxyprn watch page returned HTTP 403" }),
    now: new Date("2026-09-26T00:00:00Z"),
  });
  assert.deepEqual(updated.videoUrls, [link], "403 / 5xx / timeouts are anti-bot walls, not death");
  assert.equal(updated.deadVideoUrls, undefined);
});

test("a successful verify resets the strike count and refreshes verifiedAt", async () => {
  const struck = sxyprn(hex(5), { verifyFailures: 1 });
  const [updated] = await reverifyLinks([scene("a", [struck])], {
    verify: async () => ({ status: "live" }),
    now: new Date("2026-09-26T00:00:00Z"),
  });
  assert.equal(updated.videoUrls[0].verifyFailures, undefined, "a live verify clears the strikes");
  assert.equal(updated.videoUrls[0].verifiedAt, "2026-09-26T00:00:00.000Z", "and refreshes the verification time");
});

test("a thrown verifier is inconclusive, never a strike", async () => {
  const link = sxyprn(hex(6));
  const [updated] = await reverifyLinks([scene("a", [link])], {
    verify: async () => { throw new Error("network down"); },
    now: new Date("2026-09-26T00:00:00Z"),
  });
  assert.deepEqual(updated.videoUrls, [link]);
  assert.equal(updated.deadVideoUrls, undefined);
});

test("rotation selects the 25 stalest links across the whole catalogue, stalest first", () => {
  const links = Array.from({ length: 30 }, (_, index) => sxyprn(hex(index),
    { verifiedAt: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString() }));
  const scenes = links.map((link, index) => scene(`s${index}`, [link]));
  const slice = selectReverifySlice(scenes);
  assert.equal(REVERIFY_SLICE_SIZE, 25);
  assert.equal(slice.length, 25);
  assert.deepEqual(slice.map(({ link }) => link.url), links.slice(0, 25).map(({ url }) => url));
  const times = slice.map(({ link }) => Date.parse(link.verifiedAt));
  assert.deepEqual(times, [...times].sort((left, right) => left - right), "the slice is ordered stalest first");
  assert.ok(!slice.some(({ link }) => link.url === links[29].url), "the freshest links wait for a later sync");
});

test("a link with no recorded verifiedAt is treated as the stalest", () => {
  const undated = { source: "sxyprn", url: "https://sxyprn.com/post/0000000000001.html", embedUrl: null };
  const dated = sxyprn(hex(9), { verifiedAt: "2020-01-01T00:00:00.000Z" });
  const slice = selectReverifySlice([scene("a", [dated]), scene("b", [undated])]);
  assert.deepEqual(slice.map(({ link }) => link.url), [undated.url, dated.url]);
});

test("legacy sxyprnUrls and unsupported sources are never re-verified", async () => {
  const legacy = scene("a", [], { sxyprnUrls: ["https://sxyprn.com/post/6ab5422fa84b6.html"] });
  const unsupported = scene("b", [{ source: "xvideos", url: "https://www.xvideos.com/video123", embedUrl: null, verifiedAt: VERIFIED_AT }]);
  assert.deepEqual(selectReverifySlice([legacy, unsupported]), []);
  let calls = 0;
  const scenes = [legacy, unsupported];
  const result = await reverifyLinks(scenes, { verify: async () => { calls++; return { status: "live" }; } });
  assert.equal(calls, 0);
  assert.equal(result, scenes, "nothing to do means no rewrite");
});

test("re-verify runs through the shared bounded fetch pool", async () => {
  const scenes = Array.from({ length: 25 }, (_, index) => scene(`s${index}`, [sxyprn(hex(index))]));
  const state = { inFlight: 0, peak: 0, calls: 0 };
  await reverifyLinks(scenes, {
    verify: async () => {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: "inconclusive" };
      } finally {
        state.inFlight -= 1;
      }
    },
  });
  assert.equal(state.calls, 25, "the whole slice is checked");
  assert.ok(state.peak <= BOUND, `expected at most ${BOUND} concurrent verifications, saw ${state.peak}`);
  assert.ok(state.peak > 1, `expected verifications to run concurrently, saw ${state.peak}`);
});

test("the sxyprn verifier treats 404/410 as dead and everything else as inconclusive", async () => {
  const verify = createLinkVerifier({ fetchImpl: async () => ({ status: 404, ok: false }) });
  assert.equal((await verify(sxyprn(hex(1)))).status, "dead");
  const gone = createLinkVerifier({ fetchImpl: async () => ({ status: 410, ok: false }) });
  assert.equal((await gone(sxyprn(hex(1)))).status, "dead");
  const live = createLinkVerifier({ fetchImpl: async () => ({ status: 200, ok: true }) });
  assert.equal((await live(sxyprn(hex(1)))).status, "live");
  for (const status of [403, 429, 500, 503]) {
    const walled = createLinkVerifier({ fetchImpl: async () => ({ status, ok: false }) });
    assert.equal((await walled(sxyprn(hex(1)))).status, "inconclusive", `HTTP ${status} is an anti-bot wall`);
  }
  const offline = createLinkVerifier({ fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal((await offline(sxyprn(hex(1)))).status, "inconclusive");
});

test("the eporner verifier treats an empty video/id result as dead and a record as live", async () => {
  const notFound = createLinkVerifier({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => [] }) });
  assert.equal((await notFound(eporner("ABC123"))).status, "dead");
  const found = createLinkVerifier({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ id: "ABC123", url: "https://www.eporner.com/video-ABC123/example/" }) }) });
  assert.equal((await found(eporner("ABC123"))).status, "live");
  const walled = createLinkVerifier({ fetchImpl: async () => ({ status: 503, ok: false }) });
  assert.equal((await walled(eporner("ABC123"))).status, "inconclusive");
  const offline = createLinkVerifier({ fetchImpl: async () => { throw new Error("ETIMEDOUT"); } });
  assert.equal((await offline(eporner("ABC123"))).status, "inconclusive");
  const unreadable = createLinkVerifier({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new Error("bad json"); } }) });
  assert.equal((await unreadable(eporner("ABC123"))).status, "inconclusive");
});

test("a scene whose last live link dies re-enters normal resolution on the next pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-reverify-resolve-"));
  const path = join(directory, "catalogue.json");
  const stored = scene("a", [sxyprn(hex(7), { verifyFailures: 1 })], { videoCheckedAt: "2026-09-25T00:00:00.000Z" });
  try {
    await writeFile(path, JSON.stringify({ lastChecked: null, studios: [], scenes: [stored] }));
    const result = await reverifyStoredCatalogue(path, {
      verify: async () => ({ status: "dead", reason: "sxyprn watch page returned HTTP 404" }),
      now: new Date("2026-09-26T00:00:00Z"),
    });
    assert.equal(result.scenes[0].videoUrls, undefined);
    assert.equal(result.scenes[0].deadVideoUrls.length, 1);
    assert.equal(result.scenes[0].videoCheckedAt, undefined, "cleared so the scene is resolved again");
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.scenes[0].deadVideoUrls[0].deadAt, "2026-09-26T00:00:00.000Z");
    assert.equal(persisted.scenes[0].videoCheckedAt, undefined);

    let lookups = 0;
    await enrichStoredCatalogue(path, { now: new Date("2026-09-26T01:00:00Z"), lookup: async () => { lookups += 1; return []; } });
    assert.equal(lookups, 1, "the dead scene is resolved again instead of trusting the stale check time");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("re-verify writes only when a link actually changed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-reverify-noop-"));
  const path = join(directory, "catalogue.json");
  try {
    await writeFile(path, JSON.stringify({ lastChecked: null, studios: [], scenes: [scene("a", [sxyprn(hex(8))])] }));
    const untouched = await reverifyStoredCatalogue(path, { verify: async () => ({ status: "inconclusive" }) });
    assert.equal(untouched, null, "an inconclusive sweep is not a change");
    const struck = await reverifyStoredCatalogue(path, { verify: async () => ({ status: "dead", reason: "sxyprn watch page returned HTTP 404" }), now: new Date("2026-09-26T00:00:00Z") });
    assert.equal(struck.scenes[0].videoUrls[0].verifyFailures, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the production enrichment pass re-verifies before matching and hides a dead link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liszt-enricher-"));
  const path = join(directory, "catalogue.json");
  const dying = sxyprn(hex(11), { verifyFailures: 1 });
  const healthy = eporner("ABC123");
  try {
    await writeFile(path, JSON.stringify({ lastChecked: null, studios: [], scenes: [scene("a", [dying, healthy], { videoCheckedAt: "2026-09-25T00:00:00.000Z" })] }));
    const enricher = createCatalogueEnricher({
      path,
      verifyLink: async (link) => link.source === "sxyprn"
        ? { status: "dead", reason: "sxyprn watch page returned HTTP 404" }
        : { status: "live" },
      fallbackLookup: async () => null,
      onProgress: () => {},
    });
    await enricher({ lookup: async () => [], now: new Date("2026-09-26T00:00:00Z") });
    const persisted = JSON.parse(await readFile(path, "utf8"));
    const [stored] = persisted.scenes;
    assert.deepEqual(stored.videoUrls.map((link) => link.source), ["eporner"], "the dead sxyprn link is gone from the live list");
    assert.equal(stored.deadVideoUrls.length, 1);
    assert.equal(stored.deadVideoUrls[0].deadReason, "sxyprn watch page returned HTTP 404");
    assert.equal(stored.deadVideoUrls[0].deadAt, "2026-09-26T00:00:00.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dead-link history survives the next sync rebuilding the scene from its adapter", async () => {
  const dead = { source: "sxyprn", url: sxyprn(hex(12)).url, embedUrl: null, verifiedAt: VERIFIED_AT,
    deadAt: "2026-09-26T00:00:00.000Z", deadReason: "sxyprn watch page returned HTTP 404" };
  const prior = scene("studio:1", [], { deadVideoUrls: [dead] });
  // A source refresh returns the adapter's own record, which knows nothing about deadVideoUrls.
  const fresh = scene("studio:1");
  const [rebuilt] = await enrichSxyprnLinks([fresh], [prior], null);
  assert.deepEqual(rebuilt.deadVideoUrls, [dead], "history is additive state the adapter cannot supply");
  const [withLookup] = await enrichSxyprnLinks([fresh], [prior], async () => [], { now: new Date("2026-09-26T00:00:00Z") });
  assert.deepEqual(withLookup.deadVideoUrls, [dead], "and survives a fresh resolution pass too");
});

// A stalled socket is a pending handle that keeps the event loop alive, which is also what lets
// the unref'd AbortSignal.timeout timer fire. Model that, and add a watchdog so a missing
// timeout fails fast instead of hanging the suite.
function stalledFetch() {
  return (url, { signal } = {}) => new Promise((resolve, reject) => {
    const keepalive = setInterval(() => {}, 1000);
    const watchdog = setTimeout(() => stop(new Error("watchdog: the verify timeout never fired")), 5_000);
    function stop(error) {
      clearInterval(keepalive);
      clearTimeout(watchdog);
      reject(error);
    }
    signal?.addEventListener("abort", () => stop(signal.reason), { once: true });
  });
}

test("a stalled verify times out and is inconclusive instead of hanging the shared pool", async () => {
  const verify = createLinkVerifier({ fetchImpl: stalledFetch(), timeoutMs: 20 });
  const sxyprnOutcome = await verify(sxyprn(hex(20)));
  assert.equal(sxyprnOutcome.status, "inconclusive", "an sxyprn stall is not proof of deletion");
  assert.match(sxyprnOutcome.reason, /abort/i);
  const epornerOutcome = await verify(eporner("ABC999"));
  assert.equal(epornerOutcome.status, "inconclusive", "an eporner stall is not proof of deletion");
  assert.match(epornerOutcome.reason, /abort/i);
});

test("a stalled response body also aborts and stays inconclusive", async () => {
  // Headers arrive, then the body never does - the timeout must cover the body read too.
  const stalledBody = async (url, { signal } = {}) => ({
    status: 200,
    ok: true,
    json: () => new Promise((resolve, reject) => {
      const keepalive = setInterval(() => {}, 1000);
      const watchdog = setTimeout(() => stop(new Error("watchdog: the verify timeout never fired")), 5_000);
      function stop(error) {
        clearInterval(keepalive);
        clearTimeout(watchdog);
        reject(error);
      }
      signal?.addEventListener("abort", () => stop(signal.reason), { once: true });
    }),
  });
  const outcome = await createLinkVerifier({ fetchImpl: stalledBody, timeoutMs: 20 })(eporner("ABC101"));
  assert.equal(outcome.status, "inconclusive", "a stalled body is not proof of deletion");
  assert.match(outcome.reason, /abort/i);
});

test("the verifier passes a bounded timeout signal on every fetch", async () => {
  assert.equal(VERIFY_TIMEOUT_MS, 15_000);
  const seen = [];
  const verify = createLinkVerifier({ fetchImpl: async (url, options = {}) => { seen.push(options.signal); return { status: 404, ok: false }; } });
  await verify(sxyprn(hex(21)));
  await verify(eporner("ABC100"));
  assert.equal(seen.length, 2, "both sources fetch");
  assert.ok(seen.every((signal) => signal instanceof AbortSignal), "each fetch carries an abort signal");
});

test("a dead link is not re-added by a lookup after the scene re-enters resolution", async () => {
  const url = sxyprn(hex(22)).url;
  const dead = { source: "sxyprn", url, embedUrl: null, verifiedAt: VERIFIED_AT,
    deadAt: "2026-09-26T00:00:00.000Z", deadReason: "sxyprn watch page returned HTTP 404" };
  // The last live link died, so videoCheckedAt was cleared and the scene re-enters resolution.
  const prior = scene("studio:1", [], { deadVideoUrls: [dead] });
  const fresh = scene("studio:1");
  // The lookup offers the very URL that was proven dead.
  const [resolved] = await enrichSxyprnLinks([fresh], [prior], async () => [url], { now: new Date("2026-09-27T00:00:00Z") });
  assert.equal(resolved.videoUrls, undefined, "videoUrls stays live-links-only");
  assert.deepEqual(resolved.deadVideoUrls, [dead], "the dead link stays in the dead array");
});

test("the strike limit is two, so a single definitive failure never kills a link", async () => {
  assert.equal(REVERIFY_STRIKE_LIMIT, 2);
  const link = sxyprn(hex(10));
  const [once] = await reverifyLinks([scene("a", [link])], { verify: async () => ({ status: "dead", reason: "gone" }) });
  assert.ok(once.videoUrls, "one strike is not death");
  const [twice] = await reverifyLinks([scene("a", [once.videoUrls[0]])], { verify: async () => ({ status: "dead", reason: "gone" }) });
  assert.ok(twice.deadVideoUrls, "the second consecutive strike is death");
});
