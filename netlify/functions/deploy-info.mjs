export default async function handler() {
  const commitRef = process.env.COMMIT_REF || process.env.HEAD || "";
  const commit = commitRef ? commitRef.slice(0, 7) : "";

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
