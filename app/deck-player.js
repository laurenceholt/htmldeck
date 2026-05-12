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
const agentTimingLog = document.querySelector("#agentTimingLog");

const directOpenAIModel = "gpt-5.4-mini";
const openAIKeyStorageKey = "htmldeck.openaiApiKey";
const maxRenderedVersions = 35;
const maxRenderedMessages = 24;

let presentationIndex = { presentations: [] };
let activePresentation = null;
let deck = { slides: [] };
let currentIndex = 0;
let notesVisible = false;
let slideViewports = [];
let slideNotes = [];
let slideLoaded = [];
let pendingIndex = null;
let currentTimingRun = null;
const agentContextCache = new Map();
const agentContextRequests = new Map();

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
    iframe.src = resolveSlideFrameUrl(slide.file);
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
  preloadAgentContext(currentIndex);
  if (!agentPanel.hidden) loadAgentContext({ background: true });
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

function openAgent() {
  agentPanel.hidden = false;
  document.body.classList.add("agent-open");
  updateAgentSlideLabel();
  renderCachedAgentContext();
  loadAgentContext({ background: true });
  agentInstruction.focus();
}

function closeAgent() {
  agentPanel.hidden = true;
  document.body.classList.remove("agent-open");
}

function updateAgentSlideLabel() {
  if (!deck.slides[currentIndex]) return;
  agentSlideLabel.textContent = `${currentIndex + 1}. ${deck.slides[currentIndex].title || deck.slides[currentIndex].file}`;
}

async function sendAgentInstruction(event) {
  event?.preventDefault();
  const instruction = agentInstruction.value.trim();
  if (!instruction) return;

  beginAgentTiming();
  appendAgentMessage(instruction, "user");
  agentInstruction.value = "";
  setAgentBusy(true, "Working...");

  try {
    const captureStartedAt = performance.now();
    const currentHtml = getCurrentSlideHtml();
    addAgentTiming("Capture slide HTML", elapsedSeconds(captureStartedAt));

    const updated = await callOpenAIDirect(instruction, currentHtml);
    addAgentTiming("OpenAI direct call", updated.timing?.totalSeconds, `${directOpenAIModel}, HTTP ${updated.timing?.status || "?"}`);
    setAgentBusy(true, "Working...");

    const data = await callSlideAgent({
      action: "saveEdit",
      instruction,
      html: currentHtml,
      updatedHtml: updated.updatedHtml,
      summary: updated.summary,
      clientTimings: currentTimingRun?.steps || []
    });
    addAgentTiming("Netlify save request", data.clientTiming?.totalSeconds, `HTTP ${data.clientTiming?.status || "?"}`);
    addServerTimings(data.timings);

    applyCurrentSlideHtml(data.updatedHtml);
    if (Array.isArray(data.history)) {
      renderAgentHistory(data.history);
      updateAgentContextCache({ history: data.history });
    } else {
      appendAgentMessage(data.summary || "Updated the slide.");
    }
    if (data.version) addSavedVersionToCache(data.version);
  } catch (error) {
    addAgentTiming("Error", elapsedSeconds(), error.message);
    appendAgentMessage(error.message, "error");
  } finally {
    addAgentTiming("Total", elapsedSeconds());
    setAgentBusy(false);
  }
}

