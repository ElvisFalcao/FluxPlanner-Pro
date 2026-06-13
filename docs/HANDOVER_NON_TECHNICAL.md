# FluxPlanner‑Pro — Plain‑English Handover

> A non‑technical guide to what this app is, how it works, where everything lives,
> what it costs, and the few things you (the owner) need to keep an eye on.
>
> For the technical version, see [`DEVELOPER_GUIDE.md`](DEVELOPER_GUIDE.md).

---

## What it is

FluxPlanner‑Pro is a web app for **planning advertising campaign budgets**. You tell
it your total budget and which platforms you're advertising on (TikTok, Instagram,
YouTube, Facebook), and it works out exactly how much money goes where — then lets
you track what you actually spent and export it to Excel.

**Live site:** https://elvisfalcao.github.io/FluxPlanner-Pro/

---

## How a plan gets made (the 4 steps)

1. **Campaign Setup** — name the campaign, pick the country, enter your total budget
   and the dollar‑to‑rand exchange rate.
2. **Activations** — add each post or content drop (a name, a date, and whether it's
   a Video, an Animated graphic, or a Static image). You can give each post its own
   budget, or let the app split it automatically.
3. **Platform Splits** — slide how much of the budget goes to each platform. The app
   already suggests a split based on the country you chose.
4. **Budget Plan** — the app produces a full table: every post, on every platform it
   should run on, with the exact amount, the goal for that platform, and a place to
   record what you actually spent.

**Smart things it does for you:**
- A **Static image** automatically *won't* be placed on TikTok or YouTube (those are
  video‑first), so it only spreads across Instagram and Facebook.
- Each platform gets a sensible **goal automatically** — Facebook → Reach, Instagram →
  Engagement, TikTok & YouTube → Video Views.
- If a country doesn't allow TikTok ads (e.g. Angola), it's left out and the budget
  is shared among the others.
- You can mark one post as more important (give it a bigger budget) and the rest
  rebalance automatically so the total always stays exact.

---

## The three ways people use it

| Way in | Who it's for | Where their plans are saved |
|--------|--------------|------------------------------|
| **Sign in with Google** | **You (the owner/admin)** | Your **Google Drive** |
| **Create an account** (email + password) | Regular users | Securely in the app's **cloud database** |
| **Continue without an account** (guest) | Anyone just trying it | Only in **their own browser** |

- **Guests** can build plans and export to Excel/CSV, but can't save to the cloud —
  the app gently nudges them to create a free account.
- When a guest **creates an account**, the plans they made are carried over.
- **Accounts are instant** — no "check your email to confirm" step.

---

## Your account settings

Logged‑in account users get a **Settings** panel (the gear icon) where they can:
- upload a **profile photo** and set a **display name**,
- **change their password**,
- **connect Google Drive** (optional) to also save/export there,
- **delete their account** entirely.

---

## The admin console (just for you)

When **you** sign in with Google, an **Admin** button appears. It opens a dedicated
page with two tabs:

- **Users** — everyone who has used the app: their email, name, how they log in
  (Google or email), how many plans they have, and whether they're an admin. For each
  person you can:
  - **Make them an admin** (or remove it),
  - **Set a new password** for them (email/password users only),
  - **Delete** them and their plans.
- **All plans** — every campaign across all users, with totals (budget, spent,
  completion).

A couple of important truths:
- **You can't *see* anyone's password** — passwords are stored scrambled and even the
  system can't read them. You *can* set a new one for them.
- **People show up in the list from the next time they log in** (the app only started
  keeping a record recently).
- **You can't accidentally remove yourself** as the owner — that's locked.

> **To switch the Admin button on:** sign out and **sign in with Google again** once.
> The app recently asked for permission to see your email (so it knows you're the
> admin); approving that one time activates the console.

---

## Where everything lives & what it costs

- **The website** is hosted free on **GitHub Pages**. Every time a change is saved,
  the live site updates automatically.
- **Accounts, saved plans, profiles, and the admin tools** run on **Supabase** (a
  cloud database service) — currently on its **free tier**.
- **Google sign‑in & Google Drive saving** use a free Google account/project that
  you own.

So today the running cost is **$0** on free tiers. (We moved off a previous host,
Netlify, because its free plan started charging "credits" and took the site offline
when they ran out — GitHub Pages doesn't do that.)

---

## The few things *you* own and maintain

You don't need to touch code, but three accounts belong to you and keep the app working:

1. **Google Cloud (sign‑in & Drive):** if the app ever moves to a new web address,
   that address must be added to the Google sign‑in settings, or the Google button
   stops working. (A developer does this in minutes.)
2. **Supabase (the database):** this holds all accounts and plans. Keep the login safe.
3. **The web address:** `elvisfalcao.github.io/FluxPlanner-Pro` is the permanent home.

If you bring on a developer, point them at the **Developer Guide** — it has every
detail they need.

---

## What's built today

✅ Premium look & feel · ✅ One‑click Google sign‑in · ✅ Smart posts (auto platforms +
goals) · ✅ Per‑post budgets · ✅ Works on phones · ✅ Accounts + guest mode · ✅ Profile
settings · ✅ Import & duplicate plans · ✅ Overview dashboard (budget vs spent vs
completion) · ✅ Full admin console.

## What's next

- **Sharing & teamwork** — invite someone by email to view/edit the same plan together.

## Ideas parked for later (need proper planning)

- Connecting **Meta / TikTok / Google / YouTube ad accounts** to pull in real spend
  automatically.
- **Reminders** for when posts should go out.
- Deeper **performance dashboards**.
- One campaign run across **several countries as tabs** in a single plan.

---

## A quick glossary

- **Activation / post** — one piece of content in your campaign (a video, image, etc.).
- **Platform split** — how your budget is divided across TikTok, Instagram, etc.
- **Objective** — the goal for an ad (Reach, Engagement, Video Views…).
- **Account vs Guest** — an account saves to the cloud; a guest only saves in their browser.
- **Admin** — you; full control to see and manage all users and plans.
- **Supabase** — the cloud service that stores accounts and plans.
- **GitHub Pages** — the free service that hosts the website.
