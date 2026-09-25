import { isSxyprnVideo, sceneVideoLinks } from "./scene-video.js";

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

export function renderSceneLinks(scene) {
  const source = `<a class="link" href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} source record">Source ↗</a>`;
  const links = sceneVideoLinks(scene);
  const urls = [...new Set(links.filter((link) => link.source === "sxyprn").map((link) => link.url))].filter(isSxyprnVideo);
  const sxyprn = urls.map((url, index) => `<a class="link link--sxyprn" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} on Sxyprn${urls.length > 1 ? ` upload ${index + 1}` : ""}">${urls.length > 1 ? `Sxyprn ${index + 1}` : "Sxyprn"} ↗</a>`).join("");
  const eporner = links.filter((link) => link.source === "eporner" && /^https:\/\/(?:www\.)?eporner\.com\/video-[A-Za-z0-9]+/.test(link.url || ""))
    .map((link) => `<a class="link link--eporner" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} on Eporner">Eporner ↗</a>`).join("");
  return `<div class="scene-links">${source}${sxyprn}${eporner}</div>`;
}
