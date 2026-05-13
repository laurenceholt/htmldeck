import { readSpeakerNotes, writeSpeakerNotes } from "./slide-notes.js";

const presentationList = document.querySelector("#presentationList");
const presentationCount = document.querySelector("#presentationCount");
const currentPresentationTitle = document.querySelector("#currentPresentationTitle");
const currentPresentationPath = document.querySelector("#currentPresentationPath");
const presentButton = document.querySelector("#presentButton");
const slideList = document.querySelector("#slideList");
const addSlideButton = document.querySelector("#addSlideButton");
const downloadHtmlButton = document.querySelector("#downloadHtmlButton");
const downloadDeckButton = document.querySelector("#downloadDeckButton");
const saveGithubButton = document.querySelector("#saveGithubButton");
const downloadSlideButton = document.querySelector("#downloadSlideButton");
const removeSlideButton = document.querySelector("#removeSlideButton");
const saveStatus = document.querySelector("#saveStatus");
const deployVersion = document.querySelector("#deployVersion");
const galleryOpenAIKey = document.querySelector("#galleryOpenAIKey");
const gallerySaveKeyButton = document.querySelector("#gallerySaveKeyButton");
const galleryForgetKeyButton = document.querySelector("#galleryForgetKeyButton");
const galleryKeyStatus = document.querySelector("#galleryKeyStatus");
const downloadHtmlDialog = document.querySelector("#downloadHtmlDialog");
const downloadHtmlCloseButton = document.querySelector("#downloadHtmlCloseButton");
const downloadHtmlCancelButton = document.querySelector("#downloadHtmlCancelButton");
const downloadHtmlConfirmButton = document.querySelector("#downloadHtmlConfirmButton");
const downloadSlideSpec = document.querySelector("#downloadSlideSpec");
const downloadSlidePicker = document.querySelector("#downloadSlidePicker");
const downloadHtmlStatus = document.querySelector("#downloadHtmlStatus");
const downloadAllButton = document.querySelector("#downloadAllButton");
const downloadCurrentButton = document.querySelector("#downloadCurrentButton");
const downloadClearButton = document.querySelector("#downloadClearButton");
const openAIKeyStorageKey = "htmldeck.openaiApiKey";
const fields = {
  title: document.querySelector("#slideTitle"),
  file: document.querySelector("#slideFile"),
  notes: document.querySelector("#slideNotes"),
  html: document.querySelector("#slideHtml")
};

let presentationIndex = { presentations: [] };
let activePresentation = null;
let deck = { title: "HTML Deck", slides: [] };
let slideHtml = new Map();
let selectedIndex = 0;
let draggedIndex = null;
let dropIndex = null;
let pendingPointer = null;
let pointerDragging = false;
let suppressNextClick = false;
let downloadSelection = new Set();

init();

async function init() {
  bindEvents();
  updateGalleryKeyStatus();
  loadDeployVersion();
  presentationIndex = await fetchJson("presentations/index.json");
  activePresentation = findInitialPresentation();
  renderPresentationList();
  await openPresentation(activePresentation.id, false);
}

