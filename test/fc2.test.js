import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALIAS_TAGS, DEFAULT_DETAIL_BUDGET, DETAIL_DELAY_MS, InertiaParseError, LISTING_DELAY_MS, NOISY_ALIAS_TAGS,
  PRIMARY_TAG, RATE_LIMIT_BACKOFF_MS, RateLimitError, UNION_TAGS, articleUrl, crawlUnion, createInertiaClient,
  createPageFetcher, createRequestPacer, fetchDetails, fetchFc2Crawl, parseArticlePage, parseArticleProps,
  parseInertiaPage, parseInertiaProps, parseListingItem, parseListingProps, parseRouteTable, selectDetailTargets,
  tagListingUrl, walkTag,
} from "../src/studios/fc2.js";

const tagFixture = () => readFile(new URL("../fixtures/fc2cmadb/tag-anal-page-1.html", import.meta.url), "utf8");
const articleFixture = () => readFile(new URL("../fixtures/fc2cmadb/article-4981628-uncensored.html", import.meta.url), "utf8");

/** Build a minimal Inertia page carrying `props`, in the shape the real pages use. */
function inertiaHtml(component, props, version = "v1") {
  const page = JSON.stringify({ component, props, url: "https://fc2cmadb.com/x", version, sharedProps: {} });
  return `<!DOCTYPE html><html><head><script data-page="app" type="application/json">${page}</script></head><body></body></html>`;
}

function listingProps(items, { next = null } = {}) {
  return { tag_name: PRIMARY_TAG, articles: { data: items, per_page: 30, next_page_url: next, prev_page_url: null } };
}

function detailProps(article) {
  return { article };
}

/** A fake fetch: each route is [substring, responder(url)]. Responders return {status, body}. */
function fakeFetch(routes) {
  const requests = [];
  const impl = async (url) => {
    const href = String(url);
    requests.push(href);
    for (const [match, responder] of routes) {
      if (href.includes(match)) {
        const { status = 200, body = "", headers = {} } = (await responder(href)) || {};
        return {
          ok: status >= 200 && status < 300,
          status,
          url: href,
          headers: { get: (name) => headers[name.toLowerCase()] ?? null },
          text: async () => body,
        };
      }
    }
    return { ok: false, status: 404, url: href, headers: { get: () => null }, text: async () => "" };
  };
  impl.requests = requests;
  return impl;
}

test("the union covers the primary tag, the 11.5 aliases and the noisy aliases exactly once", () => {
  assert.equal(PRIMARY_TAG, "アナル");
  assert.deepEqual(ALIAS_TAGS, ["アナルファック", "アナル中出し", "尻穴", "ケツ穴", "肛門", "2穴", "二穴"]);
  assert.deepEqual(NOISY_ALIAS_TAGS, ["アナルセックス", "アナル拡張"]);
  assert.deepEqual(UNION_TAGS, [PRIMARY_TAG, ...ALIAS_TAGS, ...NOISY_ALIAS_TAGS]);
  assert.equal(new Set(UNION_TAGS).size, UNION_TAGS.length);
  assert.equal(tagListingUrl(PRIMARY_TAG), "https://fc2cmadb.com/tags/%E3%82%A2%E3%83%8A%E3%83%AB");
  assert.equal(articleUrl(4981628), "https://fc2cmadb.com/articles/4981628");
});

test("the listing parser reads 30 rows and the cursor, and a null cursor ends the walk", async () => {
  const props = parseInertiaProps(await tagFixture(), { url: tagListingUrl(PRIMARY_TAG) });
  const listing = parseListingProps(props);
  assert.equal(listing.items.length, 30, "page 1 carries 30 items");
  assert.equal(listing.tagName, PRIMARY_TAG);
  assert.match(listing.nextPageUrl, /cursor=/, "the cursor URL is exposed");
  const first = listing.items[0];
  assert.equal(first.videoId, "4982221");
  assert.equal(first.releaseDate, "2026-09-24");
  assert.equal(first.censored, null, "listing rows always carry censored: null (section 2)");
  assert.equal(first.pivotTagId, 47, "tag id 47 is on the pivot");
  assert.equal(first.writer.name, "グリ下界隈");

  const last = parseListingProps(listingProps([listing.items[0]], { next: null }));
  assert.equal(last.nextPageUrl, null, "the final page has no cursor");
});

