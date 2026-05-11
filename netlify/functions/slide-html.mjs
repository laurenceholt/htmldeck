import { getStore } from "@netlify/blobs";

const githubApiVersion = "2022-11-28";

export default async function handler(request) {
  if (request.method !== "GET") {
    return textResponse("Method not allowed", 405, "text/plain");
  }

  const url = new URL(request.url);
  const presentationId = url.searchParams.get("presentation") || "";
  const slideFile = normalizeSlideFile(url.searchParams.get("slide") || "");
  const raw = url.searchParams.get("raw") === "1";

  try {
    if (!/^[a-zA-Z0-9._-]+$/.test(presentationId)) {
      return textResponse("Invalid presentation", 400, "text/plain");
    }

    const html = await readActiveSlide(presentationId, slideFile)
      || await readSlideFromGitHub(presentationId, slideFile);
    const body = raw ? removeDeckBase(html) : addDeckBase(html, slideBaseHref(request, presentationId, slideFile));

    return textResponse(body, 200, "text/html; charset=utf-8");
  } catch (error) {
    return textResponse(error.message, 500, "text/plain");
  }
}

async function readActiveSlide(presentationId, slideFile) {
  return activeSlideStore().get(activeSlideKey(presentationId, slideFile), {
    consistency: "strong",
    type: "text"
  });
}

async function readSlideFromGitHub(presentationId, slideFile) {
  const config = readConfig();
  if (!config.ok) throw new Error(config.error);

  const index = JSON.parse(await readFileText(config, "presentations/index.json"));
  const presentation = index.presentations?.find((item) => item.id === presentationId);
  if (!presentation) throw new Error("Presentation not found");
  if (!/^presentations\/[a-zA-Z0-9._-]+$/.test(presentation.folder)) {
    throw new Error("Presentation folder is not supported");
  }

  return readFileText(config, `${presentation.folder}/${slideFile}`);
}

function readConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !owner || !repo) {
    return { ok: false, error: "GitHub environment variables are not configured" };
  }

  return { ok: true, token, owner, repo, branch };
}

async function readFileText(config, path) {
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": githubApiVersion
    }
  });

  if (!response.ok) throw new Error(`Unable to read ${path}`);
  const data = await response.json();
  return Buffer.from(data.content || "", "base64").toString("utf8");
}

function addDeckBase(html, href) {
  const withoutExistingBase = removeDeckBase(html);
  const base = `<base href="${escapeAttribute(href)}" data-html-deck-base>`;
  if (/<head\b[^>]*>/i.test(withoutExistingBase)) {
    return withoutExistingBase.replace(/<head\b([^>]*)>/i, `<head$1>${base}`);
  }
  return withoutExistingBase.replace(/<html\b([^>]*)>/i, `<html$1><head>${base}</head>`);
}

function removeDeckBase(html) {
  return String(html || "").replace(/<base\b[^>]*data-html-deck-base[^>]*>\s*/gi, "");
}

function slideBaseHref(request, presentationId, slideFile) {
  return new URL(`/presentations/${presentationId}/${slideFile}`, request.url).href;
}

function escapeAttribute(value) {
  return String(value).replace(/[&"]/g, (char) => char === "&" ? "&amp;" : "&quot;");
}

function activeSlideStore() {
  return getStore("active-slides");
}

function activeSlideKey(presentationId, slideFile) {
  return `${presentationId}/${slideSlug(slideFile)}.html`;
}

function normalizeSlideFile(file) {
  const normalized = String(file || "").trim().replace(/^\.?\//, "");
  if (!/^slides\/[a-zA-Z0-9._-]+\.html$/.test(normalized)) {
    throw new Error("Unsupported slide file");
  }
  return normalized;
}

function slideSlug(slideFile) {
  return slideFile.split("/").pop().replace(/\.html$/, "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function textResponse(body, status, contentType) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  });
}
