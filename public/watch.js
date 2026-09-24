import { epornerEmbedUrl, topEpornerUrl } from "./scene-video.js";

const content = document.querySelector("#watch-content");

function showUnavailable() {
  content.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Video unavailable";
  const message = document.createElement("p");
  message.textContent = "This scene has no verified video available to play.";
  content.append(heading, message);
  document.title = "Video unavailable · Liszt";
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function showScene(scene, sourceUrl) {
  content.replaceChildren();
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Watch · " + scene.studio;
  const heading = document.createElement("h1");
  heading.textContent = scene.title;
  const metadata = document.createElement("p");
  metadata.className = "watch-metadata";
  const date = new Date(`${scene.releaseDate}T12:00:00Z`);
  const releaseDate = Number.isNaN(date.getTime()) ? scene.releaseDate : date.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  metadata.textContent = [releaseDate, ...(Array.isArray(scene.performers) ? scene.performers : [])].filter(Boolean).join(" · ");

  const player = document.createElement("div");
  player.className = "watch-player";
  const iframe = document.createElement("iframe");
  iframe.src = epornerEmbedUrl(sourceUrl);
  iframe.title = `Video player for ${scene.title}`;
  iframe.allow = "autoplay; fullscreen; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  player.append(iframe);

  const links = document.createElement("div");
  links.className = "watch-links";
  const eporner = document.createElement("a");
  eporner.href = sourceUrl;
  eporner.target = "_blank";
  eporner.rel = "noopener noreferrer";
  eporner.textContent = "Open on EPORNER ↗";
  links.append(eporner);
  const source = safeExternalUrl(scene.releaseUrl);
  if (source) {
    const sourceLink = document.createElement("a");
    sourceLink.href = source;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "Source record ↗";
    links.append(sourceLink);
  }
  content.append(eyebrow, heading, metadata, player, links);
  document.title = `${scene.title} · Liszt`;
}

try {
  const id = new URL(location.href).searchParams.get("scene");
  if (!id) throw new Error("Missing scene");
  const response = await fetch("/api/scenes", { cache: "no-store" });
  if (!response.ok) throw new Error("Catalogue unavailable");
  const catalogue = await response.json();
  const scene = Array.isArray(catalogue.scenes) ? catalogue.scenes.find((item) => item.id === id) : null;
  const sourceUrl = topEpornerUrl(scene);
  if (scene && sourceUrl && epornerEmbedUrl(sourceUrl)) showScene(scene, sourceUrl);
  else showUnavailable();
} catch {
  showUnavailable();
}
