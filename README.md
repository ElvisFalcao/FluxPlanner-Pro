# FluxPlanner‑Pro

A web app for **planning advertising campaign budgets** across TikTok, Instagram,
YouTube and Facebook — country‑aware splits, asset‑type weighting, per‑post budgets,
automatic platform fan‑out, spend tracking, and Excel/CSV/Drive export.

**Live:** https://elvisfalcao.github.io/FluxPlanner-Pro/

## Documentation
- 📘 **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — architecture, every file, data model, Supabase backend + Edge Function APIs, workarounds, setup & deploy.
- 📗 **[Plain‑English Handover](docs/HANDOVER_NON_TECHNICAL.md)** — what it does, how it works, where things live, what it costs, what you maintain.

## Stack at a glance
Vanilla HTML/JS + Tailwind (CDN, no build step) · Supabase (Postgres, Auth, Storage,
Edge Functions) · Google Drive (GIS) · hosted on GitHub Pages.

## Run locally
```bash
npm install && npm run dev   # http://localhost:5173 (any static server also works)
```
Deploy = `git push origin main` (GitHub Pages auto‑updates; no build step).

> `PROJECT.md` is the original project brief and is kept for history; the docs above are the current source of truth.