async function callOpenAIDirect(instruction, html) {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("Add an OpenAI API key in the gallery before using the slide agent.");
  }

  const startedAt = performance.now();
  const requestBody = {
    model: directOpenAIModel,
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You edit a single standalone HTML presentation slide. Return the full updated HTML document. Preserve existing scripts, speaker notes JSON, relative asset paths, accessibility labels, and slide structure unless the user explicitly asks to change them. Pay attention to the look and feel of changes you make. Make them in the same style, colors, fonts as the existing slide where possible. Try to make them professional and elegant. Do not add markdown fences."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Instruction:\n${instruction}\n\nCurrent HTML:\n${html}`
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "slide_edit",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            updatedHtml: { type: "string" }
          },
          required: ["summary", "updatedHtml"]
        }
      }
    }
  };

  console.info("[htmldeck] direct OpenAI request started", {
    model: directOpenAIModel,
    htmlLength: html.length,
    instructionLength: instruction.length
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const responseText = await response.text();
  const data = parseJsonResponse(responseText);
  const totalSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(3));

  console.info("[htmldeck] direct OpenAI request finished", {
    status: response.status,
    ok: response.ok,
    totalSeconds
  });

  if (!response.ok) {
    const message = data.error?.message || responseText.slice(0, 240).trim() || "OpenAI request failed";
    throw new Error(`OpenAI request failed (HTTP ${response.status}, ${totalSeconds}s): ${message}`);
  }

  const text = data.output_text || extractOutputText(data);
  const parsed = JSON.parse(text);
  if (!parsed.updatedHtml?.includes("<html")) {
    throw new Error("OpenAI did not return a full HTML document.");
  }
  parsed.timing = { totalSeconds, status: response.status };
  return parsed;
}

function extractOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("");
}

function getOpenAIKey() {
  return localStorage.getItem(openAIKeyStorageKey) || "";
}

function handleAgentInstructionKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  agentForm.requestSubmit();
}

async function loadAgentContext({ background = false } = {}) {
  const key = slideCacheKey();
  if (!key) return null;
  if (agentContextRequests.has(key)) return agentContextRequests.get(key);

  const request = loadAgentContextFresh(background).finally(() => {
    agentContextRequests.delete(key);
  });
  agentContextRequests.set(key, request);
  return request;
}

async function loadAgentContextFresh(background) {
  if (!background) setAgentStatus("Loading slide context...");
  try {
    const data = await callSlideAgent({ action: "listContext" });
    const context = {
      versions: data.versions || [],
      history: data.history || []
    };
    updateAgentContextCache(context);
    if (!agentPanel.hidden) renderAgentContext(context);
    return context;
  } catch (error) {
    if (!isLocalFunctionMiss(error) && !background) appendAgentMessage(error.message, "error");
    return null;
  } finally {
    if (!background) setAgentStatus("");
  }
}

function preloadAgentContext(index) {
  const key = slideCacheKey(index);
  if (!key || agentContextCache.has(key) || agentContextRequests.has(key)) return;
  loadAgentContext({ background: true });
}

function renderCachedAgentContext() {
  const context = agentContextCache.get(slideCacheKey());
  if (context) renderAgentContext(context);
}

function renderAgentContext(context) {
  renderVersionOptions(context.versions || []);
  renderAgentHistory(context.history || []);
}

function updateAgentContextCache(partial) {
  const key = slideCacheKey();
  if (!key) return;
  const current = agentContextCache.get(key) || { versions: [], history: [] };
  agentContextCache.set(key, { ...current, ...partial });
}

function addSavedVersionToCache(version) {
  const key = slideCacheKey();
  if (!key) return;

  const current = agentContextCache.get(key) || { versions: [], history: [] };
  const versions = [version, ...(current.versions || [])];
  agentContextCache.set(key, { ...current, versions });
  renderVersionOptions(versions);
}

async function loadAgentHistory() {
  if (!activePresentation || !deck.slides[currentIndex]) return;

  try {
    const data = await callSlideAgent({ action: "listHistory" });
    renderAgentHistory(data.history || []);
    updateAgentContextCache({ history: data.history || [] });
  } catch (error) {
    if (!isLocalFunctionMiss(error)) appendAgentMessage(error.message, "error");
  }
}

async function loadVersions() {
  if (!activePresentation || !deck.slides[currentIndex]) return;

  setAgentStatus("Loading saved versions...");
  try {
    const data = await callSlideAgent({ action: "listVersions" });
    renderVersionOptions(data.versions || []);
    updateAgentContextCache({ versions: data.versions || [] });
  } catch (error) {
    if (!isLocalFunctionMiss(error)) appendAgentMessage(error.message, "error");
  } finally {
    setAgentStatus("");
  }
}

