import { readSpeakerNotes } from "./slide-notes.js";

const slideFrame = document.querySelector("#slideFrame");
const status = document.querySelector("#slideStatus");
const notesPanel = document.querySelector("#speakerNotes");
const notesContent = document.querySelector("#speakerNotesContent");
const blackCover = document.querySelector("#blackCover");
const whiteCover = document.querySelector("#whiteCover");
const galleryLink = document.querySelector("#galleryLink");
const agentPanel = document.querySelector("#agentPanel");
const agentCloseButton = document.querySelector("#agentCloseButton");
const agentSlideLabel = document.querySelector("#agentSlideLabel");
const versionSelect = document.querySelector("#versionSelect");
const refreshVersionsButton = document.querySelector("#refreshVersionsButton");
const restoreVersionButton = document.querySelector("#restoreVersionButton");
const agentMessages = document.querySelector("#agentMessages");
const agentForm = document.querySelector("#agentForm");
const agentInstruction = document.querySelector("#agentInstruction");
const agentSendButton = document.querySelector("#agentSendButton");

let presentationIndex = { presentations: [] };
let activePresentation = null;
let deck = { slides: [] };
let currentIndex = 0;
let notesVisible = false;
let slideViewports = [];
let slideNotes = [];
let slideLoaded = [];
let pendingIndex = null;

init();

async function init() {
  presentationIndex = await loadJson("presentations/index.json");
  activePresentation = findInitialPresentation();
  if (!activePresentation) {
    status.textContent = "No presentations";
    return;
  }

  galleryLink.href = `index.html?presentation=${encodeURIComponent(activePresentation.id)}`;
  deck = await loadJson(activePresentation.deck);
  document.title = deck.title || activePresentation.title || "HTML Deck";
  currentIndex = clamp(readSlideFromUrl(), 0, Math.max(deck.slides.length - 1, 0));
  buildSlideViewports();
  bindKeys();
  showSlide(currentIndex, false);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json();
}

function findInitialPresentation() {
  const requested = new URLSearchParams(window.location.search).get("presentation");
  return presentationIndex.presentations.find((presentation) => presentation.id === requested)
    || presentationIndex.presentations[0]
    || null;
}

function bindKeys() {
  document.addEventListener("keydown", handleDeckKey);
  agentCloseButton.addEventListener("click", closeAgent);
  refreshVersionsButton.addEventListener("click", loadVersions);
  restoreVersionButton.addEventListener("click", restoreSelectedVersion);
  agentForm.addEventListener("submit", sendAgentInstruction);
}

function buildSlideViewports() {
  slideViewports = deck.slides.map((slide, index) => {
    const iframe = document.createElement("iframe");
    iframe.title = slide.title || `Slide ${index + 1}`;
    iframe.src = resolveSlideUrl(slide.file);
    iframe.dataset.slideIndex = String(index);
    iframe.addEventListener("load", () => {
      slideLoaded[index] = true;
      readNotesFromViewport(index);
      bindSlideKeys(iframe);
      if (index === pendingIndex) {
        pendingIndex = null;
        showSlide(index);
        return;
      }
      if (index === currentIndex) updateNotesFromSlide();
    });
    slideFrame.append(iframe);
    return iframe;
  });
}

function showSlide(index, pushState = true) {
  if (!deck.slides.length) {
    status.textContent = "No slides";
    return;
  }

  const targetIndex = clamp(index, 0, deck.slides.length - 1);
  if (!slideLoaded[targetIndex] && slideViewports.some((iframe) => iframe.classList.contains("is-active"))) {
    pendingIndex = targetIndex;
    status.textContent = `Loading ${targetIndex + 1} / ${deck.slides.length}`;
    return;
  }

  currentIndex = targetIndex;
  slideViewports.forEach((iframe, slideIndex) => {
    iframe.classList.toggle("is-active", slideIndex === currentIndex);
    iframe.setAttribute("aria-hidden", slideIndex === currentIndex ? "false" : "true");
  });

  status.textContent = `${currentIndex + 1} / ${deck.slides.length}`;
  updateAgentSlideLabel();
  updateNotesFromSlide();
  hideCovers();

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set("presentation", activePresentation.id);
    url.searchParams.set("slide", String(currentIndex + 1));
    window.history.replaceState(null, "", url);
  }
}

function updateNotesFromSlide() {
  const notes = slideNotes[currentIndex] || "";
  notesContent.textContent = notes || "No speaker notes for this slide.";
  if (notesVisible) setNotesVisible(true);
}

function readNotesFromViewport(index) {
  const doc = slideViewports[index]?.contentDocument;
  slideNotes[index] = doc ? readSpeakerNotes(doc) : "";
}

function bindSlideKeys(iframe) {
  const slideDoc = iframe.contentDocument;
  if (!slideDoc || slideDoc.documentElement.dataset.deckKeysBound) return;
  slideDoc.documentElement.dataset.deckKeysBound = "true";
  slideDoc.addEventListener("keydown", handleDeckKey);
}

