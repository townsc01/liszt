import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readStore } from "./store.js";
import { sync } from "./sync.js";
import { enrichStoredCatalogue, validSxyprnUrl } from "./sxyprn.js";
import { createEpornerLookup } from "./eporner.js";
import { createVideoProxy } from "./video-proxy.js";
import sxyprn from "sxyprn";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const dataPath = process.env.LISZT_DATA_PATH || join(root, "data/catalogue.json");
const port = Number(process.env.PORT || 10000);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

export function createLisztServer({ cataloguePath = dataPath, syncCatalogue = () => sync({ paths: [cataloguePath] }), enrichCatalogue = async () => {}, videoDetails = ({ url }) => sxyprn.videos.details({ url }), fetchVideo = fetch } = {}) {
  let refreshInProgress = null;
  let enrichmentInProgress = null;
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
        refreshInProgress ||= Promise.resolve().then(async () => {
          generation++;
          if (enrichmentInProgress) await enrichmentInProgress;
          const data = await syncCatalogue();
          startEnrichment();
          return data;
        }).finally(() => { refreshInProgress = null; });
        const data = await refreshInProgress;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify({ ...data, enrichmentPending: !!enrichmentInProgress }));
      }
      if (url.pathname === "/api/video" || url.pathname === "/api/video/resolve") {
        const id = url.searchParams.get("scene");
        const catalogue = await readStore(cataloguePath);
        const scene = catalogue.scenes?.find((item) => item.id === id);
        const postUrl = scene?.videoUrls?.find((link) => link.source === "sxyprn" && validSxyprnUrl(link.url))?.url;
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
  return app;
}

export const server = createLisztServer({ enrichCatalogue: (options) => enrichStoredCatalogue(dataPath, {
  ...options,
  fallbackLookup: createEpornerLookup(),
  onProgress: (scene) => console.log(`Playback sources checked ${scene.id}: ${scene.videoUrls?.length || 0} link(s)`),
}) });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => {
    console.log(`Liszt is listening at http://localhost:${port}`);
    server.startEnrichment();
  });
}