async function loadDeployVersion() {
  if (!deployVersion) return;

  try {
    const response = await fetch("/.netlify/functions/deploy-info", { cache: "no-store" });
    if (!response.ok) throw new Error("Deploy info unavailable");
    const info = await response.json();
    deployVersion.textContent = info.commit ? `commit ${info.commit}` : "commit unavailable";
  } catch {
    deployVersion.textContent = "local version";
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json();
}

function bindEvents() {
  addSlideButton.addEventListener("click", addSlide);
  downloadHtmlButton.addEventListener("click", openDownloadHtmlDialog);
  downloadDeckButton.addEventListener("click", () => downloadText("deck.json", JSON.stringify(deck, null, 2)));
  downloadSlideButton.addEventListener("click", downloadSelectedSlide);
  removeSlideButton.addEventListener("click", removeSelectedSlide);
  saveGithubButton.addEventListener("click", saveToGithub);
  gallerySaveKeyButton.addEventListener("click", saveGalleryOpenAIKey);
  galleryForgetKeyButton.addEventListener("click", forgetGalleryOpenAIKey);
  downloadHtmlCloseButton.addEventListener("click", closeDownloadHtmlDialog);
  downloadHtmlCancelButton.addEventListener("click", closeDownloadHtmlDialog);
  downloadHtmlConfirmButton.addEventListener("click", downloadSelectedHtmlSlides);
  downloadSlideSpec.addEventListener("input", updateDownloadSelectionFromSpec);
  downloadAllButton.addEventListener("click", selectAllDownloads);
  downloadCurrentButton.addEventListener("click", selectCurrentDownload);
  downloadClearButton.addEventListener("click", clearDownloadSelection);
  document.addEventListener("pointermove", movePointerDrag);
  document.addEventListener("pointerup", endPointerDrag);
  document.addEventListener("pointercancel", cancelPointerDrag);

  fields.title.addEventListener("input", updateSelectedFromFields);
  fields.file.addEventListener("input", updateSelectedFromFields);
  fields.notes.addEventListener("input", updateSelectedFromFields);
  fields.html.addEventListener("input", updateSelectedHtmlFromField);
}

function saveGalleryOpenAIKey() {
  const key = galleryOpenAIKey.value.trim();
  if (!key) return;
  localStorage.setItem(openAIKeyStorageKey, key);
  galleryOpenAIKey.value = "";
  updateGalleryKeyStatus();
}

function forgetGalleryOpenAIKey() {
  localStorage.removeItem(openAIKeyStorageKey);
  galleryOpenAIKey.value = "";
  updateGalleryKeyStatus();
}

function updateGalleryKeyStatus() {
  const hasKey = Boolean(localStorage.getItem(openAIKeyStorageKey));
  galleryKeyStatus.textContent = hasKey
    ? "Agent key is saved on this device for all presentations."
    : "No agent key saved yet.";
}

function findInitialPresentation() {
  const requested = new URLSearchParams(window.location.search).get("presentation");
  return presentationIndex.presentations.find((presentation) => presentation.id === requested)
    || presentationIndex.presentations[0]
    || null;
}

async function openPresentation(id, pushState = true) {
  const presentation = presentationIndex.presentations.find((item) => item.id === id);
  if (!presentation) return;

  activePresentation = presentation;
  deck = await fetchJson(presentation.deck);
  slideHtml = new Map();
  selectedIndex = 0;
  await loadSlideHtml();
  updatePresentationChrome(pushState);
  renderPresentationList();
  render();
  selectSlide(0);
}

async function loadSlideHtml() {
  await Promise.all(deck.slides.map(async (slide) => {
    const html = await fetchSlideHtml(slide);
    slideHtml.set(slide.file, html);
  }));
}

async function fetchSlideHtml(slide) {
  const activeResponse = await fetch(resolveSlideRawUrl(slide.file), { cache: "no-store" }).catch(() => null);
  if (activeResponse?.ok) return activeResponse.text();

  const staticResponse = await fetch(resolveStaticSlideUrl(slide.file), { cache: "no-store" }).catch(() => null);
  return staticResponse?.ok ? staticResponse.text() : newSlideTemplate(slide.title || "Untitled Slide");
}

function updatePresentationChrome(pushState) {
  currentPresentationTitle.textContent = deck.title || activePresentation.title || "Untitled Presentation";
  currentPresentationPath.textContent = activePresentation.folder;
  presentButton.href = `present.html?presentation=${encodeURIComponent(activePresentation.id)}`;
  saveStatus.textContent = "Static mode can download edited files. On Netlify, add GitHub environment variables to enable direct saving.";

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set("presentation", activePresentation.id);
    window.history.replaceState(null, "", url);
  }
}

function renderPresentationList() {
  const presentations = presentationIndex.presentations;
  presentationCount.textContent = `${presentations.length} available`;
  presentationList.replaceChildren(...presentations.map((presentation) => {
    const button = document.createElement("button");
    button.className = `presentation-item${presentation.id === activePresentation?.id ? " is-active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="presentation-item__title"></span>
      <span class="presentation-item__path"></span>
    `;
    button.querySelector(".presentation-item__title").textContent = presentation.title;
    button.querySelector(".presentation-item__path").textContent = presentation.folder;
    button.addEventListener("click", () => openPresentation(presentation.id));
    return button;
  }));
}

