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
  const eporner = isEpornerVideo(scene.epornerUrl)
    ? `<a class="link link--eporner" href="${escapeHtml(scene.epornerUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} on Eporner">Eporner ↗</a>` : "";
  return `<div class="scene-links">${source}${eporner}</div>`;
}
