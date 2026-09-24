import { isSxyprnVideo } from "./scene-video.js";

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

export function renderSceneLinks(scene) {
  const source = `<a class="link" href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} source record">Source ↗</a>`;
  const urls = [...new Set(Array.isArray(scene.sxyprnUrls) ? scene.sxyprnUrls : [])].filter(isSxyprnVideo);
  const sxyprn = urls.map((url, index) => `<a class="link link--sxyprn" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} on Sxyprn${urls.length > 1 ? ` upload ${index + 1}` : ""}">${urls.length > 1 ? `Sxyprn ${index + 1}` : "Sxyprn"} ↗</a>`).join("");
  return `<div class="scene-links">${source}${sxyprn}</div>`;
}