test("the detail parser extracts the badge, tags and sale fields from a kept seed row", async () => {
  const article = parseArticlePage(await articleFixture(), { url: articleUrl(4981628) });
  assert.equal(article.videoId, "4981628");
  assert.equal(article.censored, "無", "the badge lives only on the detail page");
  assert.equal(article.releaseDate, "2026-09-22");
  assert.equal(article.duration, "02:39:09");
  assert.equal(article.writer.name, "大人仮面Z");
  assert.equal(article.writer.slug, "otonakamenz");
  assert.equal(article.salePercentage, 50);
  assert.equal(article.saleLimiteDate, "2026-12-25 23:59:59");
  assert.equal(article.notFound, null);
  assert.equal(article.status, null);
  assert.equal(article.releaseUrl, "https://fc2cmadb.com/articles/4981628");
  assert.ok(article.tagNames.includes("アナル") && article.tagNames.includes("無修正"));
  assert.deepEqual(article.tags.find(({ name }) => name === "アナル"), { name: "アナル", tagId: 47 });
});

test("raw extraction keeps every badge state verbatim - 有/null/mixed are not filtered here (#104 owns that)", () => {
  // This cut must NOT implement the section-3 gates. The parser returns the raw censored value
  // so #104 can apply the censorship gate, the mixed-badge rule and the null->pending queue.
  assert.equal(parseArticleProps(detailProps({ video_id: 1, censored: "無", tags: [] })).censored, "無");
  assert.equal(parseArticleProps(detailProps({ video_id: 2, censored: "有", tags: [] })).censored, "有");
  assert.equal(parseArticleProps(detailProps({ video_id: 3, censored: null, tags: [] })).censored, null);
  assert.equal(parseArticleProps(detailProps({ video_id: 4, censored: "通常版：有 特典版：無", tags: [] })).censored, "通常版：有 特典版：無");
  assert.equal(parseArticleProps(detailProps({ video_id: 5, censored: "無", not_found: 1, status: "removed", tags: [] })).notFound, 1);
  // A censored-有 row survives extraction unchanged: nothing is silently dropped in #103.
  const censored = parseArticleProps(detailProps({ video_id: 6, censored: "有", title: "有", tags: [] }));
  assert.equal(censored.videoId, "6");
});

test("the detail parser requires a video_id and rejects a page with no Inertia payload", () => {
  assert.throws(() => parseArticleProps(detailProps({ title: "no id" })), InertiaParseError);
  assert.throws(() => parseInertiaPage("<html><body>no payload</body></html>"), InertiaParseError);
  assert.throws(() => parseInertiaPage('<script data-page="app">{not json}</script>'), InertiaParseError);
});

test("the in-page Ziggy route table exposes the two routes the crawler uses", async () => {
  const ziggy = parseRouteTable(await tagFixture());
  assert.equal(ziggy.url, "https://fc2cmadb.com");
  assert.equal(ziggy.routes["tags.show"].uri, "tags/{tag_name}");
  assert.equal(ziggy.routes["article.show"].uri, "articles/{video_id}");
  assert.equal(parseRouteTable("<html></html>"), null, "a missing table is not fatal");
});

