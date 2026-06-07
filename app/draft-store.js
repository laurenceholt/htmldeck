const draftPrefix = "htmldeck.presentationDraft.";

export function readPresentationDraft(presentationId) {
  if (!presentationId) return null;

  try {
    const raw = localStorage.getItem(draftStorageKey(presentationId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;
    return {
      savedAt: draft.savedAt || "",
      deck: draft.deck || null,
      slides: draft.slides && typeof draft.slides === "object" ? draft.slides : {}
    };
  } catch {
    return null;
  }
}

export function writePresentationDraft(presentationId, deck, slideHtml) {
  if (!presentationId) return false;

  const slides = {};
  if (slideHtml instanceof Map) {
    slideHtml.forEach((html, file) => {
      slides[file] = html;
    });
  } else if (slideHtml && typeof slideHtml === "object") {
    Object.assign(slides, slideHtml);
  }

  try {
    localStorage.setItem(draftStorageKey(presentationId), JSON.stringify({
      savedAt: new Date().toISOString(),
      deck,
      slides
    }));
    return true;
  } catch {
    return false;
  }
}

export function getDraftSlideHtml(presentationId, file) {
  const draft = readPresentationDraft(presentationId);
  return draft?.slides?.[file] || "";
}

function draftStorageKey(presentationId) {
  return `${draftPrefix}${presentationId}`;
}
