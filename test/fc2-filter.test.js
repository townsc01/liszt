import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MF_COOCCURRENCE, MM_LEXICON, MT_LEXICON, PEGGING_LEXICON, SAFETY_LEXICON, SOLO_LEXICON, TRANS_LEXICON,
  admitSellers, classifyContent, classifyDetailTags, classifySeller, evaluateCensorship, runAdmissionPipeline,
  sellerKey, sellerLabel,
} from "../src/studios/fc2-filter.js";
import { parseArticlePage, parseListingProps, parseInertiaProps, tagListingUrl } from "../src/studios/fc2.js";

const item = (overrides = {}) => ({ videoId: "1", title: "普通のアナル中出し", releaseDate: "2026-09-20", writer: { id: 1, slug: "s", name: "S" }, ...overrides });
const detail = (overrides = {}) => ({ videoId: "1", censored: "無", tagNames: [], ...overrides });
const rows = (...weeks) => weeks; // readability helper for seller activity

test("section 3.3 badge states are read verbatim, with null pending and mixed flagged", () => {
  assert.equal(evaluateCensorship("無").state, "uncensored");
  assert.equal(evaluateCensorship("有").state, "censored");
  assert.equal(evaluateCensorship(null).state, "pending");
  assert.equal(evaluateCensorship("通常版：有 特典版：無").state, "mixed");
  assert.equal(evaluateCensorship("").state, "pending");
});

test("the safety screen hard-blocks the minor/non-consent lexicon and keeps legal ages", () => {
  for (const title of ["女子校生アナル", "ロリ系中出し", "盗撮アナル", "underage anal", "schoolgirl anal"]) {
    assert.equal(classifyContent(title).reason, "safety", title);
  }
  // 18/19 stated ages are legal adults and stay; 人妻/素人 are normal FC2 vocabulary.
  assert.equal(classifyContent("18歳 素人 人妻 アナル中出し").verdict, "keep");
  assert.equal(classifyContent("19歳 アナルSEX").verdict, "keep");
});

test("the trans backstop fires on the title and on a tag-only hit (both stay excluded)", () => {
  assert.equal(classifyContent("ニューハーフ 竿あり アナル").reason, "trans");
  assert.equal(classifyContent("普通のタイトル", ["女装子"]).reason, "trans");
  assert.equal(classifyContent("普通のタイトル", ["shemale"]).reason, "trans");
  assert.ok(TRANS_LEXICON.includes("ペニ子") && TRANS_LEXICON.includes("ペニクリ"));
});

test("11.1a tier 2 hard-excludes M/M, M/T, pegging and unrecovered solo titles, and logs the term", () => {
  assert.equal(classifyContent("ノンケ ラガーマン アナル").reason, "orientation-mm");
  assert.equal(classifyContent("メス男子 竿あり アナル").reason, "orientation-mt");
  assert.equal(classifyContent("前立腺 アナル 開発").reason, "orientation-pegging");
  assert.equal(classifyContent("アナル オナニー 個撮").reason, "blocklist-softcore");
  // The M/F co-occurrence rescue is load-bearing: a straight scene mentioning solo vocabulary stays.
  assert.equal(classifyContent("お風呂でアナル中出し").verdict, "keep");
  assert.equal(classifyContent("シャワー 中出し アナル").verdict, "keep");
  const solo = classifyContent("アナル オナニー 個撮");
  assert.deepEqual(solo.terms, ["オナニー"]);
  assert.ok(MM_LEXICON.length > 0 && PEGGING_LEXICON.includes("フィスト") && SOLO_LEXICON.includes("風呂"));
});

test("11.2 blocklist exclusions are logged with the matched term and seller, never silently", () => {
  const result = runAdmissionPipeline({
    items: [item({ videoId: "9", title: "アナル オナニー 個撮", writer: { id: 2, slug: "x", name: "エロタウロス" } })],
    details: [detail({ videoId: "9" })],
  });
  assert.equal(result.excluded.length, 1);
  assert.equal(result.kept.length, 0);
  assert.deepEqual(result.excluded[0], { videoId: "9", seller: "エロタウロス", reason: "blocklist-softcore", terms: ["オナニー"] });
  assert.equal(result.ledger.byReason["blocklist-softcore"], 1);
  assert.equal(result.ledger.excluded, 1);
});

test("11.1a tier 3 excludes an innocuous title whose detail tags carry orientation vocabulary", () => {
  assert.deepEqual(classifyDetailTags(["アナル", "GMPD"]), { verdict: "exclude", reason: "orientation-detail-tag", terms: ["GMPD"] });
  assert.equal(classifyDetailTags(["アナル", "無修正"]).verdict, "keep");
  const result = runAdmissionPipeline({
    items: [item({ videoId: "5", title: "普通のアナル中出し" })],
    details: [detail({ videoId: "5", tagNames: ["アナル", "オトコノコ"] })],
  });
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].reason, "orientation-detail-tag");
  assert.deepEqual(result.excluded[0].terms, ["オトコノコ"]);
});

