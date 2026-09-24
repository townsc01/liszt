import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readStore } from "./store.js";
import { sync } from "./sync.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const dataPath = process.env.LISZT_DATA_PATH || join(root, "data/catalogue.json");
const port = Number(process.env.PORT || 3000);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

export function createLisztServer({ cataloguePath = dataPath, syncCatalogue = () => sync({ paths: [cataloguePath] }) } = {}) {
  let refreshInProgress = null;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
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
        refreshInProgress ||= Promise.resolve().then(syncCatalogue).finally(() => { refreshInProgress = null; });
        const data = await refreshInProgress;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify(data));
      }
      const requested = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
      const path = join(publicRoot, requested);
      if (!path.startsWith(publicRoot)) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      const body = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "Not found" : "Something went wrong");
    }
  });
}

export const server = createLisztServer();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Liszt is listening at http://localhost:${port}`));
}
