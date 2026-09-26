/**
 * Shared title-translation module for the lane adapters (madouqu first, FC2 next).
 *
 * Two stages, glossary first:
 *  1. An offline glossary pass renders the formulaic genre vocabulary. A title the
 *     glossary fully resolves never reaches the LLM.
 *  2. An optional batched LLM pass (OpenRouter) fills the rest, many titles per call.
 *
 * Translation is never on the boot or sync path and must never fail a sync: with no
 * OPENROUTER_API_KEY the module degrades to glossary-only and marks the rest
 * `untranslated`. Results are cached durably so a cold boot does not re-derive them.
 */
import { readFile } from "node:fs/promises";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
export const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_TIMEOUT_MS = 45_000;

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

export function hasCjk(value) {
  return CJK.test(String(value ?? ""));
}

/**
 * Replace glossary terms longest-first so a compound term is never split by one of
 * its own parts. Returns the partial rendering plus whether any CJK survived: only a
 * residue-free rendering counts as a completed glossary translation.
 */
export function applyGlossary(title, glossary = []) {
  let text = String(title ?? "");
  let hits = 0;
  for (const { term, english } of [...glossary].sort((left, right) => right.term.length - left.term.length)) {
    if (!term || !text.includes(term)) continue;
    // Space-pad the replacement so adjacent renderings do not fuse ("wifeanal sex").
    const parts = text.split(term);
    hits += parts.length - 1;
    text = parts.join(` ${english} `);
  }
  text = text.replace(/\s+/g, " ").trim();
  const residual = hasCjk(text);
  return { text, hits, residual, translated: hits > 0 && !residual };
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function buildPrompt(titles) {
  return [
    "Translate these Chinese adult-content genre titles into English.",
    "Keep release codes, numbers, and ages exact. No embellishment, no censorship, plain literal English.",
    "Return ONLY JSON of the form {\"translations\":[{\"original\":\"<input>\",\"english\":\"<output>\"}]}",
    "with one entry per input, in order.",
    JSON.stringify(titles),
  ].join("\n");
}

function parseTranslations(payload, titles) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = Array.isArray(parsed?.translations) ? parsed.translations : [];
  const byOriginal = new Map(list.map((item) => [String(item?.original ?? ""), String(item?.english ?? "")]));
  return titles.map((title) => byOriginal.get(title) || "");
}

/**
 * A translator instance is bound to one lane's glossary. `translate` resolves every
 * input to `{ original, title, provider, translated }`:
 *  - `glossary`     the offline pass fully rendered the title
 *  - `llm:<model>`  the batched LLM pass rendered it
 *  - `untranslated` no English rendering; `title` is the original
 * A missing key, a network failure, or a malformed response all degrade to
 * `untranslated` for the affected titles and never throw.
 */
export function createTranslator({
  glossary = [],
  apiKey = process.env.OPENROUTER_API_KEY,
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
  cache = new Map(),
  batchSize = DEFAULT_BATCH_SIZE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onError = () => {},
} = {}) {
  const available = Boolean(apiKey);
  const ordered = [...glossary].sort((left, right) => right.term.length - left.term.length);

  async function requestBatch(titles) {
    const response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: "You are a literal translation engine for a private adult-content catalogue." },
          { role: "user", content: buildPrompt(titles) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
    return parseTranslations(await response.json(), titles);
  }

  async function translate(titles) {
    const output = [];
    const pending = [];
    for (const raw of titles) {
      const original = decodeHtml(raw).trim();
      if (!original) continue;
      const cached = cache.get(original);
      if (cached) {
        output.push({ original, ...cached });
        continue;
      }
      const gloss = applyGlossary(original, ordered);
      if (gloss.translated) {
        const result = { title: gloss.text, provider: "glossary", translated: true };
        cache.set(original, result);
        output.push({ original, ...result });
        continue;
      }
      if (!available) {
        // Deliberately not cached: adding a key later must let these retry.
        output.push({ original, title: original, provider: "untranslated", translated: false });
        continue;
      }
      pending.push({ original, draft: gloss.hits ? gloss.text : null });
    }

    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      const inputs = batch.map(({ original }) => original);
      let english = null;
      try {
        english = await requestBatch(inputs);
      } catch (error) {
        onError(error);
      }
      batch.forEach(({ original, draft }, offset) => {
        const text = english?.[offset]?.trim();
        if (text) {
          const result = { title: text, provider: `llm:${model}`, translated: true };
          cache.set(original, result);
          output.push({ original, ...result });
        } else {
          output.push({ original, title: original, provider: "untranslated", translated: false, ...(draft ? { draft } : {}) });
        }
      });
    }
    return output;
  }

  return { available, model, cache, translate, applyGlossary: (title) => applyGlossary(title, ordered) };
}

/** Read a durable translation cache. A missing or malformed file yields an empty cache. */
export async function loadTranslationCache(path) {
  if (!path) return new Map();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return new Map(Object.entries(parsed?.translations || {}));
  } catch {
    return new Map();
  }
}

export function serializeTranslationCache(cache) {
  return { translations: Object.fromEntries([...cache].sort(([left], [right]) => left.localeCompare(right))) };
}

/**
 * Label naming (spec section 4): an unmapped category name is romanised/translated once
 * by the same batched LLM pass, then cached. Returns a Map of original -> English; an
 * unavailable or failing pass yields an empty Map so the caller keeps the original name.
 */
export function createLabelNamer({ apiKey = process.env.OPENROUTER_API_KEY, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, onError = () => {} } = {}) {
  async function nameLabels(names) {
    const unique = [...new Set(names.map((name) => String(name ?? "").trim()).filter(Boolean))];
    if (!unique.length || !apiKey) return new Map();
    try {
      const response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: "You romanise Chinese adult-studio label names into short English display names." },
            { role: "user", content: `Return ONLY JSON {\"labels\":[{\"original\":\"<input>\",\"english\":\"<output>\"}]} with one entry per input, in order, no commentary.\n${JSON.stringify(unique)}` },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
      const content = (await response.json())?.choices?.[0]?.message?.content;
      const start = String(content).indexOf("{");
      const end = String(content).lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("malformed label response");
      const list = JSON.parse(String(content).slice(start, end + 1))?.labels;
      if (!Array.isArray(list)) throw new Error("malformed label response");
      return new Map(list.filter((item) => item?.original && item?.english).map((item) => [String(item.original), String(item.english)]));
    } catch (error) {
      onError(error);
      return new Map();
    }
  }
  return { available: Boolean(apiKey), nameLabels };
}
