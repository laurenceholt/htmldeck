const githubApiVersion = "2022-11-28";
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.2";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const config = readConfig();
  if (!config.ok) return json(500, { error: config.error });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  try {
    const presentation = await getPresentation(config, payload.presentationId);
    const slideFile = normalizeSlideFile(payload.slideFile);
    const slidePath = `${presentation.folder}/${slideFile}`;
    assertAllowedSlidePath(presentation.folder, slidePath);

    if (payload.action === "listVersions") {
      const versions = await readVersions(config, presentation, slideFile);
      return json(200, { versions });
    }

    if (payload.action === "restore") {
      const result = await restoreVersion(config, presentation, slideFile, payload.versionFile);
      return json(200, result);
    }

    if (payload.action === "edit") {
      const result = await editSlide(config, presentation, slideFile, payload);
      return json(200, result);
    }

    return json(400, { error: "Unsupported action" });
  } catch (error) {
    return json(500, { error: error.message });
  }
}

function readConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!token || !owner || !repo) {
    return { ok: false, error: "GitHub environment variables are not configured" };
  }

  return { ok: true, token, owner, repo, branch, openaiKey };
}

async function getPresentation(config, presentationId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(presentationId || "")) {
    throw new Error("Invalid presentation id");
  }

  const index = JSON.parse(await readFileText(config, "presentations/index.json"));
  const presentation = index.presentations?.find((item) => item.id === presentationId);
  if (!presentation) throw new Error("Presentation not found");
  if (!/^presentations\/[a-zA-Z0-9._-]+$/.test(presentation.folder)) {
    throw new Error("Presentation folder is not supported");
  }
  return presentation;
}

async function editSlide(config, presentation, slideFile, payload) {
  if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not configured");

  const instruction = String(payload.instruction || "").trim();
  const currentHtml = String(payload.html || "");
  if (!instruction) throw new Error("No instruction supplied");
  if (!currentHtml.includes("<html")) throw new Error("Current slide HTML is missing");

  const version = await saveVersion(config, presentation, slideFile, currentHtml, instruction);
  const updated = await callOpenAI(config.openaiKey, instruction, currentHtml);
  const slidePath = `${presentation.folder}/${slideFile}`;

  await putFile(config, slidePath, updated.updatedHtml, `Update ${slideFile} with slide agent`);

  return {
    summary: updated.summary,
    updatedHtml: updated.updatedHtml,
    version
  };
}

async function restoreVersion(config, presentation, slideFile, versionFile) {
  const versions = await readVersions(config, presentation, slideFile);
  const version = versions.find((item) => item.file === versionFile);
  if (!version) throw new Error("Version not found");

  const currentHtml = await readFileText(config, `${presentation.folder}/${slideFile}`);
  await saveVersion(config, presentation, slideFile, currentHtml, "Before restoring an earlier version");

  const restoredHtml = await readFileText(config, `${presentation.folder}/${version.file}`);
  await putFile(config, `${presentation.folder}/${slideFile}`, restoredHtml, `Switch ${slideFile} to version from ${version.timestamp}`);

  return {
    summary: `Switched to version from ${version.timestamp}.`,
    updatedHtml: restoredHtml
  };
}

async function saveVersion(config, presentation, slideFile, html, label) {
  const timestamp = new Date().toISOString();
  const slug = slideSlug(slideFile);
  const versionsDir = `versions/slides/${slug}`;
  const filename = `${timestamp.replace(/[:.]/g, "-")}.html`;
  const versionPath = `${presentation.folder}/${versionsDir}/${filename}`;
  const versionsJsonPath = `${presentation.folder}/${versionsDir}/versions.json`;
  const versions = await readVersions(config, presentation, slideFile);
  const versionLabel = versions.length ? label : "Original version";
  const version = {
    timestamp,
    label: versionLabel.slice(0, 140),
    file: `${versionsDir}/${filename}`
  };

  await putFile(config, versionPath, html, `Save version of ${slideFile}`);
  await putFile(config, versionsJsonPath, JSON.stringify([version, ...versions], null, 2) + "\n", `Update versions for ${slideFile}`);
  return version;
}

async function readVersions(config, presentation, slideFile) {
  const versionsPath = `${presentation.folder}/versions/slides/${slideSlug(slideFile)}/versions.json`;
  try {
    const content = await readFileText(config, versionsPath);
    const versions = JSON.parse(content);
    return Array.isArray(versions)
      ? versions.map((version, index) => ({ ...version, isOriginal: index === versions.length - 1 }))
      : [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function callOpenAI(apiKey, instruction, html) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You edit a single standalone HTML presentation slide. Return the full updated HTML document. Preserve existing scripts, speaker notes JSON, relative asset paths, accessibility labels, and slide structure unless the user explicitly asks to change them. Do not add markdown fences."
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
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI slide edit failed");
  }

  const text = data.output_text || extractOutputText(data);
  const parsed = JSON.parse(text);
  if (!parsed.updatedHtml?.includes("<html")) {
    throw new Error("The slide agent did not return a full HTML document");
  }
  return parsed;
}

function extractOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("");
}

async function readFileText(config, path) {
  const response = await github(config, `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(config.branch)}`, {
    method: "GET"
  });

  if (!response.ok) {
    const error = new Error(`Unable to read ${path}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return Buffer.from(data.content || "", "base64").toString("utf8");
}

async function putFile(config, path, content, message) {
  const existing = await github(config, `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(config.branch)}`, {
    method: "GET"
  });

  const body = {
    message,
    content: Buffer.from(String(content || ""), "utf8").toString("base64"),
    branch: config.branch
  };

  if (existing.ok) {
    const data = await existing.json();
    body.sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(`Unable to read ${path} from GitHub`);
  }

  const saved = await github(config, `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponentPath(path)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!saved.ok) {
    const detail = await saved.text();
    throw new Error(`Unable to save ${path}: ${detail}`);
  }
}

function normalizeSlideFile(file) {
  const normalized = String(file || "").trim().replace(/^\.?\//, "");
  if (!/^slides\/[a-zA-Z0-9._-]+\.html$/.test(normalized)) {
    throw new Error("Unsupported slide file");
  }
  return normalized;
}

function assertAllowedSlidePath(folder, path) {
  if (!path.startsWith(`${folder}/slides/`) || !path.endsWith(".html")) {
    throw new Error("Unsupported slide path");
  }
}

function slideSlug(slideFile) {
  return slideFile.split("/").pop().replace(/\.html$/, "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function github(config, url, options) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": githubApiVersion,
      ...(options.headers || {})
    }
  });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
