import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const FALLBACK_TTL_MS = 15 * 60 * 1000;
const EXPIRY_SKEW_MS = 60 * 1000;

export function streamExpiry(streamUrl, mintedAt = Date.now()) {
  const pathParts = new URL(streamUrl).pathname.split("/");
  const timestamp = pathParts.find((part) => /^\d{10}$/.test(part));
  const parsed = Number(timestamp) * 1000 - EXPIRY_SKEW_MS;
  return Number.isFinite(parsed) && parsed > mintedAt ? parsed : mintedAt + FALLBACK_TTL_MS;
}

function validateDetail(detail, postUrl) {
  const stream = new URL(detail?.streamUrl || "https://invalid.example/");
  if (detail?.url !== postUrl || stream.protocol !== "https:" || stream.hostname !== "sxyprn.com" || stream.username || stream.password) {
    throw new Error("Invalid Sxyprn video response");
  }
  return stream.href;
}

export function createVideoProxy({ videoDetails, fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map();
  const pending = new Map();

  async function mint(sceneId, postUrl, force = false) {
    const cached = cache.get(sceneId);
    if (!force && cached?.postUrl === postUrl && cached.expiresAt > now()) return cached.streamUrl;
    if (pending.has(sceneId)) return pending.get(sceneId);
    const operation = Promise.resolve(videoDetails({ url: postUrl })).then((detail) => {
      const streamUrl = validateDetail(detail, postUrl);
      cache.set(sceneId, { postUrl, streamUrl, expiresAt: streamExpiry(streamUrl, now()) });
      return streamUrl;
    }).finally(() => pending.delete(sceneId));
    pending.set(sceneId, operation);
    return operation;
  }

  async function upstream(sceneId, postUrl, range, signal, retry = true, impl = fetchImpl) {
    const streamUrl = await mint(sceneId, postUrl);
    // The timeout covers only a stalled connect/headers; once the upstream response
    // arrives it must not kill a healthy long stream mid-transfer.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 30_000);
    let result;
    try {
      result = await impl(streamUrl, {
        headers: range ? { range } : {},
        redirect: "follow",
        signal: AbortSignal.any([signal, timeout.signal]),
      });
    } finally {
      clearTimeout(timer);
    }
    const invalidToken = result.headers.get("content-type")?.toLowerCase().startsWith("text/html");
    if (invalidToken && retry) {
      await result.body?.cancel();
      cache.delete(sceneId);
      await mint(sceneId, postUrl, true);
      return upstream(sceneId, postUrl, range, signal, false, impl);
    }
    if (invalidToken || ![200, 206].includes(result.status) || !result.body) {
      await result.body?.cancel();
      throw new Error(`Sxyprn stream returned ${result.status}`);
    }
    return result;
  }

  return {
    resolve: mint,
    async stream(sceneId, postUrl, request, response, { fetchImpl: override } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once("aborted", abort);
      response.once("close", () => { if (!response.writableEnded) abort(); });
      const result = await upstream(sceneId, postUrl, request.headers.range, controller.signal, true, override ?? fetchImpl);
      const headers = { "cache-control": "no-store" };
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = result.headers.get(name);
        if (value) headers[name] = value;
      }
      response.writeHead(result.status, headers);
      await pipeline(Readable.fromWeb(result.body), response);
    },
  };
}
