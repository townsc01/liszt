const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function isEpornerVideo(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["eporner.com", "www.eporner.com"].includes(url.hostname) &&
      /^\/(?:video-[A-Za-z0-9]+|hd-porn\/[A-Za-z0-9]+)(?:\/[^?#]*)?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function renderSceneLinks(scene) {
  const source = `<a class="link" href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} source record">Source ↗</a>`;
  const urls = [...new Set(Array.isArray(scene.epornerUrls) ? scene.epornerUrls : [])].filter(isEpornerVideo);
  const eporner = urls.map((url, index) => `<a class="link link--eporner" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} on Eporner${urls.length > 1 ? ` upload ${index + 1}` : ""}">${urls.length > 1 ? `Eporner ${index + 1}` : "Eporner"} ↗</a>`).join("");
  return `<div class="scene-links">${source}${eporner}</div>`;
}