test("11.1a tier 1 excludes a seller whose titles are majority M/M or M/T", () => {
  const mmItems = ["ゲイ 男同士 アナル", "ノンケ 体育会 アナル", "ガチムチ アナル", "ラガーマン アナル"].map((title, index) => item({ videoId: String(index), title, writer: { id: 3, slug: "mm", name: "イケメン専門" } }));
  assert.equal(classifySeller(mmItems).excluded, true);
  assert.equal(classifySeller(mmItems).reason, "orientation-mm-seller");
  const cleanItems = [item({ videoId: "1" }), item({ videoId: "2", title: "アナル 中出し" }), item({ videoId: "3", title: "人妻 アナルSEX" })];
  assert.equal(classifySeller(cleanItems).excluded, false);
  assert.equal(classifySeller([item()]).excluded, false, "under min titles a seller is not classified");
  const result = runAdmissionPipeline({ items: mmItems, details: mmItems.map(({ videoId }) => detail({ videoId })) });
  assert.equal(result.kept.length, 0, "a tier-1 seller ban excludes every item it posted");
  assert.equal(result.excluded.every((entry) => entry.reason === "orientation-mm-seller"), true);
});

test("11.1 admission: >= 3 releases in 90 days admits; > 180 days dormant; recomputed each run", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  const active = rows(
    item({ videoId: "1", releaseDate: "2026-09-20" }),
    item({ videoId: "2", releaseDate: "2026-09-01" }),
    item({ videoId: "3", releaseDate: "2026-08-01" }),
  );
  const thin = [
    item({ videoId: "4", releaseDate: "2026-09-20", writer: { id: 2, slug: "thin", name: "Thin" } }),
    item({ videoId: "5", releaseDate: "2026-09-19", writer: { id: 2, slug: "thin", name: "Thin" } }),
  ];
  const admissions = admitSellers([...active, ...thin], { now });
  assert.equal(admissions.get("s").active, true);
  assert.equal(admissions.get("s").releaseCount, 3);
  assert.equal(admissions.get("s").admitted, true);
  assert.equal(admissions.get("thin").active, false, "2 releases in the window is below the 3-release threshold");
  assert.equal(admissions.get("thin").releaseCount, 2);

  // A single seen release is below the threshold and not admitted.
  const one = admitSellers([item({ videoId: "9", releaseDate: "2026-09-20" })], { now });
  assert.equal(one.get("s").active, false);
  assert.equal(one.get("s").admitted, false);

  // A previously admitted seller with no in-union release for 180+ days goes dormant.
  const stale = admitSellers([item({ videoId: "10", releaseDate: "2026-01-01", writer: { id: 7, slug: "old", name: "Old" } })], { now, priorAdmissions: new Map([["old", {}]]) });
  assert.equal(stale.get("old").dormant, true);
  assert.equal(stale.get("old").active, false);
  assert.equal(stale.get("old").admitted, true, "existing rows stay");

  // A new release re-activates a dormant seller.
  const reActivated = admitSellers([
    item({ videoId: "11", releaseDate: "2026-09-24", writer: { id: 7, slug: "old", name: "Old" } }),
    item({ videoId: "12", releaseDate: "2026-09-23", writer: { id: 7, slug: "old", name: "Old" } }),
    item({ videoId: "13", releaseDate: "2026-09-22", writer: { id: 7, slug: "old", name: "Old" } }),
  ], { now, priorAdmissions: new Map([["old", {}]]) });
  assert.equal(reActivated.get("old").active, true);
  assert.equal(reActivated.get("old").dormant, false);
});

test("seller keys and labels survive missing writers and prefer slug", () => {
  assert.equal(sellerKey({ id: 5, slug: "ab", name: "AB" }), "ab");
  assert.equal(sellerKey({ id: 5, name: "AB" }), "5");
  assert.equal(sellerKey(null), null);
  assert.equal(sellerLabel({ name: "大人仮面Z", slug: "otonakamenz" }), "大人仮面Z");
});

test("the pipeline: an item with no detail is undecided, not rejected (censorship is unknowable yet)", () => {
  const result = runAdmissionPipeline({ items: [item({ videoId: "1" })], details: [] });
  assert.equal(result.undecided.length, 1);
  assert.equal(result.kept.length, 0);
  assert.equal(result.pending.length, 0);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.ledger.undecided, 1);
});

