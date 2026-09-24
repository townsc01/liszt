export function isEpornerVideo(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["eporner.com", "www.eporner.com"].includes(url.hostname) &&
      /^\/(?:video-[A-Za-z0-9]+|hd-porn\/[A-Za-z0-9]+)(?:\/[^?#]*)?$/.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function topEpornerUrl(scene) {
  return Array.isArray(scene?.epornerUrls) ? scene.epornerUrls.find(isEpornerVideo) || null : null;
}

export function epornerEmbedUrl(value) {
  if (!isEpornerVideo(value)) return null;
  const path = new URL(value).pathname;
  const id = path.match(/^\/(?:video-|hd-porn\/)([A-Za-z0-9]+)/)?.[1];
  return id ? `https://www.eporner.com/embed/${id}/` : null;
}
