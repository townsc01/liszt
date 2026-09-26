import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readStore } from "./store.js";
import { sync } from "./sync.js";
import { enrichStoredCatalogue, validSxyprnUrl } from "./sxyprn.js";
import { createLinkVerifier, reverifyStoredCatalogue } from "./reverify.js";
import { createEpornerLookup, createEpornerTrustedPoolLoader } from "./eporner.js";
import { createTranslationBackfill } from "./translate-run.js";
import { createVideoProxy } from "./video-proxy.js";
import sxyprn from "sxyprn";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const dataPath = process.env.LISZT_DATA_PATH || join(root, "data/catalogue.json");
const port = Number(process.env.PORT || 10000);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

export function createLisztServer({ cataloguePath = dataPath, syncCatalogue = () => sync({ paths: [cataloguePath] }), enrichCatalogue = async () => {}, translateCatalogue = async () => {}, videoDetails = ({ url }) => sxyprn.videos.details({ url }), fetchVideo = fetch, bootSync = false } = {}) {
  let refreshInProgress = null;
  let enrichmentInProgress = null;
  let translationInProgress = null;
  let generation = 0;
  const videoProxy = createVideoProxy({ videoDetails, fetchImpl: fetchVideo });

  function startEnrichment() {
    if (enrichmentInProgress) return enrichmentInProgress;
    const currentGeneration = generation;
    enrichmentInProgress = Promise.resolve().then(() => enrichCatalogue({ shouldContinue: () => generation === currentGeneration }))
      .catch((error) => console.error("Sxyprn enrichment failed:", error))
      .finally(() => { enrichmentInProgress = null; });
    return enrichmentInProgress;
  }

  // Translation is never on the boot or sync path: it backfills after enrichment, in
  // the background, batched and glossary-first. A missing key degrades to
  // glossary-only rather than failing anything.
  function startTranslation() {
    if (translationInProgress) return translationInProgress;
    translationInProgress = Promise.resolve().then(() => translateCatalogue())
      .catch((error) => console.error("Translation backfill failed:", error))
      .finally(() => { translationInProgress = null; });
    return translationInProgress;
  }

  function startSync() {
    refreshInProgress ||= Promise.resolve().then(async () => {
      generation++;
      if (enrichmentInProgress) await enrichmentInProgress;
      const data = await syncCatalogue();
      startEnrichment();
      startTranslation();
      return data;
    }).finally(() => { refreshInProgress = null; });
    return refreshInProgress;
  }

  // Boot sync must never reject into the process: a failed boot leaves the server serving
  // the bundled/retained catalogue, exactly like a failed refresh click. Enrichment still
  // starts on failure so the retained scenes get re-checked instead of 404ing on /api/video.
  function startBootSync() {
    startSync().catch((error) => {
      console.error("Boot sync failed:", error);
      startEnrichment();
      startTranslation();
    });
  }

  const app = createServer(async (request, response) => {

    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname === "/api/scenes") {
        const data = await readStore(cataloguePath);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify({ ...data, enrichmentPending: !!enrichmentInProgress }));
      }
      if (url.pathname === "/api/refresh") {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
          return response.end(JSON.stringify({ error: "Method not allowed" }));
        }
        const data = await startSync();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify({ ...data, enrichmentPending: !!enrichmentInProgress }));
      }
      if (url.pathname === "/api/video" || url.pathname === "/api/video/resolve") {
        const id = url.searchParams.get("scene");
        const catalogue = await readStore(cataloguePath);
        const scene = catalogue.scenes?.find((item) => item.id === id);
        // Legacy scenes store only sxyprnUrls; fall back to them so playback keeps
        // working until a data refresh migrates the catalogue to videoUrls.
        const postUrl = [...(scene?.videoUrls || []), ...(scene?.sxyprnUrls || []).map((url) => ({ source: "sxyprn", url }))]
          .find((link) => link.source === "sxyprn" && validSxyprnUrl(link.url))?.url;
        if (!postUrl) {
          response.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          return response.end(JSON.stringify({ error: "Video unavailable" }));
        }
        try {
          if (url.pathname.endsWith("/resolve")) {
            await videoProxy.resolve(id, postUrl);
            response.writeHead(204, { "cache-control": "no-store" });
            return response.end();
          }
          return await videoProxy.stream(id, postUrl, request, response);
        } catch (error) {
          error.statusCode = 502;
          throw error;
        }
      }
      const requested = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
      const path = join(publicRoot, requested);
      if (!path.startsWith(publicRoot)) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      const body = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      if (response.headersSent) return response.destroy(error);
      const status = error.code === "ENOENT" ? 404 : error.statusCode || 500;
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found" : "Something went wrong");
    }
  });
  app.startEnrichment = startEnrichment;
  app.startBootSync = startBootSync;
  // Boot sync is bound to the listening event, not to the CLI entrypoint, so the real
  // boot path (port bound first, sync in the background) is what the tests exercise.
  if (bootSync) app.once("listening", startBootSync);
  return app;
}

/**
 * The production enrichment pass: re-verify the stalest slice of stored links, then run
 * playback matching. Dead links leave `videoUrls` for `deadVideoUrls`, and a scene whose
 * last live link died has `videoCheckedAt` cleared, so the matching pass resolves it again.
 */
export function createCatalogueEnricher({ path = dataPath, verifyLink = createLinkVerifier(), fallbackLookup, onProgress } = {}) {
  return async (options = {}) => {
    await reverifyStoredCatalogue(path, { verify: verifyLink, ...options });
    return enrichStoredCatalogue(path, {
      ...options,
      fallbackLookup: fallbackLookup ?? createEpornerLookup({ trustedPoolLoader: createEpornerTrustedPoolLoader() }),
      onProgress: onProgress ?? ((scene) => console.log(`Playback sources checked ${scene.id}: ${scene.videoUrls?.length || 0} link(s)`)),
    });
  };
}

export const server = createLisztServer({
  bootSync: true,
  enrichCatalogue: createCatalogueEnricher(),
  translateCatalogue: createTranslationBackfill({ path: dataPath }),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Boot-only cadence for the prototype: a waking instance heals its own catalogue
  // instead of waiting for a visitor to click Refresh. The port is bound before the
  // listening event fires, so first paint serves the bundled data and fresh data lands
  // once the background sync finishes.
  server.listen(port, () => console.log(`Liszt is listening at http://localhost:${port}`));
}
