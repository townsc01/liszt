const USER_AGENT = "Mozilla/5.0 (compatible; Liszt metadata bot; +https://github.com/townsc01/liszt)";

export const STUDIO_SITE_RECIPES = Object.freeze({
  "sexlikereal.com": { duration: /["']duration["']\s*:\s*["']([^"']+)["']/i },
  "www.sexlikereal.com": { duration: /["']duration["']\s*:\s*["']([^"']+)["']/i },
  "analvids.com": {
    duration: /(?:duration|runtime)[^>]{0,120}(?:content=["']([^"']+)|>\s*([^<]+))/i,
    performers: /(?:starring|performers?|models?)[^>]*>\s*([^<]+)/i,
  },
  "www.analvids.com": {
    duration: /(?:duration|runtime)[^>]{0,120}(?:content=["']([^"']+)|>\s*([^<]+))/i,
    performers: /(?:starring|performers?|models?)[^>]*>\s*([^<]+)/i,
  },
});

// Allowlist of permitted studio hosts derived from STUDIO_SITE_RECIPES
const ALLOWED_HOSTS = Object.freeze(new Set(Object.keys(STUDIO_SITE_RECIPES).map((h) => h.toLowerCase())));

/**
 * Check if a hostname is a private, reserved, or loopback IP address.
 * Returns true if the hostname should be blocked.
 */
function isPrivateOrReservedHost(hostname) {
  try {
    // Check for IP address format (IPv4)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(hostname)) {
      const parts = hostname.split(".").map((n) => Number(n));
      // 10.0.0.0/8
      if (parts[0] === 10) return true;
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 127.0.0.0/8 (localhost)
      if (parts[0] === 127) return true;
      // 169.254.0.0/16 (link-local)
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 0.0.0.0/8
      if (parts[0] === 0) return true;
      // 224.0.0.0/4 (multicast)
      if (parts[0] >= 224 && parts[0] <= 239) return true;
      // 240.0.0.0/4 (reserved)
      if (parts[0] >= 240) return true;
    }
    // Check for localhost and other reserved hostnames
    if (hostname === "localhost" || hostname === "localhost.localdomain") return true;
    // Check for IPv6 loopback and link-local (simplified check)
    if (hostname === "::1" || hostname.startsWith("fe80:")) return true;
    return false;
  } catch {
    // If parsing fails, reject for safety
    return true;
  }
}

/**
 * Validate a URL against the allowlist and private/reserved address checks.
 * Returns true if the URL is safe to fetch.
 */
function isUrlAllowed(url) {
  if (!/^https?:$/.test(url.protocol)) return false;
  const hostname = url.hostname.toLowerCase();
  if (isPrivateOrReservedHost(hostname)) return false;
  if (!ALLOWED_HOSTS.has(hostname)) return false;
  return true;
}

export function parseIsoDuration(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const text = String(value || "").trim();
  const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const seconds = Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0);
    return seconds > 0 ? Math.round(seconds) : null;
  }
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i)?.[1] || 0);
  const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i)?.[1] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? Math.round(total) : null;
}

function cleanText(value) {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&#(?:39|x27);/gi, "'").replace(/&quot;/gi, '"').trim();
}

function names(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.flatMap((item) => {
    if (typeof item === "string") return item.split(/,|\s+(?:and|&)\s+/i);
    return item?.name ? [item.name] : [];
  }).map(cleanText).filter(Boolean))];
}

function visit(value, output) {
  if (Array.isArray(value)) return value.forEach((item) => visit(item, output));
  if (!value || typeof value !== "object") return;
  const type = String(value["@type"] || "").toLowerCase();
  if (!output.durationSec && value.duration) output.durationSec = parseIsoDuration(value.duration);
  if (!output.releaseDate) output.releaseDate = value.datePublished || value.uploadDate || value.releaseDate;
  if (!output.performers?.length) output.performers = names(value.actor || value.actors || value.performer || value.performers || (type === "videoobject" ? value.author : null));
  for (const child of Object.values(value)) if (child && typeof child === "object") visit(child, output);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) result[match[1].toLowerCase()] = cleanText(match[3]);
  return result;
}

export function extractStudioMetadata(html, releaseUrl = "") {
  const output = { durationSec: null, releaseDate: "", performers: [] };
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim()), output); } catch { /* Ignore malformed blocks and try the remaining metadata. */ }
  }
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    const value = attrs.content || attrs.value;
    if (!output.durationSec && /duration/.test(key)) output.durationSec = parseIsoDuration(value);
    if (!output.releaseDate && /(?:datepublished|release_date|published_time|uploaddate)/.test(key)) output.releaseDate = value;
    if (!output.performers.length && /(?:actor|performer|starring)/.test(key)) output.performers = names(value);
  }
  let hostname = "";
  try { hostname = new URL(releaseUrl).hostname.toLowerCase(); } catch { /* Unsupported URL is handled by the caller. */ }
  const recipe = STUDIO_SITE_RECIPES[hostname];
  if (recipe && !output.durationSec) {
    const match = String(html).match(recipe.duration);
    output.durationSec = parseIsoDuration(match?.[1] || match?.[2]);
  }
  if (recipe?.performers && !output.performers.length) {
    const match = String(html).match(recipe.performers);
    output.performers = names(match?.[1] || match?.[2]);
  }
  if (output.releaseDate) output.releaseDate = String(output.releaseDate).slice(0, 10);
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value && (!Array.isArray(value) || value.length)));
}

