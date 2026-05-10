export function readSpeakerNotes(doc) {
  const node = doc.querySelector('script[type="application/json"][data-speaker-notes]');
  if (!node) return "";

  try {
    const data = JSON.parse(node.textContent || "{}");
    return typeof data.notes === "string" ? data.notes : "";
  } catch {
    return "";
  }
}

export function writeSpeakerNotes(html, notes) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const payload = JSON.stringify({ notes }, null, 2);
  let node = doc.querySelector('script[type="application/json"][data-speaker-notes]');

  if (!node) {
    node = doc.createElement("script");
    node.type = "application/json";
    node.setAttribute("data-speaker-notes", "");
    doc.body.append("\n    ", node, "\n  ");
  }

  node.textContent = `\n${payload}\n`;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
