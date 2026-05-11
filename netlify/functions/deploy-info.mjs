export default async function handler() {
  const commitRef = process.env.COMMIT_REF || process.env.HEAD || "";
  const githubCommit = commitRef ? "" : await readGitHubCommit().catch(() => "");
  const commit = (commitRef || githubCommit).slice(0, 7);

  return new Response(JSON.stringify({
    commit,
    branch: process.env.BRANCH || "",
    context: process.env.CONTEXT || "",
    deployId: process.env.DEPLOY_ID || ""
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function readGitHubCommit() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) return "";

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) return "";
  const data = await response.json();
  return data.sha || "";
}
