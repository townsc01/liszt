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

function legacySxyprnLinks(scene) {
  const verifiedAt = scene?.sxyprnCheckedAt || new Date(0).toISOString();
  return (scene?.sxyprnUrls || []).filter(isSxyprnVideo).map((url) => ({ source: "sxyprn", url, embedUrl: null, verifiedAt }));
}

export function sxyprnLinks(scene) {
  const current = Array.isArray(scene?.videoUrls) ? scene.videoUrls.filter((link) => link?.source === "sxyprn" && isSxyprnVideo(link.url)) : [];
  const merged = [...current, ...legacySxyprnLinks(scene)];
  return merged.filter((link, index) => merged.findIndex((item) => item.url === link.url) === index);
}

export function topSxyprnUrl(scene) {
  return sxyprnLinks(scene)[0]?.url || null;
}

export function topVideoLink(scene) {
  return sxyprnLinks(scene)[0] || (Array.isArray(scene?.videoUrls) ? scene.videoUrls.find((link) => link?.source === "eporner") : null) || null;
}
