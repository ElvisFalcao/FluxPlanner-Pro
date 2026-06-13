# FluxPlanner‑Pro — Developer Guide

> Technical handover for anyone picking up this codebase. Covers the architecture,
> every source file, the data/budget model, the Supabase backend + Edge Function
> APIs, the non‑obvious workarounds (and *why* they exist), local dev, and deploy.
>
> Companion doc for non‑developers: [`HANDOVER_NON_TECHNICAL.md`](HANDOVER_NON_TECHNICAL.md).

---

## 1. What it is

FluxPlanner‑Pro is a **campaign budget planner**. A user builds an advertising
campaign as a 4‑step wizard and gets a fully broken‑down budget table they can
track and export.

1. **Campaign Setup** — name, target country, total budget (USD), USD→ZAR rate.
2. **Activations** — the posts/drops (name, date, asset type). Each is given a budget.
3. **Platform Splits** — how budget divides across TikTok / Instagram / YouTube / Facebook.
4. **Budget Plan** — the generated table (per post × platform), with actual‑spend tracking and exports.

The clever bits: country‑aware platform splits, asset‑type budget weighting,
per‑post budget overrides, automatic platform fan‑out + per‑platform objectives,
and three ways to use it (Google owner, email/password accounts, or guest).

---

## 2. Tech stack

| Layer | Choice | Notes |
|------|--------|-------|
| Markup/logic | **Vanilla HTML + JavaScript** | No framework, no bundler. Plain `<script>` tags. |
| Styling | **Tailwind CSS (Play CDN)** + `style.css` | No build step — Tailwind is loaded at runtime from the CDN. Custom design tokens live in `:root` of `style.css` and a mirrored Tailwind config inside `index.html`. |
| Fonts | Inter + Space Grotesk (Google Fonts) | |
| Excel export | **SheetJS (xlsx)** via CDN | |
| Database / Auth / Storage / Functions | **Supabase** | Postgres + GoTrue auth + Storage + Deno Edge Functions. |
| Google Drive | **Google Identity Services (GIS)** + `gapi` | Loaded on demand. Scope `email profile drive.file`. |
| Hosting | **GitHub Pages** | Static site, auto‑deploys from `main`. (Was Netlify; moved off — see §10.) |

**Design choice: no build step.** Everything runs as static files. This keeps
deploys trivial (push → GitHub Pages serves the repo root). The `vite` /
`tailwind.config.js` / `postcss.config.js` files exist from an earlier setup but
are **not** used at runtime.

---

## 3. Repository layout

```
index.html            All screens + modals + inline Tailwind config + script includes
config.js             Public keys: Google OAuth (client id + API key) and Supabase (url + anon)
data.js               Static config: countries, platforms, asset weights/eligibility, objectives
budget-engine.js      Pure budget math (no DOM): buildPlan, budget distribution, formatters
app.js                App state, wizard UI, budget table, snapshot/persist, import, toasts
plans.js              Google Drive CRUD + dashboard/overview rendering + plan-card handlers
accounts.js           Session model, Supabase auth, guest mode, storage ROUTING, settings, admin
export.js             Excel/CSV export + Google OAuth (token client, caching, Drive connect)
Logo-Labs-Icon-1.png  Brand logo
style.css             Design system (Black & Gold palette) + component styles + responsive
.nojekyll             Tells GitHub Pages to serve files as-is
supabase/functions/   Mirrored source of the deployed Edge Functions (see §9)
docs/                 This guide + the non-technical handover
```

