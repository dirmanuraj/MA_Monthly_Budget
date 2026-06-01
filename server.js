/**
 * Budget Dashboard server
 * - Serves the static dashboard from /public
 * - Reads/writes a JSON data file stored in a GitHub repo (via the GitHub
 *   contents API) so every edit you make is committed and "remembered".
 * - If GitHub env vars are not set, it falls back to the local data.json
 *   (handy for local dev, but note Railway's filesystem is ephemeral so for
 *   real persistence you MUST configure the GitHub variables).
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

// ---- Config -----------------------------------------------------------------
const GH = {
  token: process.env.GITHUB_TOKEN || "",
  owner: process.env.GITHUB_OWNER || "",
  repo: process.env.GITHUB_REPO || "",
  path: process.env.GITHUB_FILE_PATH || "data.json",
  branch: process.env.GITHUB_BRANCH || "main",
};
const APP_PASSWORD = process.env.APP_PASSWORD || ""; // optional gate
const LOCAL_DATA = path.join(__dirname, "data.json");
const useGitHub = Boolean(GH.token && GH.owner && GH.repo);

let fileSha = null; // cached SHA of the GitHub file, needed for updates

// ---- Auth middleware --------------------------------------------------------
function checkAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const sent = req.get("x-app-password") || "";
  if (sent === APP_PASSWORD) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// ---- GitHub helpers ---------------------------------------------------------
const ghApi = () =>
  `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${encodeURIComponent(
    GH.path
  )}`;

async function githubLoad() {
  const res = await fetch(`${ghApi()}?ref=${encodeURIComponent(GH.branch)}`, {
    headers: {
      Authorization: `Bearer ${GH.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "budget-dashboard",
    },
  });
  if (res.status === 404) return null; // file doesn't exist yet
  if (!res.ok) throw new Error(`GitHub load failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  fileSha = json.sha;
  const content = Buffer.from(json.content, "base64").toString("utf8");
  return JSON.parse(content);
}

async function githubSave(data) {
  const body = {
    message: `Update budget data — ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
    branch: GH.branch,
  };
  if (fileSha) body.sha = fileSha;

  const res = await fetch(ghApi(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "budget-dashboard",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub save failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  fileSha = json.content.sha; // refresh SHA for the next write
}

// ---- Data load/save (chooses GitHub or local) -------------------------------
async function loadData() {
  if (useGitHub) {
    const remote = await githubLoad();
    if (remote) return remote;
    // First run: seed GitHub from the bundled data.json
    const seed = JSON.parse(fs.readFileSync(LOCAL_DATA, "utf8"));
    await githubSave(seed);
    return seed;
  }
  return JSON.parse(fs.readFileSync(LOCAL_DATA, "utf8"));
}

async function saveData(data) {
  if (useGitHub) {
    await githubSave(data);
  } else {
    fs.writeFileSync(LOCAL_DATA, JSON.stringify(data, null, 2));
  }
}

// ---- Routes -----------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({ requiresPassword: Boolean(APP_PASSWORD), persistence: useGitHub ? "github" : "local" });
});

app.post("/api/login", (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if ((req.body && req.body.password) === APP_PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

app.get("/api/data", checkAuth, async (req, res) => {
  try {
    const data = await loadData();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data", checkAuth, async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== "object" || !data.months) {
      return res.status(400).json({ error: "invalid payload" });
    }
    await saveData(data);
    res.json({ ok: true, persistence: useGitHub ? "github" : "local" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Budget dashboard running on :${PORT}`);
  console.log(`Persistence mode: ${useGitHub ? "GitHub (" + GH.owner + "/" + GH.repo + ")" : "local file (ephemeral on Railway)"}`);
});