test("the pipeline routes each item to one bucket: kept, censored, mixed, pending, removed", () => {
  const items = [
    item({ videoId: "1", title: "アナル中出し" }),
    item({ videoId: "2", title: "有 アナル" }),
    item({ videoId: "3", title: "通常版 アナル" }),
    item({ videoId: "4", title: "未マーク アナル" }),
    item({ videoId: "5", title: "削除済み アナル" }),
  ];
  const details = [
    detail({ videoId: "1", censored: "無" }),
    detail({ videoId: "2", censored: "有" }),
    detail({ videoId: "3", censored: "通常版：有 特典版：無" }),
    detail({ videoId: "4", censored: null }),
    detail({ videoId: "5", censored: "無", notFound: 1, status: "removed" }),
  ];
  const result = runAdmissionPipeline({ items, details });
  assert.deepEqual(result.kept.map(({ item }) => item.videoId), ["1"]);
  assert.deepEqual(result.excluded.map((entry) => [entry.videoId, entry.reason]), [["2", "censored"], ["3", "censored-mixed"]]);
  assert.deepEqual(result.pending.map((entry) => entry.videoId), ["4"]);
  assert.deepEqual(result.removed.map((entry) => entry.videoId), ["5"]);
  assert.equal(result.ledger.walked, 5);
  assert.equal(result.ledger.kept + result.ledger.excluded + result.ledger.pending + result.ledger.removed, 5);
});

test("a badge flip null -> 無 on re-check moves an item from pending to kept", () => {
  const first = runAdmissionPipeline({ items: [item({ videoId: "1" })], details: [detail({ videoId: "1", censored: null })] });
  assert.deepEqual(first.pending.map((entry) => entry.videoId), ["1"]);
  const recheck = runAdmissionPipeline({ items: [item({ videoId: "1" })], details: [detail({ videoId: "1", censored: "無" })] });
  assert.deepEqual(recheck.kept.map(({ item }) => item.videoId), ["1"]);
  assert.equal(recheck.pending.length, 0);
});

test("the pipeline reproduces the 318-row seed's ledger: no seed row is silently dropped", async () => {
  const csv = await readFile(new URL("../data/seeds/fc2cmadb-anal-uncensored-2026-09-24.csv", import.meta.url), "utf8");
  const lines = csv.trim().split("\n").slice(1);
  const items = lines.map((line, index) => {
    const [code, releaseDate, title, , , seller] = line.split(",");
    const videoId = code.replace(/^FC2-PPV-/, "");
    return item({ videoId, title, releaseDate, writer: { id: index, slug: `s${index}`, name: seller } });
  });
  assert.equal(items.length, 318);
  // Every seed row was kept with censored 無 and tags checked, so give each a 無 detail page.
  const details = items.map(({ videoId }) => detail({ videoId, censored: "無", tagNames: [] }));
  const result = runAdmissionPipeline({ items, details, now: new Date("2026-09-26T00:00:00Z") });
  // The seed was cut before 11.1a/11.2 existed, so the filters remove the handful of mistags
  // the spec documents (softcore/solo rows and femdom pegging rows), each one logged.
  assert.equal(result.ledger.kept + result.ledger.excluded, 318, "every seed row lands in kept or a logged exclusion");
  assert.ok(result.ledger.kept >= 300, `the filters remove only a handful of mistags (kept ${result.ledger.kept})`);
  assert.ok(result.excluded.every((entry) => entry.reason && Array.isArray(entry.terms) && entry.seller !== undefined), "every exclusion is logged with reason, terms and seller");
  const reasons = new Set(result.excluded.map((entry) => entry.reason));
  assert.deepEqual([...reasons].sort(), ["blocklist-softcore", "orientation-pegging"], "only the documented softcore/femdom mistags are removed");
  assert.ok(result.excluded.every((entry) => entry.terms.length > 0), "each exclusion carries the matched term for human review");
});

test("the pipeline runs over the real recovered fixtures end to end", async () => {
  const listingHtml = await readFile(new URL("../fixtures/fc2cmadb/tag-anal-page-1.html", import.meta.url), "utf8");
  const articleHtml = await readFile(new URL("../fixtures/fc2cmadb/article-4981628-uncensored.html", import.meta.url), "utf8");
  const listing = parseListingProps(parseInertiaProps(listingHtml, { url: tagListingUrl("アナル") }));
  const article = parseArticlePage(articleHtml, { url: "https://fc2cmadb.com/articles/4981628" });
  const seed = listing.items.find(({ videoId }) => videoId === "4981628");
  assert.ok(seed, "the kept seed row 4981628 is on page 1 of the listing fixture");
  const result = runAdmissionPipeline({ items: listing.items, details: [article], now: new Date("2026-09-26T00:00:00Z") });
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].detail.censored, "無");
  assert.equal(result.kept[0].detail.tagNames.includes("アナル"), true);
  // The rest of the page has no detail this run, so it is undecided (or already excluded on
  // listing data) - every row is accounted for exactly once.
  assert.equal(result.kept.length + result.excluded.length + result.undecided.length + result.pending.length + result.removed.length, listing.items.length);
  assert.ok(result.undecided.length >= 25);
});
