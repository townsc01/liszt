import test from "node:test";
import assert from "node:assert/strict";
import { hasOpenIdentity, pickMatch, titleStem } from "../src/matching.js";
import { buildSxyprnQueries } from "../src/sxyprn.js";
import { configuredSceneCode } from "../src/matching-config.js";

const scene = (overrides = {}) => ({ title: "Beauty Saves Marriage At Last", performers: ["Geishakyd"],
  studio: "Tushy", releaseDate: "2026-09-24", durationSec: 2503, ...overrides });
const candidate = (overrides = {}) => ({ title: "Geishakyd Beauty Saves Marriage At Last", duration: 2504,
  url: "https://tube/one", uploader: "one", views: 10, added: "2026-09-25", ...overrides });

test("the open gate requires duration and performer or verbatim-title identity", () => {
  assert.equal(pickMatch(scene(), [candidate()])?.url, "https://tube/one");
  assert.equal(pickMatch(scene(), [candidate({ duration: 2506 })]), null);
  assert.equal(pickMatch(scene(), [candidate({ title: "Tushy Someone Else" })]), null);
  assert.equal(pickMatch(scene({ durationSec: null }), [candidate()]), null);
  assert.equal(hasOpenIdentity(scene({ performers: [] }), "Repost - Beauty Saves Marriage At Last full"), true);
});

test("single-token performers are queried and creator studios omit studio queries", () => {
  assert.ok(buildSxyprnQueries(scene()).includes("geishakyd"));
  assert.ok(buildSxyprnQueries(scene()).includes("Tushy"));
  assert.ok(!buildSxyprnQueries(scene({ creatorStudio: true })).includes("Tushy"));
});

test("scene-code retrieval hints are data-backed and do not apply to other studios", () => {
  assert.equal(configuredSceneCode({ studioId: "mambo-perv", title: "A scene OB632" }), "ob632");
  assert.equal(configuredSceneCode({ studioId: "another-studio", title: "A scene OB632" }), null);
});

test("trusted pools allow first names but enforce MMDD and the duration gate", () => {
  const maya = scene({ title: "20Y Beautiful Brazilian First Studio Scene", performers: ["Maya Bell"], durationSec: 2115, releaseDate: "2026-09-22" });
  assert.ok(pickMatch(maya, [candidate({ title: "MAYA922", duration: 2115 })], { trustedPool: true }));
  assert.ok(pickMatch(maya, [candidate({ title: "MAYA922 2", duration: 2115 })], { trustedPool: true }));
  assert.equal(pickMatch(maya, [candidate({ title: "MAYA924 2", duration: 2115 })], { trustedPool: true }), null);
  assert.equal(pickMatch(maya, [candidate({ title: "MAYA923", duration: 2555 })], { trustedPool: true }), null);
  const cherry = scene({ performers: ["Cherry Kiss"], durationSec: 3102, releaseDate: "2026-09-25" });
  assert.equal(pickMatch(cherry, [candidate({ title: "LLW - LanaWills 924", duration: 3100 })], { trustedPool: true }), null);
});

test("repost decorations dedupe, while conflicting identities from different uploaders reject", () => {
  assert.equal(titleStem("{NEW} A title #one #two"), titleStem("A title"));
  const duplicate = candidate({ title: "{NEW} Geishakyd Beauty Saves Marriage At Last #tushy", uploader: "one", views: 20 });
  assert.equal(pickMatch(scene(), [candidate(), duplicate]), duplicate);
  const conflict = candidate({ title: "Geishakyd unrelated upload", uploader: "two", url: "https://tube/two" });
  assert.equal(pickMatch(scene(), [candidate(), conflict]), null);
});

test("structured Sxyprn authors preserve cross-uploader disagreement", () => {
  const first = candidate({ uploader: undefined, author: { id: "blog-one", name: "One" } });
  const second = candidate({ uploader: undefined, author: { id: "blog-two", name: "Two" },
    title: "Geishakyd unrelated upload", url: "https://tube/two" });
  assert.equal(pickMatch(scene(), [first, second]), null);
});

test("compact repost dates do not create a second title identity", () => {
  assert.equal(titleStem("Tushy 26 09 06 Maddie Wren Perfect Model Wants The Scene"),
    titleStem("Tushy Maddie Wren Perfect Model Wants The Scene"));
  const current = scene({ performers: ["Maddie Wren"], title: "Perfect Model Wants The Scene" });
  assert.ok(pickMatch(current, [candidate({ title: "Tushy 26 09 06 Maddie Wren Perfect Model Wants The Scene", uploader: "one" }),
    candidate({ title: "Tushy Maddie Wren Perfect Model Wants The Scene", uploader: "two", url: "https://tube/two" })]));
});