test("the pacer holds the measured spacing: listing >= 2s, detail >= 8.5s", async () => {
  const waits = [];
  let clock = 0;
  const pacer = createRequestPacer({ delayMs: DETAIL_DELAY_MS, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  await pacer(); // first request: no wait
  clock += 100; // a fast request
  await pacer();
  assert.equal(waits.length, 1);
  assert.equal(waits[0], DETAIL_DELAY_MS - 100, "the second request waits out the remaining interval");
  assert.ok(DETAIL_DELAY_MS >= 8_000, "detail spacing is at least the measured 8-9s ceiling");
  assert.ok(LISTING_DELAY_MS >= 2_000, "listing spacing is at least the measured 2s floor");
});

test("a 429 on a detail page stops the tier immediately and reports a 60-minute backoff", async () => {
  const now = new Date("2026-09-26T00:00:00Z");
  const fetchImpl = fakeFetch([
    ["/tags/", async () => ({ body: await tagFixture() })],
    ["/articles/", () => ({ status: 429, body: "" })],
  ]);
  const result = await fetchFc2Crawl({ now, tags: [PRIMARY_TAG], fetchImpl, listingDelayMs: 0, detailDelayMs: 0, detailBudget: 10, knownIds: [] });
  // The listing fixture yields 30 new targets, but the first detail 429 must abort the tier.
  assert.equal(result.rateLimited, true);
  assert.equal(result.details.length, 0);
  assert.equal(fetchImpl.requests.filter((href) => href.includes("/articles/")).length, 1, "no further detail fetch is attempted");
  assert.equal(result.backoffUntil.getTime(), now.getTime() + RATE_LIMIT_BACKOFF_MS);
});

test("a 429 on a listing page stops the listing tier and reports the backoff", async () => {
  const now = new Date("2026-09-26T00:00:00Z");
  const fetchImpl = fakeFetch([["/tags/", () => ({ status: 429, body: "" })]]);
  const result = await fetchFc2Crawl({ now, tags: [PRIMARY_TAG, "尻穴"], fetchImpl, listingDelayMs: 0, detailDelayMs: 0, detailBudget: 0 });
  assert.equal(result.rateLimited, true);
  assert.equal(fetchImpl.requests.filter((href) => href.includes("/tags/")).length, 1, "the union walk stops at the first rate limit");
  assert.equal(result.backoffUntil.getTime(), now.getTime() + RATE_LIMIT_BACKOFF_MS);
});

test("a stale Inertia version (409) re-reads the page for the new version and retries once", async () => {
  let calls = 0;
  const seenHeaders = [];
  const fetchPage = async (url, { headers = {} } = {}) => {
    calls += 1;
    seenHeaders.push(headers);
    if (headers["x-inertia-version"]) {
      const error = new Error("409");
      error.status = 409;
      throw error;
    }
    return { html: "<html>fresh</html>", url, status: 200, headers: { get: () => null } };
  };
  const fetchInertia = createInertiaClient({ fetchPage });
  const response = await fetchInertia(articleUrl(4981628), { version: "stale", partial: { component: "Articles/Show", data: "actresses" } });
  assert.equal(response.html, "<html>fresh</html>");
  assert.equal(calls, 2, "one stale attempt, one clean retry");
  assert.equal(seenHeaders[0]["x-inertia-version"], "stale");
  assert.equal(seenHeaders[1]["x-inertia-version"], undefined, "the retry re-reads the HTML for the new version");
});

test("the union crawl deduplicates by video_id and accumulates the source tags", async () => {
  const item = { video_id: 100, title: "アナル", release_date: "2026-09-24", writer: { id: 1, slug: "s", name: "S" }, pivot: { tag_id: 47 } };
  const other = { video_id: 200, title: "尻穴", release_date: "2026-09-23", writer: { id: 2, slug: "t", name: "T" }, pivot: { tag_id: 9 } };
  const fetchPage = async () => ({ html: inertiaHtml("Tags/Show", listingProps([item, other])), url: "x", status: 200, headers: { get: () => null } });
  const union = await crawlUnion({ tags: [PRIMARY_TAG, "尻穴", "肛門"], fetchPage, maxPages: 1 });
  assert.equal(union.items.size, 2, "the same video_id from three tags is one item");
  assert.deepEqual([...union.items.get("100").sourceTags].sort(), ["尻穴", "肛門", "アナル"].sort(), "activity evidence accumulates");
  assert.equal(union.tagPages.length, 3);
  assert.equal(union.rateLimited, false);
});

test("walkTag stops on a page of known ids and on a null cursor", async () => {
  const items = Array.from({ length: 30 }, (_, index) => ({ video_id: 1000 + index, title: "t", release_date: "2026-09-20", writer: { id: 1, slug: "s", name: "S" }, pivot: { tag_id: 47 } }));
  const cursor = `${tagListingUrl(PRIMARY_TAG)}?cursor=abc`;
  let calls = 0;
  const seenFetch = async () => { calls += 1; return { html: inertiaHtml("Tags/Show", listingProps(items, { next: cursor })), url: "x", status: 200, headers: { get: () => null } }; };
  await walkTag(PRIMARY_TAG, { fetchPage: seenFetch, maxPages: 5, knownIds: items.map(({ video_id }) => video_id) });
  assert.equal(calls, 1, "a full page of known ids ends the poll");

  const finalFetch = async () => ({ html: inertiaHtml("Tags/Show", listingProps(items, { next: null })), url: "x", status: 200, headers: { get: () => null } });
  const walk = await walkTag(PRIMARY_TAG, { fetchPage: finalFetch, maxPages: 5, knownIds: [] });
  assert.equal(walk.pages.length, 1, "a null cursor ends the walk");
});

test("the detail queue orders new before pending re-checks and honours the budget", () => {
  const items = [
    { videoId: "1", releaseDate: "2026-09-01" },
    { videoId: "2", releaseDate: "2026-09-20" },
    { videoId: "3", releaseDate: "2026-09-10" },
    { videoId: "4", releaseDate: "2026-09-05" },
  ];
  const targets = selectDetailTargets(items, { knownIds: ["1"], pendingIds: ["3"], budget: 2 });
  assert.deepEqual(targets.map(({ videoId }) => videoId), ["2", "4"], "newest new first, known dropped, budget respected");
  const recheck = selectDetailTargets(items, { knownIds: [], pendingIds: ["3", "4"], budget: 5 });
  assert.deepEqual(recheck.map(({ reason }) => reason), ["new", "new", "pending", "pending"]);
  assert.equal(selectDetailTargets(items, { knownIds: [], pendingIds: [], budget: 0 }).length, 0);
  assert.equal(DEFAULT_DETAIL_BUDGET, 60, "section 7 default budget");
});

test("the full crawl walks the union, fetches details for new ids and returns raw rows", async () => {
  const fetchImpl = fakeFetch([
    ["/tags/", async () => ({ body: await tagFixture() })],
    ["/articles/", (href) => {
      const videoId = href.split("/").at(-1);
      return { body: inertiaHtml("Articles/Show", detailProps({ video_id: Number(videoId), censored: "無", title: `T${videoId}`, release_date: "2026-09-22", tags: [{ name: "アナル", pivot: { tag_id: 47 } }], writer: { id: 1, slug: "s", name: "S" } })) };
    }],
  ]);
  const result = await fetchFc2Crawl({ tags: [PRIMARY_TAG], fetchImpl, listingDelayMs: 0, detailDelayMs: 0, detailBudget: 2, knownIds: [] });
  assert.equal(result.items.length, 30, "the union listing is read once");
  assert.equal(result.targets.length, 2, "the detail budget caps the queue");
  assert.equal(result.details.length, 2);
  assert.ok(result.details.every((detail) => detail.censored === "無"));
  assert.equal(result.rateLimited, false);
  assert.equal(result.backoffUntil, null);
});

test("the crawl recovers a stale Inertia version on a detail page instead of dropping the item", async () => {
  let detailAttempts = 0;
  const fetchImpl = fakeFetch([
    ["/tags/", async () => ({ body: await tagFixture() })],
    ["/articles/", (href) => {
      detailAttempts += 1;
      // The first detail request carries the listing's version; the site answers 409, so the
      // client must re-read the HTML (version-less) and succeed on the retry.
      if (detailAttempts === 1) return { status: 409, body: "" };
      const videoId = href.split("/").at(-1);
      return { body: inertiaHtml("Articles/Show", detailProps({ video_id: Number(videoId), censored: "無", tags: [] })) };
    }],
  ]);
  const result = await fetchFc2Crawl({ tags: [PRIMARY_TAG], fetchImpl, listingDelayMs: 0, detailDelayMs: 0, detailBudget: 1, knownIds: [] });
  assert.equal(result.rateLimited, false);
  assert.equal(result.details.length, 1, "the 409 is retried, not lost");
  assert.equal(detailAttempts, 2);
});

test("a failed detail fetch is logged and skipped, never losing the rest of the run", async () => {
  const errors = [];
  const fetchDetailPage = async (url) => {
    if (url.endsWith("1")) { const error = new Error("HTTP 500"); error.status = 500; throw error; }
    return { html: inertiaHtml("Articles/Show", detailProps({ video_id: 2, censored: "無", tags: [] })), url, status: 200, headers: { get: () => null } };
  };
  const { details, errors: failed, rateLimited } = await fetchDetails([{ videoId: "1", reason: "new" }, { videoId: "2", reason: "new" }], { fetchDetailPage, onLog: (line) => errors.push(line) });
  assert.equal(details.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(rateLimited, false);
  assert.match(errors[0], /detail fetch failed for 1/);
});

test("the fetcher raises RateLimitError on 429 and a plain error on other failures", async () => {
  const rateLimited = createPageFetcher({ fetchImpl: fakeFetch([["/tags/", () => ({ status: 429 })]]), pacer: null });
  await assert.rejects(rateLimited(tagListingUrl(PRIMARY_TAG)), RateLimitError);

  const failed = createPageFetcher({ fetchImpl: fakeFetch([["/tags/", () => ({ status: 503 })]]), pacer: null });
  await assert.rejects(failed(tagListingUrl(PRIMARY_TAG)), /HTTP 503/);
});

test("the parser tolerates a missing writer and a bare-string tag", () => {
  const item = parseListingItem({ video_id: 9, title: "t", release_date: "2026-09-01" });
  assert.equal(item.writer, null);
  const article = parseArticleProps(detailProps({ video_id: 9, title: "t", tags: ["アナル", { name: "無修正", pivot: { tag_id: 152 } }] }));
  assert.deepEqual(article.tags, [{ name: "アナル", tagId: null }, { name: "無修正", tagId: 152 }]);
  assert.deepEqual(article.tagNames, ["アナル", "無修正"]);
});