function render() {
  slideList.replaceChildren(...deck.slides.map((slide, index) => {
    const card = document.createElement("article");
    card.className = `slide-card${index === selectedIndex ? " is-selected" : ""}`;
    card.tabIndex = 0;
    card.dataset.index = String(index);
    card.setAttribute("aria-label", `Slide ${index + 1}: ${slide.title || "Untitled"}`);

    const preview = document.createElement("div");
    preview.className = "slide-card__preview";
    const iframe = document.createElement("iframe");
    iframe.src = resolveSlideFrameUrl(slide.file);
    iframe.title = `${slide.title} preview`;
    preview.append(iframe);

    const body = document.createElement("div");
    body.className = "slide-card__body";
    body.innerHTML = `
      <p class="slide-card__title"></p>
      <p class="slide-card__file"></p>
    `;
    body.querySelector(".slide-card__title").textContent = `${index + 1}. ${slide.title || "Untitled"}`;
    body.querySelector(".slide-card__file").textContent = slide.file;
    card.append(preview, body);

    card.addEventListener("click", () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      openSlideInPresentation(index);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSlideInPresentation(index);
      }
    });
    card.addEventListener("pointerdown", (event) => startPointerDrag(event, index));

    return card;
  }));
}

function openSlideInPresentation(index) {
  window.location.href = `present.html?presentation=${encodeURIComponent(activePresentation.id)}&slide=${index + 1}`;
}

function selectSlide(index) {
  if (!deck.slides.length) {
    selectedIndex = -1;
    setFieldsDisabled(true);
    return;
  }

  selectedIndex = Math.max(0, Math.min(index, deck.slides.length - 1));
  const slide = deck.slides[selectedIndex];
  const html = slideHtml.get(slide.file) || "";
  fields.title.value = slide.title || "";
  fields.file.value = slide.file || "";
  fields.html.value = html;
  fields.notes.value = readNotesFromHtml(html);
  setFieldsDisabled(false);
  render();
}

function updateSelectedFromFields() {
  const slide = deck.slides[selectedIndex];
  if (!slide) return;

  const oldFile = slide.file;
  slide.title = fields.title.value.trim() || "Untitled Slide";
  slide.file = normalizeSlideFile(fields.file.value);

  let html = fields.html.value;
  html = setHtmlTitle(html, slide.title);
  html = writeSpeakerNotes(html, fields.notes.value);
  fields.file.value = slide.file;
  fields.html.value = html;

  if (oldFile !== slide.file) {
    slideHtml.delete(oldFile);
  }

  slideHtml.set(slide.file, html);
  render();
}

function updateSelectedHtmlFromField() {
  const slide = deck.slides[selectedIndex];
  if (!slide) return;
  slideHtml.set(slide.file, fields.html.value);
  fields.notes.value = readNotesFromHtml(fields.html.value);
}

function startPointerDrag(event, index) {
  if (event.button !== 0 || event.target.closest("input, textarea, button, a")) return;
  pendingPointer = {
    card: event.currentTarget,
    index,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
}

function movePointerDrag(event) {
  if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return;

  const distance = Math.hypot(event.clientX - pendingPointer.x, event.clientY - pendingPointer.y);
  if (!pointerDragging && distance < 6) return;

  if (!pointerDragging) {
    pointerDragging = true;
    draggedIndex = pendingPointer.index;
    dropIndex = pendingPointer.index;
    slideList.classList.add("is-drag-active");
    pendingPointer.card.classList.add("is-dragging");
    pendingPointer.card.setPointerCapture?.(event.pointerId);
  }

  event.preventDefault();
  dropIndex = getInsertionIndex(event);
  updateDropMarker(dropIndex);
}

function endPointerDrag(event) {
  if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return;

  if (pointerDragging) {
    const sourceIndex = draggedIndex;
    const targetIndex = dropIndex ?? sourceIndex;

    if (sourceIndex !== null && targetIndex !== sourceIndex && targetIndex !== sourceIndex + 1) {
      moveSlideToInsertion(sourceIndex, targetIndex);
    }

    suppressNextClick = true;
  }

  clearDragState();
}

function cancelPointerDrag() {
  clearDragState();
}

function getInsertionIndex(event) {
  const cards = Array.from(slideList.querySelectorAll(".slide-card:not(.is-dragging)"));
  if (!cards.length) return 0;

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const index = Number(card.dataset.index);
    const isSameRow = event.clientY >= rect.top && event.clientY <= rect.bottom;

    if (isSameRow && event.clientX < rect.left + rect.width / 2) {
      return index;
    }

    if (!isSameRow && event.clientY < rect.top + rect.height / 2) {
      return index;
    }
  }

  const lastCard = cards[cards.length - 1];
  return Number(lastCard.dataset.index) + 1;
}