function renderVersionOptions(versions) {
  const renderedVersions = trimVersionsForRender(versions);
  const current = document.createElement("option");
  current.value = "";
  current.textContent = versions.length ? "Current version" : "Current version - no saved versions";

  versionSelect.replaceChildren(current, ...renderedVersions.map((version, index) => {
    const option = document.createElement("option");
    option.value = version.file;
    const isOriginal = version.isOriginal || index === renderedVersions.length - 1;
    const label = isOriginal ? "Original version" : version.label || "Saved version";
    option.textContent = `${formatVersionDate(version.timestamp)} - ${label}`;
    return option;
  }));
  versionSelect.value = "";
}

function trimVersionsForRender(versions) {
  if (versions.length <= maxRenderedVersions) return versions;
  const original = versions.find((version) => version.isOriginal) || versions[versions.length - 1];
  const recent = versions.slice(0, maxRenderedVersions - 1);
  return recent.some((version) => version.file === original.file) ? recent : [...recent, original];
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
      updateAgentContextCache({ history: data.history });
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
  data.clientTiming = { totalSeconds, status: response.status };
  return data;
}

function beginAgentTiming() {
  currentTimingRun = {
    startedAt: performance.now(),
    steps: []
  };
  addAgentTiming("Request started", 0);
}

function addAgentTiming(label, seconds = elapsedSeconds(), detail = "") {
  if (!currentTimingRun) return;
  currentTimingRun.steps.push({
    label,
    seconds: Number(seconds || 0),
    detail
  });
  renderAgentTimings();
}

function addServerTimings(timings) {
  if (!timings?.steps) return;
  timings.steps
    .filter((step) => typeof step.durationSeconds === "number")
    .forEach((step) => {
      addAgentTiming(`Server: ${humanizeTimingStep(step.step)}`, step.durationSeconds);
    });
  if (typeof timings.totalSeconds === "number") {
    addAgentTiming("Server total", timings.totalSeconds, timings.requestId || "");
  }
}

function renderAgentTimings() {
  if (!agentTimingLog || !currentTimingRun) return;
  agentTimingLog.hidden = false;
  agentTimingLog.replaceChildren(...currentTimingRun.steps.map((step) => {
    const row = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("span");

    row.className = "agent-timing-log__row";
    label.className = "agent-timing-log__label";
    value.className = "agent-timing-log__value";
    label.textContent = step.detail ? `${step.label} - ${step.detail}` : step.label;
    value.textContent = `${step.seconds.toFixed(2)}s`;
    row.append(label, value);
    return row;
  }));
}

function humanizeTimingStep(step) {
  return String(step || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function elapsedSeconds(startedAt = currentTimingRun?.startedAt || performance.now()) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(3));
}

function slideCacheKey(index = currentIndex) {
  const slide = deck.slides[index];
  return activePresentation && slide ? `${activePresentation.id}:${slide.file}` : "";
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
  iframe.srcdoc = addBaseHref(html, resolveStaticSlideUrl(deck.slides[currentIndex].file));
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
  const renderedHistory = history.slice(-maxRenderedMessages);
  agentMessages.replaceChildren(...renderedHistory.map(createAgentMessage));
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
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
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

function resolveSlideFrameUrl(file) {
  if (isLocalStaticMode()) return resolveStaticSlideUrl(file);
  const params = new URLSearchParams({
    presentation: activePresentation.id,
    slide: file.replace(/^\.?\//, "")
  });
  return `/.netlify/functions/slide-html?${params.toString()}`;
}

function resolveStaticSlideUrl(file) {
  if (/^(https?:)?\/\//.test(file) || file.startsWith("/")) return file;
  return `${activePresentation.folder}/${file.replace(/^\.?\//, "")}`;
}

function isLocalStaticMode() {
  return location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(location.hostname);
}

function readSlideFromUrl() {
  const value = Number(new URLSearchParams(window.location.search).get("slide"));
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
