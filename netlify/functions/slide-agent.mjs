import { getStore } from "@netlify/blobs";

const githubApiVersion = "2022-11-28";
const openaiModel = "gpt-5.5";
const openaiReasoningEffort = process.env.OPENAI_REASONING_EFFORT || "none";

export default async function handler(request) {
  const profiler = createProfiler();
  profiler.mark("receive_request", { method: request.method, model: openaiModel });

  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed", timings: profiler.summary() });
  }

  const config = readConfig();
  profiler.mark("read_config", { ok: config.ok });
  if (!config.ok) return json(500, { error: config.error, timings: profiler.summary() });

  let payload;
  try {
    payload = await profiler.time("parse_request_json", () => request.json());
    profiler.mark("request_payload", {
      action: payload.action,
      presentationId: payload.presentationId,
      slideFile: payload.slideFile,
      instructionLength: String(payload.instruction || "").length,
      htmlLength: String(payload.html || "").length
    });
  } catch {
    return json(400, { error: "Invalid JSON body", timings: profiler.summary() });
  }

  try {
    const presentation = await profiler.time("load_presentation", () => getPresentation(config, payload.presentationId));
    const slideFile = normalizeSlideFile(payload.slideFile);
    const slidePath = `${presentation.folder}/${slideFile}`;
    assertAllowedSlidePath(presentation.folder, slidePath);
    profiler.mark("validated_slide", { presentationId: presentation.id, slideFile });

    if (payload.action === "listVersions") {
      const versions = await profiler.time("read_versions", () => readVersions(config, presentation, slideFile));
      return json(200, { versions, timings: profiler.summary() });
    }

    if (payload.action === "listHistory") {
      const history = await profiler.time("read_chat_history", () => readChatHistory(presentation, slideFile));
      return json(200, { history, timings: profiler.summary() });
    }

    if (payload.action === "restore") {
      const result = await restoreVersion(config, presentation, slideFile, payload.versionFile, profiler);
      return json(200, { ...result, timings: profiler.summary() });
    }

    if (payload.action === "edit") {
      const result = await editSlide(config, presentation, slideFile, payload, profiler);
      return json(200, { ...result, timings: profiler.summary() });
    }

    return json(400, { error: "Unsupported action", timings: profiler.summary() });
  } catch (error) {
    profiler.error(error);
    return json(500, { error: error.message, timings: profiler.summary() });
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

async function editSlide(config, presentation, slideFile, payload, profiler) {
  if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not configured");

  const instruction = String(payload.instruction || "").trim();
  const currentHtml = String(payload.html || "");
  if (!instruction) throw new Error("No instruction supplied");
  if (!currentHtml.includes("<html")) throw new Error("Current slide HTML is missing");

  const userMessage = createChatMessage("user", instruction);

  try {
    const version = await profiler.time("save_previous_version", () => saveVersion(config, presentation, slideFile, currentHtml, instruction, profiler));
    const updated = await profiler.time("send_to_gpt_total", () => callOpenAI(config.openaiKey, instruction, currentHtml, profiler));
    const slidePath = `${presentation.folder}/${slideFile}`;

    await profiler.time("write_updated_slide_to_github", () => putFile(config, slidePath, updated.updatedHtml, `Update ${slideFile} with slide agent`));

    const history = await profiler.time("append_chat_history", () => appendChatMessages(presentation, slideFile, [
      userMessage,
      createChatMessage("assistant", updated.summary || "Updated the slide.")
    ]));

    return {
      summary: updated.summary,
      updatedHtml: updated.updatedHtml,
      version,
      history
    };
  } catch (error) {
    await profiler.time("append_error_history", () => appendChatMessages(presentation, slideFile, [
      userMessage,
      createChatMessage("error", error.message)
    ])).catch(() => {});
    throw error;
  }
}

async function restoreVersion(config, presentation, slideFile, versionFile, profiler) {
  const versions = await profiler.time("read_versions_for_restore", () => readVersions(config, presentation, slideFile));
  const version = versions.find((item) => item.file === versionFile);
  if (!version) throw new Error("Version not found");

  const currentHtml = await profiler.time("read_current_slide_for_restore", () => readFileText(config, `${presentation.folder}/${slideFile}`));
  await profiler.time("save_pre_restore_version", () => saveVersion(config, presentation, slideFile, currentHtml, "Before restoring an earlier version", profiler));

  const restoredHtml = await profiler.time("read_selected_version", () => readFileText(config, `${presentation.folder}/${version.file}`));
  await profiler.time("write_restored_slide_to_github", () => putFile(config, `${presentation.folder}/${slideFile}`, restoredHtml, `Switch ${slideFile} to version from ${version.timestamp}`));

  const summary = `Switched to version from ${formatNewYorkTimestamp(version.timestamp)}.`;
  const history = await profiler.time("append_restore_history", () => appendChatMessages(presentation, slideFile, [
    createChatMessage("assistant", summary)
  ]));

  return {
    summary,
    updatedHtml: restoredHtml,
    history
  };
}

async function saveVersion(config, presentation, slideFile, html, label, profiler) {
  const timestamp = new Date().toISOString();
  const slug = slideSlug(slideFile);
  const versionsDir = `versions/slides/${slug}`;
  const filename = `${timestamp.replace(/[:.]/g, "-")}.html`;
  const versionPath = `${presentation.folder}/${versionsDir}/${filename}`;
  const versionsJsonPath = `${presentation.folder}/${versionsDir}/versions.json`;
  const versions = profiler
    ? await profiler.time("read_versions_for_save", () => readVersions(config, presentation, slideFile))
    : await readVersions(config, presentation, slideFile);
  const versionLabel = versions.length ? label : "Original version";
  const version = {
    timestamp,
    label: versionLabel.slice(0, 140),
    file: `${versionsDir}/${filename}`
  };

  if (profiler) {
    await profiler.time("write_version_html_to_github", () => putFile(config, versionPath, html, `Save version of ${slideFile}`));
    await profiler.time("write_versions_index_to_github", () => putFile(config, versionsJsonPath, JSON.stringify([version, ...versions], null, 2) + "\n", `Update versions for ${slideFile}`));
  } else {
    await putFile(config, versionPath, html, `Save version of ${slideFile}`);
    await putFile(config, versionsJsonPath, JSON.stringify([version, ...versions], null, 2) + "\n", `Update versions for ${slideFile}`);
  }
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

async function callOpenAI(apiKey, instruction, html, profiler) {
  const reasoningEffort = normalizeReasoningEffort(openaiModel, openaiReasoningEffort);
  const requestBody = {
    model: openaiModel,
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

  if (reasoningEffort) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  const response = await profiler.time("openai_fetch", () => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  }), { model: openaiModel, reasoningEffort });

  profiler.mark("openai_response_received", { status: response.status, ok: response.ok });
  const data = await profiler.time("parse_openai_response_json", () => response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI slide edit failed using ${openaiModel}`);
  }

  const text = data.output_text || extractOutputText(data);
  const parsed = await profiler.time("parse_openai_structured_output", () => JSON.parse(text), { outputLength: text.length });
  if (!parsed.updatedHtml?.includes("<html")) {
    throw new Error("The slide agent did not return a full HTML document");
  }
  profiler.mark("gpt_output_validated", { updatedHtmlLength: parsed.updatedHtml.length });
  return parsed;
}

async function readChatHistory(presentation, slideFile) {
  const history = await chatHistoryStore().get(chatHistoryKey(presentation, slideFile), {
    consistency: "strong",
    type: "json"
  });
  return sanitizeChatHistory(history);
}

async function appendChatMessages(presentation, slideFile, messages) {
  const currentHistory = await readChatHistory(presentation, slideFile);
  const nextHistory = [...currentHistory, ...messages].slice(-120);
  await chatHistoryStore().setJSON(chatHistoryKey(presentation, slideFile), nextHistory);
  return nextHistory;
}

function chatHistoryStore() {
  return getStore("slide-agent-history");
}

function chatHistoryKey(presentation, slideFile) {
  return `${presentation.id}/${slideSlug(slideFile)}.json`;
}

function createChatMessage(role, text) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text: String(text || ""),
    timestamp: new Date().toISOString()
  };
}

function sanitizeChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => message && typeof message.text === "string")
    .map((message) => ({
      id: String(message.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      role: ["user", "assistant", "error"].includes(message.role) ? message.role : "assistant",
      text: message.text,
      timestamp: String(message.timestamp || "")
    }));
}

function normalizeReasoningEffort(model, effort) {
  const value = String(effort || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "minimal" && /^gpt-5\.(2|5)\b/.test(model)) return "none";
  return value;
}

function formatNewYorkTimestamp(timestamp) {
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

function createProfiler() {
  const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = performance.now();
  const steps = [];

  function elapsedSeconds(since = startedAt) {
    return Number(((performance.now() - since) / 1000).toFixed(3));
  }

  function writeLog(entry) {
    console.log(JSON.stringify({
      source: "htmldeck-slide-agent",
      requestId,
      ...entry
    }));
  }

  return {
    requestId,
    mark(step, details = {}) {
      const entry = {
        step,
        elapsedSeconds: elapsedSeconds(),
        ...details
      };
      steps.push(entry);
      writeLog(entry);
    },
    async time(step, fn, details = {}) {
      const stepStartedAt = performance.now();
      try {
        const result = await fn();
        const entry = {
          step,
          durationSeconds: elapsedSeconds(stepStartedAt),
          elapsedSeconds: elapsedSeconds(),
          ...details
        };
        steps.push(entry);
        writeLog(entry);
        return result;
      } catch (error) {
        const entry = {
          step,
          durationSeconds: elapsedSeconds(stepStartedAt),
          elapsedSeconds: elapsedSeconds(),
          error: error.message,
          ...details
        };
        steps.push(entry);
        writeLog(entry);
        throw error;
      }
    },
    error(error) {
      const entry = {
        step: "request_error",
        elapsedSeconds: elapsedSeconds(),
        error: error.message
      };
      steps.push(entry);
      writeLog(entry);
    },
    summary() {
      return {
        requestId,
        totalSeconds: elapsedSeconds(),
        steps
      };
    }
  };
}

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" }
  });
}
