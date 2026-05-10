import { readSpeakerNotes } from "./slide-notes.js";

const slideFrame = document.querySelector("#slideFrame");
const status = document.querySelector("#slideStatus");
const notesPanel = document.querySelector("#speakerNotes");
const notesContent = document.querySelector("#speakerNotesContent");
const blackCover = document.querySelector("#blackCover");
const whiteCover = document.querySelector("#whiteCover");

let deck = { slides: [] };
let currentIndex = 0;
let notesVisible = false;
let slideViewports = [];
let slideNotes = [];
let slideLoaded = [];
let pendingIndex = null;

init();

async function init() {
  deck = await loadDeck();
  currentIndex = clamp(readSlideFromUrl(), 0, Math.max(deck.slides.length - 1, 0));
  buildSlideViewports();
  bindKeys();
  showSlide(currentIndex, false);
}

async function loadDeck() {
  const response = await fetch("deck.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load deck.json");
  return response.json();
}

function bindKeys() {
  document.addEventListener("keydown", handleDeckKey);
}

function buildSlideViewports() {
  slideViewports = deck.slides.map((slide, index) => {
    const iframe = document.createElement("iframe");
    iframe.title = slide.title || `Slide ${index + 1}`;
    iframe.src = slide.file;
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
  updateNotesFromSlide();
  hideCovers();

  if (pushState) {
    const url = new URL(window.location.href);
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

  if (event.key === "Escape") {
    event.preventDefault();
    hideCovers();
    setNotesVisible(false);
  }
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

function readSlideFromUrl() {
  const value = Number(new URLSearchParams(window.location.search).get("slide"));
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