function updateDropMarker(index) {
  clearDropMarkers();
  if (!deck.slides.length) return;

  if (index <= 0) {
    slideList.querySelector(".slide-card")?.classList.add("is-insert-before");
    return;
  }

  if (index >= deck.slides.length) {
    slideList.querySelector(".slide-card:last-child")?.classList.add("is-insert-after");
    return;
  }

  slideList.querySelector(`.slide-card[data-index="${index}"]`)?.classList.add("is-insert-before");
}

function clearDragState() {
  pendingPointer = null;
  pointerDragging = false;
  draggedIndex = null;
  dropIndex = null;
  slideList.classList.remove("is-drag-active");
  document.querySelectorAll(".slide-card").forEach((card) => {
    card.classList.remove("is-dragging", "is-insert-before", "is-insert-after");
  });
}

function clearDropMarkers() {
  document.querySelectorAll(".slide-card").forEach((card) => {
    card.classList.remove("is-insert-before", "is-insert-after");
  });
}

function moveSlideToInsertion(index, insertionIndex) {
  if (index < 0 || insertionIndex < 0 || index >= deck.slides.length || insertionIndex > deck.slides.length) return;
  const target = insertionIndex > index ? insertionIndex - 1 : insertionIndex;
  const [slide] = deck.slides.splice(index, 1);
  deck.slides.splice(target, 0, slide);

  if (selectedIndex === index) {
    selectSlide(target);
    return;
  }

  if (index < selectedIndex && target >= selectedIndex) selectedIndex -= 1;
  if (index > selectedIndex && target <= selectedIndex) selectedIndex += 1;
  render();
}

function addSlide() {
  const next = deck.slides.length + 1;
  const title = `New Slide ${next}`;
  const file = `slides/${String(next).padStart(3, "0")}-new-slide.html`;
  deck.slides.push({ title, file });
  slideHtml.set(file, newSlideTemplate(title));
  selectSlide(deck.slides.length - 1);
}

function removeSelectedSlide() {
  const slide = deck.slides[selectedIndex];
  if (!slide) return;
  deck.slides.splice(selectedIndex, 1);
  selectSlide(Math.min(selectedIndex, deck.slides.length - 1));
}

function downloadSelectedSlide() {
  const slide = deck.slides[selectedIndex];
  if (!slide) return;
  downloadText(slide.file.split("/").pop() || "slide.html", slideHtml.get(slide.file) || "");
}

function openDownloadHtmlDialog() {
  selectDownloadIndexes(deck.slides.map((_, index) => index), "all");
  renderDownloadSlidePicker();
  showDownloadStatus();

  if (typeof downloadHtmlDialog.showModal === "function") {
    downloadHtmlDialog.showModal();
  } else {
    downloadHtmlDialog.setAttribute("open", "");
  }

  downloadSlideSpec.focus();
  downloadSlideSpec.select();
}

function closeDownloadHtmlDialog() {
  if (typeof downloadHtmlDialog.close === "function") {
    downloadHtmlDialog.close();
  } else {
    downloadHtmlDialog.removeAttribute("open");
  }
}

function selectAllDownloads() {
  selectDownloadIndexes(deck.slides.map((_, index) => index), "all");
  renderDownloadSlidePicker();
  showDownloadStatus();
}

function selectCurrentDownload() {
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  selectDownloadIndexes(deck.slides[index] ? [index] : [], String(index + 1));
  renderDownloadSlidePicker();
  showDownloadStatus();
}

function clearDownloadSelection() {
  selectDownloadIndexes([], "");
  renderDownloadSlidePicker();
  showDownloadStatus();
}

function selectDownloadIndexes(indexes, spec) {
  downloadSelection = new Set(indexes.filter((index) => index >= 0 && index < deck.slides.length));
  downloadSlideSpec.value = spec;
}

function renderDownloadSlidePicker() {
  downloadSlidePicker.replaceChildren(...deck.slides.map((slide, index) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const copy = document.createElement("span");
    const title = document.createElement("span");
    const file = document.createElement("span");

    label.className = "download-slide-option";
    checkbox.type = "checkbox";
    checkbox.checked = downloadSelection.has(index);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        downloadSelection.add(index);
      } else {
        downloadSelection.delete(index);
      }
      downloadSlideSpec.value = formatDownloadSelection();
      showDownloadStatus();
    });
    title.className = "download-slide-option__title";
    file.className = "download-slide-option__file";
    title.textContent = `${index + 1}. ${slide.title || "Untitled"}`;
    file.textContent = normalizeSlideFile(slide.file);
    copy.append(title, file);
    label.append(checkbox, copy);
    return label;
  }));
}