export function metadataIncomplete(scene) {
  return !scene.durationSec || !scene.releaseDate || !Array.isArray(scene.performers) || scene.performers.length === 0;
}

export async function scrapeStudioSite(scene, { fetchImpl = fetch } = {}) {
  if (!scene?.releaseUrl) return { metadataPoor: true };
  let url;
  try { url = new URL(scene.releaseUrl); } catch { return { metadataPoor: true }; }
  if (!isUrlAllowed(url)) return { metadataPoor: true };
  
  // Follow redirects manually with validation at each step
  const maxRedirects = 10;
  let currentUrl = url;
  let finalResponse = null;
  
  for (let i = 0; i < maxRedirects; i++) {
    try {
      const response = await fetchImpl(currentUrl, { 
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT }, 
        redirect: "manual" 
      });
      
      if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) {
        const location = response.headers.get("location");
        if (!location) break;
        try {
          const nextUrl = new URL(location, currentUrl);
          if (!isUrlAllowed(nextUrl)) return { metadataPoor: true };
          currentUrl = nextUrl;
          continue;
        } catch {
          return { metadataPoor: true };
        }
      }
      
      finalResponse = response;
      break;
    } catch {
      return { metadataPoor: true };
    }
  }
  
  if (!finalResponse || !finalResponse.ok) {
    return { metadataPoor: true, studioSiteStatus: finalResponse?.status };
  }
  
  const metadata = extractStudioMetadata(await finalResponse.text(), finalResponse.url || currentUrl.href);
  if (!Object.keys(metadata).length) return { metadataPoor: true };
  const fields = Object.keys(metadata);
  return { ...metadata, metadataPoor: false, fieldProvenance: Object.fromEntries(fields.map((field) => [field, "studio-site"])) };
}

export async function enrichFromStudioSite(scene, options) {
  const scraped = await scrapeStudioSite(scene, options);
  const enriched = { ...scene };
  const applied = [];
  for (const field of ["durationSec", "releaseDate", "performers"]) {
    if (scraped[field] && (!scene[field] || (Array.isArray(scene[field]) && !scene[field].length) || options?.refreshExisting)) {
      enriched[field] = scraped[field];
      applied.push(field);
    }
  }
  if (applied.length) enriched.fieldProvenance = { ...scene.fieldProvenance,
    ...Object.fromEntries(applied.map((field) => [field, "studio-site"])) };
  enriched.metadataPoor = scraped.metadataPoor;
  if (scraped.studioSiteStatus) enriched.studioSiteStatus = scraped.studioSiteStatus;
  return enriched;
}
