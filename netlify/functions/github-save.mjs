const apiVersion = "2022-11-28";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const editorToken = process.env.EDITOR_TOKEN;

  if (!token || !owner || !repo || !editorToken) {
    return json(500, { error: "GitHub environment variables are not configured" });
  }

  if (event.headers["x-editor-token"] !== editorToken) {
    return json(401, { error: "Invalid editor passcode" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) return json(400, { error: "No files supplied" });

  try {
    for (const file of files) {
      await putFile({ token, owner, repo, branch, path: file.path, content: file.content });
    }
    return json(200, { ok: true, count: files.length });
  } catch (error) {
    return json(500, { error: error.message });
  }
}

async function putFile({ token, owner, repo, branch, path, content }) {
  if (!isAllowedPath(path)) {
    throw new Error(`Refusing to write unsupported path: ${path}`);
  }

  const existing = await github(token, `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(branch)}`, {
    method: "GET"
  });

  const body = {
    message: `Update ${path}`,
    content: Buffer.from(String(content || ""), "utf8").toString("base64"),
    branch
  };

  if (existing.ok) {
    const data = await existing.json();
    body.sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(`Unable to read ${path} from GitHub`);
  }

  const saved = await github(token, `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponentPath(path)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!saved.ok) {
    const detail = await saved.text();
    throw new Error(`Unable to save ${path}: ${detail}`);
  }
}

function isAllowedPath(path) {
  return path === "deck.json" || /^slides\/[a-zA-Z0-9._-]+\.html$/.test(path);
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function github(token, url, options) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": apiVersion,
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