Script load order (bottom of `index.html`) matters:
`config.js → data.js → budget-engine.js → export.js → plans.js → accounts.js → app.js`.
Functions are called at runtime, so cross‑file references resolve as long as the
file defining a function loads before the function is *invoked* (not before it's referenced).

---

## 4. Architecture: sessions & storage routing

There are **three session types**, tracked in `window.appSession.type`:

| Type | How you get in | Where plans are stored |
|------|----------------|------------------------|
| `google` | "Sign in with Google" (the owner path) | The user's **Google Drive** (`FluxPlanner-Pro` folder, JSON files) |
| `account` | Email + password (Supabase Auth) | **Supabase `plans` table** |
| `guest` | "Continue without an account" | **Browser `localStorage`** |

`accounts.js` exposes a **routing layer** so the rest of the app never cares which
backend is active:

```
savePlanRouted(snapshot)      → savePlanToDrive | dbSavePlan | guestSavePlan
listPlansRouted()             → listPlansFromDrive | dbListPlans | guestListPlans
loadPlanRouted(id)            → loadPlanById | dbLoadPlan | guestLoadPlan
updatePlanRouted(id, snap)    → updatePlanInDrive | dbUpdatePlan | guestUpdatePlan
deletePlanRouted(id)          → deletePlanFromDrive | dbDeletePlan | guestDeletePlan
```

```mermaid
flowchart TD
  A[User action: save/list/edit/delete] --> R{currentSessionType()}
  R -->|google| D[Google Drive REST]
  R -->|account| S[Supabase plans table]
  R -->|guest| L[localStorage]
```

Every plan object carries a generic **`_id`** (Drive file id / DB row uuid / local
id) so the dashboard and handlers are storage‑agnostic.

### Session restore on load
`initSession()` (in `accounts.js`, on `DOMContentLoaded`) decides the landing screen:
1. Supabase session exists → `account`, show dashboard.
2. Else cached Google token valid → `google` (via `restoreGoogleSessionIfCached()` in `export.js`), show dashboard.
3. Else → login screen.

---

## 5. Domain logic (in `data.js` + `budget-engine.js`)

### Countries (`COUNTRY_DATA`)
Each country has a flag, `tiktokAllowed`, and recommended platform `splits` (%).
TikTok is unavailable in Angola/Ghana/Zambia → their splits set TikTok to 0 and
redistribute. Angola defaults Facebook‑leaning.

### Asset types
- **Budget weight** (`ASSET_WEIGHTS`): Video 1.0, Animated Static 0.65, Static 0.45 — controls each post's *share* of the budget when on "auto".
- **Platform eligibility** (`ASSET_PLATFORM_ELIGIBILITY`): Video → all 4; Animated Static → TikTok/IG/FB; Static → IG/FB. Intersected with country availability.

### Per‑platform objectives (`PLATFORM_OBJECTIVES`)
TikTok & YouTube → *Video Views*; Instagram → *Engagement*; Facebook → *Reach*.
Assigned automatically to each generated row (no manual objective selection).

### The budget model (two independent dimensions)
1. **How much each post gets** — `computeActivationBudgets()`: posts marked
   *locked* keep their pinned `budget`; the rest share the remainder in proportion
   to their asset weight. (When nothing is locked, this equals the plain
   asset‑weighted split.)
2. **How a post's budget splits across platforms** — `calcPlatformAmounts()`:
   each post fans out only to its **eligible** platforms, re‑normalizing the Step‑3
   slider % across just those platforms. So a Static post's IG:FB ratio is whatever
   the sliders say, re‑scaled to 100%.

`buildPlan(state)` ties it together → returns `{ rows, subtotals, grandTotalBudget,
zarGrandTotal, underspend, ... }`. `rows` contains one row per (post × eligible
platform), plus `_isSubtotal` marker rows.

---

## 6. Plan lifecycle & persistence

- A plan in progress is `window.appState` (+ computed `window.planData`).
- **`window.currentPlanId`** = the storage id of the open plan (`null` = new/unsaved).
- `buildSnapshot()` serialises `{ id, savedAt, campaignName, totalBudget, country, exchangeRate, state, planData }`.
- `generatePlan()` (Step 4): if `currentPlanId` is set → **update** that plan; else **create** and store the new id. This is why re‑generating no longer makes duplicates.
- Editing **actual spend** / ticking **complete** calls `persistCurrentPlan()` — a debounced `updatePlanRouted(currentPlanId, buildSnapshot())`.
- Opening a saved plan (`loadPlanIntoApp`) sets `currentPlanId`; "New Campaign" (`startNewPlan`) resets it to `null`.
- **Import** (`app.js`): "Open a FluxPlanner `.json`" reads a previously exported plan and saves it as a **new copy**. **Duplicate** (`plans.js → handleDuplicatePlan`) clones a plan as "`<name> (copy)`". (A manual‑spreadsheet CSV importer existed but was removed as too fragile.)

---

## 7. Authentication

### Google (owner) — `export.js`
- One configured OAuth app; **credentials are baked into `config.js`** (`GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`). Users never paste anything. (The old per‑user "paste your credentials" flow was removed.)
- Uses the GIS **token client** (implicit/token flow), scope `email profile https://www.googleapis.com/auth/drive.file`.
- Token is cached in `localStorage` (`fpro_token`, ~1h expiry). On load we **restore from cache** (no popup). We do **not** auto‑open an OAuth popup on load (browsers block popups without a user gesture).
- Sign‑in tries silent (`prompt:''`) first; if that can't complete it falls back to `prompt:'select_account'` (account picker). It does **not** use `prompt:'consent'` — that forced the full permission screen on every sign‑in. Already‑granted users now just pick their account; new users still consent once.

### Email/password accounts — `accounts.js`
- Supabase Auth `signUp` / `signInWithPassword`. **Email confirmation is OFF** (instant access) — this is a project setting in the Supabase dashboard.
- Guest `localStorage` plans are migrated into the new account on signup (`migrateGuestPlansToAccount`).

### Guest — `accounts.js`
- No auth. Plans in `localStorage` (`fpro_guest_plans`). Export to Excel/CSV only (no Drive). Dashboard shows a "create an account" banner.

### Login logging (for admin visibility)
On every login a row is written to `profiles`:
- Account users upsert their own profile via RLS (`logAccountProfile`).
- Google users go through the **`track-login`** Edge Function (they have no Supabase session, so a service‑role function records them and returns their admin flag).

---

## 8. Admin & roles

- Admin is **role‑based**: `profiles.is_admin`. The owner (`denyfalcao008@gmail.com`, Google) is seeded as the permanent super‑admin and is protected from demotion/deletion.
- `window.isAdminUser` is resolved at login (account: own profile read; Google: `track-login` response). `isAdmin()` also treats the owner email as admin immediately.
- The **Admin page** (`#adminScreen`, a full page — not a modal) has **Users** and **All plans** tabs. Actions: make/remove admin, set password (email users only), delete user. All actions call the **`admin`** Edge Function, which verifies the caller is an admin before doing anything.
- Passwords can be **reset, never viewed** (they're one‑way hashed).

---

## 9. Supabase backend

Project ref: `yqiufyruxwfnjlcwmfvy` → URL `https://yqiufyruxwfnjlcwmfvy.supabase.co`.

### Tables

**`public.plans`** — RLS: a user reads/writes only their own rows (`auth.uid() = user_id`).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid → auth.users | owner |
| owner_email | text | denormalised for the admin view |
| campaign_name, country | text | |
| total_budget | numeric | |
| data | jsonb | the full plan snapshot |
| created_at, updated_at | timestamptz | |

**`public.profiles`** — RLS: a user reads/writes only their own row (matched by JWT email). Admins read everyone via the service‑role `admin` function.
| column | type | notes |
|---|---|---|
| email | text PK | |
| display_name | text | |
| provider | text | `email` \| `google` |
| user_id | uuid | set for email/password users |
| is_admin | boolean | role flag |
| created_at, last_seen_at | timestamptz | |

### Storage
- Bucket **`avatars`** (public read; per‑user write RLS keyed on `{uid}/...` folder). Avatar URL stored in the user's auth `user_metadata.avatar_url`.

### Edge Functions (Deno/TypeScript; source mirrored in `supabase/functions/`)

All set CORS `*` and (where they do their own auth) are deployed with `verify_jwt = false`.

| Function | Auth | Purpose |
|---|---|---|
| **`delete-account`** | caller's Supabase JWT | Deletes the calling user's plans, avatar files, and auth user. |
| **`track-login`** | `x-google-token` (verified via Google tokeninfo, must match our client id) | Upserts a Google user's `profiles` row on login; returns `{ is_admin }`. |
| **`admin`** | `x-google-token` **or** `Authorization: Bearer <supabase jwt>`; caller's email must have `profiles.is_admin = true` | Body `{ action, ... }`. Actions below. Owner protected. |
| `admin-plans` | (legacy) | Superseded by `admin`'s `list_plans`; still deployed, unused by the app. |

**`admin` actions** (POST JSON body):
- `{ action: "list_users" }` → `{ users: [{ email, display_name, provider, user_id, is_admin, created_at, last_seen_at, plan_count }] }`
- `{ action: "list_plans" }` → `{ plans: [...] }`
- `{ action: "set_admin", email, isAdmin }` → `{ ok: true }` (owner can't be demoted)
- `{ action: "set_password", email, password }` → `{ ok: true }` (email/password users only)
- `{ action: "delete_user", email }` → `{ ok: true }` (deletes plans + avatars + auth user; owner protected)

Client helper: `adminCall(action, payload)` in `accounts.js` (raw `fetch` so it can read the JSON error message; sends `x-google-token` for Google admins or the account JWT for account admins).

---

## 10. Configuration & external setup (owner‑maintained)

These live outside the repo and must be kept in sync:

1. **Google Cloud OAuth client** (`config.js` → `GOOGLE_CLIENT_ID` / `GOOGLE_API_KEY`):
   - **Authorized JavaScript origins** must list every domain the app runs on:
     `https://elvisfalcao.github.io` and `https://fluxplanner-pro.netlify.app` (and `http://localhost:5173` for local dev). Google sign‑in fails on origins not listed here.
   - The **API key** should be restricted (HTTP referrers = app domains; API = Google Drive API).
   - The OAuth consent screen is **published** (so any Google user can consent). The `email profile drive.file` scopes are non‑sensitive enough to avoid heavy verification.
2. **Supabase** (`config.js` → `SUPABASE_URL` / `SUPABASE_ANON_KEY`): the URL and the **publishable/anon** key are safe to ship because RLS restricts access. **Never** put the service‑role key in the frontend — it only lives inside Edge Functions (injected as `SUPABASE_SERVICE_ROLE_KEY`).
   - Auth → **Email confirmation must be OFF** for instant signup.
3. **Hosting**: GitHub Pages serves the repo root on push to `main`. `.nojekyll` keeps files un‑processed.

> Note: the app moved off **Netlify** because its free tier switched to a credits
> model that took the site offline once credits ran out. GitHub Pages has no such limit.

---

## 11. Run locally & deploy

**Local dev** (any static server works; the project includes a Vite dev config used only for convenience):
```bash
npm install      # only needed if using vite
npm run dev      # serves on http://localhost:5173
```
Add `http://localhost:5173` to the Google OAuth Authorized origins to test Google sign‑in locally. Supabase email/password + guest work from any origin.

**Deploy**: commit and `git push origin main`. GitHub Pages rebuilds automatically. No build step.

**Edge Functions** are deployed to Supabase (originally via the Supabase MCP / dashboard). The source of record is `supabase/functions/<name>/index.ts`; redeploy with the Supabase CLI (`supabase functions deploy <name>`) or the dashboard.

---

## 12. Workarounds & gotchas (read before changing things)

- **Drive delete uses `PATCH { trashed:true }`**, not the v2 `POST .../files/{id}/trash` (which doesn't exist in Drive **v3** and fails as a browser "Failed to fetch"). All other Drive calls use v3 endpoints.
- **No auto OAuth popup on page load** — browsers block popups without a user gesture. We restore from the cached token instead; the popup only fires on the sign‑in button click.
- **Google sign‑in prompt = `select_account`, never `consent`** — forcing `prompt:'consent'` re‑showed the permission screen on every sign‑in (the silent `prompt:''` attempt frequently fails under third‑party‑cookie restrictions, so the fallback ran constantly). `select_account` lets granted users through with just an account pick.
- **Screen management** — there are four mutually‑exclusive top‑level screens: `#loginScreen`, `#dashboardScreen`, `#appWrapper` (the wizard), and `#adminScreen` (a full page, not a modal). Each `show*` function (`showDashboard`, `showWizard`, `showLoginScreen`, `showAdminScreen`) must hide **all** the others — including `#adminScreen`. Forgetting to hide `#adminScreen` made it linger below the dashboard after visiting Admin.
- **Login screen scroll**: it's a `position:fixed` overlay. To both center the card *and* let it scroll on short windows, the card sits in a `min-height:100%` flex‑column wrapper with `margin-block:auto` (plain `align-items:center` clipped the top and couldn't scroll).
- **Admin for Google users**: they have no Supabase session, so admin Edge Functions verify the **Google access token** via Google `tokeninfo` (checking `aud` == our client id and the email). Account admins are verified via their Supabase JWT instead.
- **`adminCall` uses raw `fetch`** (not `supabase.functions.invoke`) so it can read the function's JSON error message cleanly.
- **Hardcoded constants in Edge Functions**: `CLIENT_ID` and `OWNER_EMAIL` are duplicated in `track-login`/`admin`/`admin-plans`. If you rotate the OAuth client or change the owner, update them there too.
- **Tailwind palette lives in two places**: the inline `tailwind.config` in `index.html` *and* `style.css` `:root`. Keep them consistent.
- **Excel/CSV export & Drive folder logic** live in `export.js` / `plans.js` and use the raw Google REST APIs with `window.accessToken`.

---

## 13. Current status & roadmap

**Done & live:** premium Black‑&‑Gold reskin; one‑click Google sign‑in; smart
activations (auto platform fan‑out + per‑platform objectives); per‑post budgets
(lock + auto‑rebalance); mobile responsiveness; accounts + guest mode; account
settings (avatar, name, password, connect Drive, delete account); import (open
`.json`) + duplicate; overview dashboard with spend/completion tracking; full
admin user‑management console with roles.

**Next / pending:**
- **Sharing & collaboration (D)** — DB‑based: invite by email, the plan appears in
  their dashboard, both can edit the same plan (needs a `plan_shares` table + RLS).

**Parked (need their own design pass):** ads‑spend tracking (Meta/TikTok/Google/
YouTube — needs Edge Functions + each platform's API), post reminders/scheduling,
deeper campaign‑progress analytics, multi‑country "tabs" within one plan.

---

## 14. Security notes

- Anon/publishable Supabase key + Google client id/API key are **public by design**; security rests on **RLS** (table access) and **origin/referrer restrictions** (Google).
- The **service‑role key never leaves Edge Functions.**
- All cross‑user/admin operations go through **service‑role Edge Functions that re‑verify the caller**; the browser is never trusted for authorization.
- RLS confines every normal user to their own `plans`/`profiles` rows.
