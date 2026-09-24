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
  return Array.isArray(scene?.sxyprnUrls) ? scene.sxyprnUrls.find(isSxyprnVideo) || null : null;
}
