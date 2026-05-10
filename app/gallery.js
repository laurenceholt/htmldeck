import { readSpeakerNotes, writeSpeakerNotes } from "./slide-notes.js";

const slideList = document.querySelector("#slideList");
const addSlideButton = document.querySelector("#addSlideButton");
const downloadDeckButton = document.querySelector("#downloadDeckButton");
const saveGithubButton = document.querySelector("#saveGithubButton");
const downloadSlideButton = document.querySelector("#downloadSlideButton");
const removeSlideButton = document.querySelector("#removeSlideButton");
const saveStatus = document.querySelector("#saveStatus");
const fields = {
  title: document.querySelector("#slideTitle"),
  file: document.querySelector("#slideFile"),
  notes: document.querySelector("#slideNotes"),
  html: document.querySelector("#slideHtml")
};

let deck = { title: "HTML Deck", slides: [] };
let slideHtml = new Map();
let selectedIndex = 0;
let draggedIndex = null;
let dropIndex = null;
let pendingPointer = null;
let pointerDragging = false;
let suppressNextClick = false;

init();

async function init() {
  deck = await fetchJson("deck.json");
  await loadSlideHtml();
  bindEvents();
  render();
  selectSlide(0);
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json();
}

async function loadSlideHtml() {
  await Promise.all(deck.slides.map(async (slide) => {
    const response = await fetch(slide.file, { cache: "no-store" });
    const html = response.ok ? await response.text() : newSlideTemplate(slide.title || "Untitled Slide");
    slideHtml.set(slide.file, html);
  }));
}

function bindEvents() {
  addSlideButton.addEventListener("click", addSlide);
  downloadDeckButton.addEventListener("click", () => downloadText("deck.json", JSON.stringify(deck, null, 2)));
  downloadSlideButton.addEventListener("click", downloadSelectedSlide);
  removeSlideButton.addEventListener("click", removeSelectedSlide);
  saveGithubButton.addEventListener("click", saveToGithub);
  document.addEventListener("pointermove", movePointerDrag);
  document.addEventListener("pointerup", endPointerDrag);
  document.addEventListener("pointercancel", cancelPointerDrag);

  fields.title.addEventListener("input", updateSelectedFromFields);
  fields.file.addEventListener("input", updateSelectedFromFields);
  fields.notes.addEventListener("input", updateSelectedFromFields);
  fields.html.addEventListener("input", updateSelectedHtmlFromField);
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
    iframe.src = slide.file;
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
      selectSlide(index);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectSlide(index);
      }
    });
    card.addEventListener("pointerdown", (event) => startPointerDrag(event, index));

    return card;
  }));
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
  slide.file = fields.file.value.trim();

  let html = fields.html.value;
  html = setHtmlTitle(html, slide.title);
  html = writeSpeakerNotes(html, fields.notes.value);
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

async function saveToGithub() {
  saveStatus.textContent = "Saving to GitHub...";
  const editorToken = getEditorToken();
  if (!editorToken) {
    saveStatus.textContent = "GitHub save cancelled because no editor passcode was entered.";
    return;
  }

  const files = [
    { path: "deck.json", content: JSON.stringify(deck, null, 2) + "\n" },
    ...deck.slides.map((slide) => ({ path: slide.file, content: slideHtml.get(slide.file) || "" }))
  ];

  try {
    const response = await fetch("/.netlify/functions/github-save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Editor-Token": editorToken
      },
      body: JSON.stringify({ files })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "GitHub save failed");
    saveStatus.textContent = `Saved ${files.length} files to GitHub. Netlify will redeploy from the new commit.`;
  } catch (error) {
    saveStatus.textContent = `${error.message}. Use downloads, or configure GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH and EDITOR_TOKEN in Netlify.`;
  }
}

function getEditorToken() {
  const cached = window.sessionStorage.getItem("htmlDeckEditorToken");
  if (cached) return cached;

  const token = window.prompt("Editor passcode");
  if (!token) return "";
  window.sessionStorage.setItem("htmlDeckEditorToken", token);
  return token;
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

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function newSlideTemplate(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="../styles/slide.css">
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