function updateDownloadSelectionFromSpec() {
  const parsed = parseDownloadSelection(downloadSlideSpec.value);
  if (parsed.error) {
    showDownloadStatus(parsed.error, true);
    downloadHtmlConfirmButton.disabled = true;
    return;
  }

  downloadSelection = new Set(parsed.indexes);
  downloadHtmlConfirmButton.disabled = false;
  syncDownloadPickerChecks();
  showDownloadStatus();
}

function syncDownloadPickerChecks() {
  downloadSlidePicker.querySelectorAll("input[type='checkbox']").forEach((checkbox, index) => {
    checkbox.checked = downloadSelection.has(index);
  });
}

function parseDownloadSelection(value) {
  const text = value.trim().toLowerCase();
  if (text === "all") {
    return { indexes: deck.slides.map((_, index) => index) };
  }
  if (!text) return { indexes: [] };

  const indexes = new Set();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;

    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return { error: `Use slide numbers like all, 1-2, or 1, 3.` };

    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > deck.slides.length || end > deck.slides.length) {
      return { error: `Choose slide numbers from 1 to ${deck.slides.length}.` };
    }
    if (end < start) return { error: `Use ranges from low to high, for example 1-3.` };

    for (let slideNumber = start; slideNumber <= end; slideNumber += 1) {
      indexes.add(slideNumber - 1);
    }
  }

  return { indexes: [...indexes].sort((a, b) => a - b) };
}

function formatDownloadSelection() {
  const indexes = [...downloadSelection].sort((a, b) => a - b);
  if (!indexes.length) return "";
  if (indexes.length === deck.slides.length) return "all";
  return indexes.map((index) => String(index + 1)).join(", ");
}

function showDownloadStatus(message = "", isError = false) {
  const count = downloadSelection.size;
  downloadHtmlStatus.classList.toggle("is-error", isError);
  downloadHtmlStatus.textContent = message || `${count} slide${count === 1 ? "" : "s"} selected.`;
}

async function downloadSelectedHtmlSlides() {
  const parsed = parseDownloadSelection(downloadSlideSpec.value);
  if (parsed.error) {
    showDownloadStatus(parsed.error, true);
    return;
  }

  const selected = parsed.indexes;
  if (!selected.length) {
    showDownloadStatus("Choose at least one slide.", true);
    return;
  }

  downloadHtmlConfirmButton.disabled = true;
  showDownloadStatus("Preparing ZIP...");

  try {
    const files = selected.map((index) => {
      const slide = deck.slides[index];
      return {
        path: resolveSlideRepoPath(slide.file),
        content: slideHtml.get(slide.file) || ""
      };
    });
    const zip = makeZip([...files, ...await getExportSupportFiles()]);
    const filename = `${slugify(activePresentation?.id || deck.title || "htmldeck")}-html-slides.zip`;
    downloadBlob(filename, zip, "application/zip");
    closeDownloadHtmlDialog();
  } catch (error) {
    showDownloadStatus(error.message || "Unable to prepare download.", true);
  } finally {
    downloadHtmlConfirmButton.disabled = false;
  }
}

async function getExportSupportFiles() {
  const supportFiles = [
    { path: "styles/slide.css", url: "styles/slide.css", type: "text" },
    { path: "Raising a Flag, Full Speed.mp4", url: "Raising%20a%20Flag,%20Full%20Speed.mp4", type: "binary" },
    { path: "Raising a Flag, Half Speed.mp4", url: "Raising%20a%20Flag,%20Half%20Speed.mp4", type: "binary" }
  ];

  const files = await Promise.all(supportFiles.map(async (file) => {
    const response = await fetch(file.url, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return null;
    return {
      path: file.path,
      content: file.type === "binary"
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text()
    };
  }));

  return files.filter(Boolean);
}

async function saveToGithub() {
  saveStatus.textContent = "Saving to GitHub...";
  const files = [
    { path: activePresentation.deck, content: JSON.stringify(deck, null, 2) + "\n" },
    ...deck.slides.map((slide) => ({ path: resolveSlideRepoPath(slide.file), content: slideHtml.get(slide.file) || "" }))
  ];

  try {
    const response = await fetch("/.netlify/functions/github-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "GitHub save failed");
    saveStatus.textContent = `Saved ${files.length} files to GitHub. Netlify will redeploy from the new commit.`;
  } catch (error) {
    saveStatus.textContent = `${error.message}. Use downloads, or configure GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO and GITHUB_BRANCH in Netlify.`;
  }
}

function readNotesFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readSpeakerNotes(doc);
}

function setHtmlTitle(html, title) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.title) {
    doc.title = title;
  }
  const heading = doc.querySelector(".slide-title");
  if (heading) heading.textContent = title;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function setFieldsDisabled(disabled) {
  Object.values(fields).forEach((field) => {
    field.disabled = disabled;
    if (disabled) field.value = "";
  });
}

