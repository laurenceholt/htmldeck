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
const agentMessages = document.querySelector("#agentMessages");
const agentForm = document.querySelector("#agentForm");
const agentStatus = document.querySelector("#agentStatus");
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
  document.title = deckTitle();
  galleryLink.textContent = deckTitle();
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

function deckTitle() {
  return deck.title || activePresentation?.title || "HTML Deck";
}

function bindKeys() {
  document.addEventListener("keydown", handleDeckKey);
  agentCloseButton.addEventListener("click", closeAgent);
  versionSelect.addEventListener("change", switchToSelectedVersion);
  agentForm.addEventListener("submit", sendAgentInstruction);
  agentInstruction.addEventListener("keydown", handleAgentInstructionKey);
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
    status.textContent = `Loading ${targetIndex + 1}/${deck.slides.length}`;
    return;
  }

  currentIndex = targetIndex;
  slideViewports.forEach((iframe, slideIndex) => {
    iframe.classList.toggle("is-active", slideIndex === currentIndex);
    iframe.setAttribute("aria-hidden", slideIndex === currentIndex ? "false" : "true");
  });

  status.textContent = `${currentIndex + 1}/${deck.slides.length}`;
  updateAgentSlideLabel();
  if (!agentPanel.hidden) loadAgentContext();
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
  await loadAgentContext();
  agentInstruction.focus();
}

function closeAgent() {
  agentPanel.hidden = true;
}

function updateAgentSlideLabel() {
  if (!deck.slides[currentIndex]) return;
  agentSlideLabel.textContent = `${currentIndex + 1}. ${deck.slides[currentIndex].title || deck.slides[currentIndex].file}`;
}

async function sendAgentInstruction(event) {
  event?.preventDefault();
  const instruction = agentInstruction.value.trim();
  if (!instruction) return;

  appendAgentMessage(instruction, "user");
  agentInstruction.value = "";
  setAgentBusy(true, "Writing...");

  try {
    const data = await callSlideAgent({
      action: "edit",
      instruction,
      html: getCurrentSlideHtml()
    });

    applyCurrentSlideHtml(data.updatedHtml);
    if (Array.isArray(data.history)) {
      renderAgentHistory(data.history);
    } else {
      appendAgentMessage(data.summary || "Updated the slide.");
    }
    await loadVersions();
  } catch (error) {
    appendAgentMessage(error.message, "error");
  } finally {
    setAgentBusy(false);
  }
}

function handleAgentInstructionKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  agentForm.requestSubmit();
}

async function loadAgentContext() {
  await Promise.all([loadVersions(), loadAgentHistory()]);
}

async function loadAgentHistory() {
  if (!activePresentation || !deck.slides[currentIndex]) return;

  try {
    const data = await callSlideAgent({ action: "listHistory" });
    renderAgentHistory(data.history || []);
  } catch (error) {
    if (!isLocalFunctionMiss(error)) appendAgentMessage(error.message, "error");
  }
}

async function loadVersions() {
  if (!activePresentation || !deck.slides[currentIndex]) return;

  setAgentStatus("Loading saved versions...");
  try {
    const data = await callSlideAgent({ action: "listVersions" });
    const versions = data.versions || [];
    const current = document.createElement("option");
    current.value = "";
    current.textContent = versions.length ? "Current version" : "Current version - no saved versions";

    versionSelect.replaceChildren(current, ...versions.map((version, index) => {
      const option = document.createElement("option");
      option.value = version.file;
      const isOriginal = version.isOriginal || index === versions.length - 1;
      const label = isOriginal ? "Original version" : version.label || "Saved version";
      option.textContent = `${formatVersionDate(version.timestamp)} - ${label}`;
      return option;
    }));
    versionSelect.value = "";
  } catch (error) {
    if (!isLocalFunctionMiss(error)) appendAgentMessage(error.message, "error");
  } finally {
    setAgentStatus("");
  }
}

async function switchToSelectedVersion() {
  const versionFile = versionSelect.value;
  if (!versionFile) return;

  setAgentBusy(true, "Switching to selected version...", "Switching...");
  try {
    const data = await callSlideAgent({ action: "restore", versionFile });
    applyCurrentSlideHtml(data.updatedHtml);
    if (Array.isArray(data.history)) {
      renderAgentHistory(data.history);
    } else {
      appendAgentMessage(data.summary || "Switched to the selected version.");
    }
    await loadVersions();
  } catch (error) {
    appendAgentMessage(error.message, "error");
    versionSelect.value = "";
  } finally {
    setAgentBusy(false);
  }
}

async function callSlideAgent(payload) {
  const slide = deck.slides[currentIndex];
  const startedAt = performance.now();
  const action = payload.action || "unknown";
  console.info("[htmldeck] slide agent request started", {
    action,
    presentationId: activePresentation.id,
    slideFile: slide.file
  });

  const response = await fetch("/.netlify/functions/slide-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      presentationId: activePresentation.id,
      slideFile: slide.file,
      ...payload
    })
  });

  const responseText = await response.text();
  const data = parseJsonResponse(responseText);
  const totalSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(3));
  console.info("[htmldeck] slide agent request finished", {
    action,
    status: response.status,
    ok: response.ok,
    totalSeconds,
    timings: data.timings || null
  });

  if (!response.ok) {
    const serverMessage = data.error || responseText.slice(0, 240).trim();
    throw new Error(`Slide agent request failed (HTTP ${response.status}, ${totalSeconds}s): ${serverMessage || "No response body"}`);
  }
  return data;
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
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
  agentMessages.append(createAgentMessage({ text, role: type }));
  agentMessages.scrollTop = agentMessages.scrollHeight;
}

function renderAgentHistory(history) {
  agentMessages.replaceChildren(...history.map(createAgentMessage));
  agentMessages.scrollTop = agentMessages.scrollHeight;
}

function createAgentMessage(messageData) {
  const message = document.createElement("div");
  const role = messageData.role === "user" ? "user" : messageData.role === "error" ? "error" : "assistant";
  const author = document.createElement("div");
  const body = document.createElement("div");

  message.className = `agent-message agent-message--${role}`;
  author.className = "agent-message__author";
  body.className = "agent-message__body";
  author.textContent = role === "user" ? "You" : role === "error" ? "Error" : "htmldeck";
  body.textContent = messageData.text || "";
  message.append(author, body);
  return message;
}

function setAgentBusy(isBusy, message = "") {
  agentSendButton.disabled = isBusy;
  versionSelect.disabled = isBusy;
  agentInstruction.disabled = isBusy;
  setAgentStatus(isBusy ? message : "");
}

function setAgentStatus(message) {
  agentStatus.hidden = !message;
  agentStatus.textContent = message;
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