function handleDeckKey(event) {
  if (event.defaultPrevented || isEditableTarget(event.target)) return;

  if (event.key === "Escape" || event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (!agentPanel.hidden && event.key === "Escape") {
      closeAgent();
    } else {
      openGallery();
    }
    return;
  }

  if (event.key.toLowerCase() === "a") {
    event.preventDefault();
    openAgent();
    return;
  }

  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    showSlide(currentIndex + 1);
  }

  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    showSlide(currentIndex - 1);
  }

  if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    toggleCover("black");
  }

  if (event.key.toLowerCase() === "w") {
    event.preventDefault();
    toggleCover("white");
  }

  if (event.key === " ") {
    event.preventDefault();
    setNotesVisible(!notesVisible);
  }
}

function openGallery() {
  window.location.href = `index.html?presentation=${encodeURIComponent(activePresentation.id)}`;
}

async function openAgent() {
  agentPanel.hidden = false;
  updateAgentSlideLabel();
  agentInstruction.focus();
  await loadVersions();
}

function closeAgent() {
  agentPanel.hidden = true;
}

function updateAgentSlideLabel() {
  if (!deck.slides[currentIndex]) return;
  agentSlideLabel.textContent = `${currentIndex + 1}. ${deck.slides[currentIndex].title || deck.slides[currentIndex].file}`;
}

async function sendAgentInstruction(event) {
  event.preventDefault();
  const instruction = agentInstruction.value.trim();
  if (!instruction) return;

  appendAgentMessage(instruction, "user");
  agentInstruction.value = "";
  setAgentBusy(true);

  try {
    const data = await callSlideAgent({
      action: "edit",
      instruction,
      html: getCurrentSlideHtml()
    });

    applyCurrentSlideHtml(data.updatedHtml);
    appendAgentMessage(data.summary || "Updated the slide.");
    await loadVersions();
  } catch (error) {
    appendAgentMessage(error.message, "error");
  } finally {
    setAgentBusy(false);
  }
}

async function loadVersions() {
  if (!activePresentation || !deck.slides[currentIndex]) return;

  try {
    const data = await callSlideAgent({ action: "listVersions" });
    const versions = data.versions || [];
    versionSelect.replaceChildren(...versions.map((version) => {
      const option = document.createElement("option");
      option.value = version.file;
      option.textContent = `${formatVersionDate(version.timestamp)} - ${version.label || "Saved version"}`;
      return option;
    }));

    if (!versions.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved versions";
      versionSelect.replaceChildren(option);
    }
  } catch (error) {
    if (!isLocalFunctionMiss(error)) appendAgentMessage(error.message, "error");
  }
}

async function restoreSelectedVersion() {
  const versionFile = versionSelect.value;
  if (!versionFile) return;

  setAgentBusy(true);
  try {
    const data = await callSlideAgent({ action: "restore", versionFile });
    applyCurrentSlideHtml(data.updatedHtml);
    appendAgentMessage(data.summary || "Restored the selected version.");
    await loadVersions();
  } catch (error) {
    appendAgentMessage(error.message, "error");
  } finally {
    setAgentBusy(false);
  }
}

async function callSlideAgent(payload) {
  const slide = deck.slides[currentIndex];
  const response = await fetch("/.netlify/functions/slide-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      presentationId: activePresentation.id,
      slideFile: slide.file,
      ...payload
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Slide agent request failed.");
  return data;
}

function getCurrentSlideHtml() {
  const iframe = slideViewports[currentIndex];
  const doc = iframe?.contentDocument;
  if (!doc) throw new Error("Current slide is not ready.");
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelector("base[data-html-deck-base]")?.remove();
  return `<!doctype html>\n${clone.outerHTML}`;
}

function applyCurrentSlideHtml(html) {
  const iframe = slideViewports[currentIndex];
  iframe.srcdoc = addBaseHref(html, resolveSlideUrl(deck.slides[currentIndex].file));
}

function addBaseHref(html, slideUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const existingBase = doc.querySelector("base[data-html-deck-base]");
  const href = new URL(slideUrl, window.location.href).href;

  if (existingBase) {
    existingBase.href = href;
  } else {
    const base = doc.createElement("base");
    base.href = href;
    base.dataset.htmlDeckBase = "true";
    doc.head.prepend(base);
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function appendAgentMessage(text, type = "agent") {
  const message = document.createElement("div");
  message.className = `agent-message agent-message--${type}`;
  message.textContent = text;
  agentMessages.append(message);
  agentMessages.scrollTop = agentMessages.scrollHeight;
}

function setAgentBusy(isBusy) {
  agentSendButton.disabled = isBusy;
  restoreVersionButton.disabled = isBusy;
  refreshVersionsButton.disabled = isBusy;
}

function formatVersionDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function isLocalFunctionMiss(error) {
  return error.message === "Slide agent request failed." && location.hostname === "127.0.0.1";
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function setNotesVisible(visible) {
  notesVisible = visible;
  notesPanel.hidden = !visible;
}

function toggleCover(color) {
  const target = color === "black" ? blackCover : whiteCover;
  const other = color === "black" ? whiteCover : blackCover;
  const shouldShow = target.hidden;
  other.hidden = true;
  target.hidden = !shouldShow;
}

function hideCovers() {
  blackCover.hidden = true;
  whiteCover.hidden = true;
}

function resolveSlideUrl(file) {
  if (/^(https?:)?\/\//.test(file) || file.startsWith("/")) return file;
  return `${activePresentation.folder}/${file.replace(/^\.?\//, "")}`;
}

function readSlideFromUrl() {
  const value = Number(new URLSearchParams(window.location.search).get("slide"));
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