function resolveSlideFrameUrl(file) {
  if (isLocalStaticMode()) return resolveStaticSlideUrl(file);
  const params = new URLSearchParams({
    presentation: activePresentation.id,
    slide: normalizeSlideFile(file)
  });
  return `/.netlify/functions/slide-html?${params.toString()}`;
}

function resolveSlideRawUrl(file) {
  if (isLocalStaticMode()) return resolveStaticSlideUrl(file);
  const params = new URLSearchParams({
    presentation: activePresentation.id,
    slide: normalizeSlideFile(file),
    raw: "1"
  });
  return `/.netlify/functions/slide-html?${params.toString()}`;
}

function resolveStaticSlideUrl(file) {
  if (/^(https?:)?\/\//.test(file) || file.startsWith("/")) return file;
  return `${activePresentation.folder}/${normalizeSlideFile(file)}`;
}

function isLocalStaticMode() {
  return location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(location.hostname);
}

function resolveSlideRepoPath(file) {
  return `${activePresentation.folder}/${normalizeSlideFile(file)}`;
}

function normalizeSlideFile(file) {
  return (file || "").trim().replace(/^\.?\//, "");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadBlob(filename, blob, "text/plain;charset=utf-8");
}

function downloadBlob(filename, blob, type) {
  const typedBlob = blob.type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typedBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const entries = files.map((file) => {
    const nameBytes = encoder.encode(file.path);
    const contentBytes = toBytes(file.content, encoder);
    const crc = crc32(contentBytes);
    return { ...file, nameBytes, contentBytes, crc };
  });
  const parts = [];
  const centralDirectory = [];
  let offset = 0;

  for (const entry of entries) {
    const localHeader = zipLocalHeader(entry);
    parts.push(localHeader, entry.nameBytes, entry.contentBytes);
    centralDirectory.push({ entry, offset });
    offset += byteLength(localHeader) + byteLength(entry.nameBytes) + byteLength(entry.contentBytes);
  }

  const centralStart = offset;
  for (const item of centralDirectory) {
    const header = zipCentralHeader(item.entry, item.offset);
    parts.push(header, item.entry.nameBytes);
    offset += byteLength(header) + byteLength(item.entry.nameBytes);
  }

  parts.push(zipEndRecord(entries.length, offset - centralStart, centralStart));
  return new Blob(parts, { type: "application/zip" });
}

function byteLength(part) {
  return part.byteLength ?? part.length ?? 0;
}

function toBytes(content, encoder) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return encoder.encode(String(content || ""));
}

function zipLocalHeader(entry) {
  const view = new DataView(new ArrayBuffer(30));
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.contentBytes.length, true);
  view.setUint32(22, entry.contentBytes.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  return view.buffer;
}

function zipCentralHeader(entry, offset) {
  const view = new DataView(new ArrayBuffer(46));
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.contentBytes.length, true);
  view.setUint32(24, entry.contentBytes.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return view.buffer;
}

function zipEndRecord(entryCount, centralSize, centralStart) {
  const view = new DataView(new ArrayBuffer(22));
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  view.setUint16(20, 0, true);
  return view.buffer;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function slugify(value) {
  return String(value || "htmldeck").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "htmldeck";
}

function newSlideTemplate(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="../../../styles/slide.css">
  </head>
  <body>
    <main class="slide">
      <h1 class="slide-title">${escapeHtml(title)}</h1>
    </main>
    <script type="application/json" data-speaker-notes>
{
  "notes": ""
}
    </script>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
