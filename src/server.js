import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readStore } from "./store.js";
import { sync } from "./sync.js";
import { discoverStudio } from "./discovery.js";
import { addStudio } from "./studio-store.js";
import { randomUUID, timingSafeEqual } from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const dataPath = process.env.LISZT_DATA_PATH || join(root, "data/catalogue.json");
const port = Number(process.env.PORT || 3000);
const studiosPath = process.env.LISZT_STUDIOS_PATH || join(root, "data/studios.json");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

async function jsonBody(request, limit = 4096) {
  let body = "";
  for await (const chunk of request) { body += chunk; if (body.length > limit) throw Object.assign(new Error("Request body is too large"), { status: 413 }); }
  try { return JSON.parse(body || "{}"); } catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

function authenticated(request, token) {
  if (!token) return false;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createLisztServer({ cataloguePath = dataPath, studioDefinitionsPath = studiosPath, authToken = process.env.LISZT_ADMIN_TOKEN, discover = discoverStudio, syncCatalogue } = {}) {
  let refreshInProgress = null;
  const previews = new Map();
  const jobs = new Map();
  const runSync = syncCatalogue || (() => sync({ paths: [cataloguePath], studiosPath: studioDefinitionsPath }));

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const allowedOrigin = process.env.LISZT_ALLOWED_ORIGIN;
      if (allowedOrigin && request.headers.origin === allowedOrigin) {
        response.setHeader("access-control-allow-origin", allowedOrigin);
        response.setHeader("vary", "Origin");
        response.setHeader("access-control-allow-headers", "authorization, content-type");
        response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      }
      if (request.method === "OPTIONS") { response.writeHead(204); return response.end(); }
      if (url.pathname === "/api/scenes") {
        const data = await readStore(cataloguePath);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify(data));
      }
      if (url.pathname === "/api/refresh") {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
          return response.end(JSON.stringify({ error: "Method not allowed" }));
        }
        if (!authenticated(request, authToken)) { response.writeHead(401, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "A valid admin bearer token is required" })); }
        refreshInProgress ||= Promise.resolve().then(runSync).finally(() => { refreshInProgress = null; });
        const data = await refreshInProgress;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify(data));
      }
      if (url.pathname === "/api/studios/preview" && request.method === "POST") {
        if (!authenticated(request, authToken)) { response.writeHead(401, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "A valid admin bearer token is required" })); }
        const preview = await discover((await jsonBody(request)).url);
        const previewId = randomUUID();
        previews.set(previewId, { preview, expires: Date.now() + 15 * 60_000 });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify({ previewId, ...preview }));
      }
      if (url.pathname === "/api/studios" && request.method === "POST") {
        if (!authenticated(request, authToken)) { response.writeHead(401, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "A valid admin bearer token is required" })); }
        const { previewId } = await jsonBody(request);
        const cached = previews.get(previewId);
        if (!cached || cached.expires < Date.now()) { response.writeHead(400, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "Preview is missing or expired; preview the website again" })); }
        if (!cached.preview.supported) { response.writeHead(422, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: `Studio remains pending: missing ${cached.preview.missing.join(", ")}` })); }
        const jobId = randomUUID();
        jobs.set(jobId, { id: jobId, state: "saving" });
        Promise.resolve().then(async () => {
          const result = await addStudio(studioDefinitionsPath, cached.preview);
          jobs.set(jobId, { id: jobId, state: "syncing", studio: result.studio, duplicate: !result.created });
          const catalogue = await runSync();
          jobs.set(jobId, { id: jobId, state: "complete", studio: result.studio, duplicate: !result.created, catalogue });
        }).catch((error) => jobs.set(jobId, { id: jobId, state: "failed", error: error.message }));
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        return response.end(JSON.stringify({ jobId, state: "saving" }));
      }
      if (url.pathname.startsWith("/api/jobs/") && request.method === "GET") {
        if (!authenticated(request, authToken)) { response.writeHead(401, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "A valid admin bearer token is required" })); }
        const job = jobs.get(url.pathname.split("/").pop());
        response.writeHead(job ? 200 : 404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify(job || { error: "Job not found" }));
      }
      const requested = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
      const path = join(publicRoot, requested);
      if (!path.startsWith(publicRoot)) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      const body = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: status === 500 ? error.message || "Something went wrong" : error.message || "Not found" }));
    }
  });
}

export const server = createLisztServer();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Liszt is listening at http://localhost:${port}`));
}
