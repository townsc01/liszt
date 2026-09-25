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

// Scenes stored before the videoUrls migration carry only legacy sxyprnUrls.
// Mirror src/sxyprn.js legacyLinks() so those scenes stay playable without a data refresh.
export function legacySxyprnLinks(scene) {
  const verifiedAt = scene?.sxyprnCheckedAt || new Date(0).toISOString();
  return (Array.isArray(scene?.sxyprnUrls) ? scene.sxyprnUrls : [])
    .filter(isSxyprnVideo)
    .map((url) => ({ source: "sxyprn", url, embedUrl: null, verifiedAt }));
}

export function sceneVideoLinks(scene) {
  return [...(Array.isArray(scene?.videoUrls) ? scene.videoUrls : []), ...legacySxyprnLinks(scene)];
}

export function topSxyprnUrl(scene) {
  return sceneVideoLinks(scene).find((link) => link?.source === "sxyprn" && isSxyprnVideo(link.url))?.url || null;
}

export function topVideoLink(scene) {
  const links = sceneVideoLinks(scene);
  return links.find((link) => link?.source === "sxyprn") || links.find((link) => link?.source === "eporner") || null;
}
