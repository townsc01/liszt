/**
 * Durable translation backfill. Translation is deliberately OFF the boot and sync
 * paths: sync writes untranslated titles immediately and this module runs later, in
 * the background, batched and glossary-first. The cache lives in a committed file
 * (default `data/translations.json`) so a cold boot re-applies it instead of
 * re-deriving every title from the LLM.
 */
import { fileURLToPath } from "node:url";
import { readStore, writeStore } from "./store.js";
import { createLabelNamer, createTranslator, hasCjk, loadTranslationCache, serializeTranslationCache } from "./translate.js";
import { TITLE_GLOSSARY } from "./studios/madouqu.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_TRANSLATION_CACHE = `${root}/data/translations.json`;

/** Apply a cached translation to a scene. Never touches identity or dedupe. */
export function applyCachedTranslation(scene, cache) {
  if (scene.titleTranslated && scene.translationProvider !== "none") return scene;
  const entry = cache.get(String(scene.originalTitle ?? scene.title ?? "").trim());
  if (!entry) return scene;
  return { ...scene, title: entry.title, titleTranslated: entry.translated, translationProvider: entry.provider };
}

/**
 * Translate the stored catalogue's untranslated titles, then persist both the durable
 * cache and the catalogue. Cached titles are applied without any LLM call, so this is
 * also the boot-time cache application. Returns the counts of scenes that changed.
 */
export async function translateStoredCatalogue(path, {
  cachePath = DEFAULT_TRANSLATION_CACHE,
  translator,
  labelNamer,
  glossary = TITLE_GLOSSARY,
  onProgress = () => {},
} = {}) {
  // The durable cache is the source of truth; a translator passed in for tests may carry
  // its own. Production loads the committed cache so a cold boot never re-derives titles.
  const cache = translator?.cache || await loadTranslationCache(cachePath);
  const active = translator || createTranslator({ glossary, cache });
  const catalogue = await readStore(path);
  const scenes = catalogue.scenes || [];
  const pending = [...new Set(scenes
    .filter((scene) => !scene.titleTranslated && scene.originalTitle)
    .map((scene) => scene.originalTitle))];
  const results = await active.translate(pending);
  const translated = new Map(results.filter((item) => item.translated).map((item) => [item.original, item]));
  let changed = 0;
  const updated = scenes.map((scene) => {
    const entry = translated.get(String(scene.originalTitle || "").trim());
    if (!entry) return scene;
    changed += 1;
    onProgress(scene);
    return { ...scene, title: entry.title, titleTranslated: true, translationProvider: entry.provider };
  });

  // Spec section 4: unmapped category names get an LLM naming once, cached on the studio
  // record. An unavailable namer leaves the Chinese name in place (never a guess).
  const studios = catalogue.studios || [];
  const unmapped = studios.filter((studio) => hasCjk(studio.name));
  const labels = await (labelNamer || createLabelNamer()).nameLabels(unmapped.map((studio) => studio.name));
  const renamed = new Map(studios.filter((studio) => labels.has(studio.name)).map((studio) => [studio.id, labels.get(studio.name)]));
  const named = renamed.size;
  const renamedStudios = studios.map((studio) => renamed.has(studio.id) ? { ...studio, name: renamed.get(studio.id), labelSource: "llm" } : studio);
  // The watchlist renders scene.studio per row, so a renamed label must reach the rows too.
  const relabelled = named ? updated.map((scene) => renamed.has(scene.studioId) ? { ...scene, studio: renamed.get(scene.studioId) } : scene) : updated;

  await writeStore(cachePath, serializeTranslationCache(active.cache));
  if (changed || named) await writeStore(path, { ...catalogue, scenes: relabelled, studios: renamedStudios });
  return { translated: changed, named, cache: active.cache, scenes: relabelled, studios: renamedStudios };
}

/** The production background pass: glossary-first, batched, and never fatal to the caller. */
export function createTranslationBackfill({ path, cachePath = DEFAULT_TRANSLATION_CACHE, glossary = TITLE_GLOSSARY, ...options } = {}) {
  return async (extra = {}) => {
    try {
      return await translateStoredCatalogue(path, { cachePath, glossary, ...options, ...extra });
    } catch (error) {
      console.error("Translation backfill failed:", error);
      return null;
    }
  };
}
