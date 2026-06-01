# Monthly Expense Dashboard

A self-hosted budget dashboard built from your Google Sheet. It shows budget vs. spent,
category breakdowns, charts, and a full transaction log you can add/edit/delete from the
browser. Every change is committed back to a `data.json` file in **your GitHub repo**, so
your data persists across deploys and restarts.

## What it does
- Budget vs. spent summary cards, category progress bars, and two charts per month
- Month switcher (February → June 2026 seeded from your sheet; add more anytime)
- Add / edit / delete transactions — totals recompute automatically
- Saves to GitHub on every change (optional password gate)

---

## 1. Put this on GitHub
Create a new repo (e.g. `budget-dashboard`) and push these files:
```bash
git init
git add .
git commit -m "Budget dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/budget-dashboard.git
git push -u origin main
```
Your `data.json` is the live database. The app reads and rewrites it through the GitHub API.

## 2. Create a GitHub token
GitHub → Settings → Developer settings → **Personal access tokens** → *Fine-grained tokens*.
- Repository access: only your `budget-dashboard` repo
- Permissions: **Contents → Read and write**
- Copy the token (starts with `github_pat_…`)

## 3. Deploy on Railway
1. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → pick your repo.
2. Railway auto-detects Node and runs `npm start`.
3. Open the service → **Variables** → add:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | your token from step 2 |
| `GITHUB_OWNER` | your GitHub username |
| `GITHUB_REPO` | `budget-dashboard` |
| `GITHUB_FILE_PATH` | `data.json` |
| `GITHUB_BRANCH` | `main` |
| `APP_PASSWORD` | *(optional)* a password to lock the dashboard |

4. Under **Settings → Networking**, click **Generate Domain** to get your public URL.

That's it. Open the URL, make a change, and you'll see a new commit appear in your repo.

> **Important:** Without the `GITHUB_*` variables the app still runs, but it saves to a
> local file that Railway wipes on every redeploy. Set the GitHub variables for changes to
> actually be remembered.

---

## Run locally
```bash
npm install
npm start          # http://localhost:3000  (saves to local data.json)
```
To test GitHub sync locally, copy `.env.example` to `.env`, fill it in, then
`node --env-file=.env server.js`.

## Adding a new month
Add a block under `"months"` in `data.json` (or just commit it via GitHub):
```json
"2026-07": {
  "label": "July 2026",
  "budgets": { "Rent & Maintenance": 20000, "Groceries & Outside Food": 10000,
               "Bills & Subscriptions": 4000, "Leisure & Entertainment": 5000,
               "Miscellaneous": 1000 },
  "transactions": []
}
```
It appears in the month dropdown automatically.

## Notes
- Category budgets are stored per month, so you can tweak any month independently.
- Editing `data.json` directly on GitHub and editing in the dashboard both work; the app
  always loads the latest committed version on page load.
