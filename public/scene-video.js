export function isSxyprnVideo(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "sxyprn.com" &&
      /^\/post\/[a-f0-9]{13}\.html$/.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function topSxyprnUrl(scene) {
  return Array.isArray(scene?.videoUrls) ? scene.videoUrls.find((link) => link?.source === "sxyprn" && isSxyprnVideo(link.url))?.url || null : null;
}

export function topVideoLink(scene) {
  return Array.isArray(scene?.videoUrls) ? scene.videoUrls.find((link) => link?.source === "sxyprn") || scene.videoUrls.find((link) => link?.source === "eporner") || null : null;
}
