/**
 * Durable translation backfill CLI: apply the committed glossary/LLM cache to the
 * stored catalogue, translate any remaining untranslated titles in batches, and write
 * the updated cache back so a cold boot re-applies it instead of re-deriving it.
 */
import { fileURLToPath } from "node:url";
import { createTranslationBackfill, DEFAULT_TRANSLATION_CACHE } from "../src/translate-run.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = process.env.LISZT_DATA_PATH || `${root}/data/catalogue.json`;
const result = await createTranslationBackfill({ path, cachePath: process.env.LISZT_TRANSLATIONS_PATH || DEFAULT_TRANSLATION_CACHE })();
console.log(result ? `Translated ${result.translated} scene title(s); cache at ${process.env.LISZT_TRANSLATIONS_PATH || DEFAULT_TRANSLATION_CACHE}` : "Translation backfill failed");
