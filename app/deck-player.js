import { readSpeakerNotes } from "./slide-notes.js";

const viewport = document.querySelector("#slideViewport");
const status = document.querySelector("#slideStatus");
const notesPanel = document.querySelector("#speakerNotes");
const notesContent = document.querySelector("#speakerNotesContent");
const blackCover = document.querySelector("#blackCover");
const whiteCover = document.querySelector("#whiteCover");

let deck = { slides: [] };
let currentIndex = 0;
let notesVisible = false;

init();

async function init() {
  deck = await loadDeck();
  currentIndex = clamp(readSlideFromUrl(), 0, Math.max(deck.slides.length - 1, 0));
  bindKeys();
  showSlide(currentIndex, false);
}

async function loadDeck() {
  const response = await fetch("deck.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load deck.json");
  return response.json();
}

function bindKeys() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;

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
  });

  viewport.addEventListener("load", () => {
    updateNotesFromSlide();
  });
}

function showSlide(index, pushState = true) {
  if (!deck.slides.length) {
    status.textContent = "No slides";
    return;
  }

  currentIndex = clamp(index, 0, deck.slides.length - 1);
  const slide = deck.slides[currentIndex];
  viewport.src = slide.file;
  status.textContent = `${currentIndex + 1} / ${deck.slides.length}`;
  hideCovers();

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set("slide", String(currentIndex + 1));
    window.history.replaceState(null, "", url);
  }
}

function updateNotesFromSlide() {
  const doc = viewport.contentDocument;
  const notes = doc ? readSpeakerNotes(doc) : "";
  notesContent.textContent = notes || "No speaker notes for this slide.";
  if (notesVisible) setNotesVisible(true);
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
