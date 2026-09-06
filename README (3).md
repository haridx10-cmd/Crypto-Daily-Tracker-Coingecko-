# Survivor Board — deploy notes

Daily on-chain count for @obewan_gains. Free data sources, no API keys.

## The thing you need to know first

**No free API can tell you what launched yesterday.** GeckoTerminal's `new_pools`
endpoint is a rolling window of the most recent pools only — ask it tomorrow and
today is already gone. So this is two jobs, not one:

- `collect.ts` runs **every 15 minutes** and records new pools as they appear. This is the memory.
- `report.ts` runs **once a morning** and checks which of the 24–48h-old cohort survived.

**Consequence: the first real Survivor Board is publishable ~48 hours after the
collector goes live.** Not the same day. Plan the pinned-post promise around that.

## Why there are two schedulers

**Vercel Hobby only allows daily-or-slower native cron jobs.** `/api/report` runs
once a day, so it stays in `vercel.json` on Vercel's own cron. `/api/collect`
needs to run every 15 minutes, which Hobby rejects outright — the whole deploy
fails with a "Hobby accounts are limited to daily cron jobs" error if you put it
in `vercel.json`.

The fix costs nothing: **GitHub Actions runs the 15-minute trigger instead.**
Nothing stops an external caller from hitting `/api/collect` as often as it
likes — the daily limit is specifically about jobs *Vercel itself* schedules.
The workflow is already in this repo at `.github/workflows/collect.yml`; it
just needs two secrets (step 4 below).

(If you'd rather keep everything native to Vercel, Pro is $20/mo and removes
the cron-frequency limit entirely — not worth it just for this.)

## Deploy checklist (do these in order — skipping ahead is how the last deploy went wrong)

1. **Supabase** → SQL editor → run `schema.sql`. Confirm two tables exist: `launches`, `boards`.
2. **Vercel** → New Project → Import this GitHub repo. Framework preset: **Other** (this is not Next.js — plain `/api` functions). Do not pick a starter template; the importer should read `package.json` and `vercel.json` from this repo directly.
3. **Env vars** (Project → Settings → Environment Variables):
   - `SUPABASE_URL` — from Supabase → Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — same page, the **service_role** key, not the anon key
   - `CRON_SECRET` — any long random string you make up, e.g. `openssl rand -hex 32`
4. **GitHub repo secrets** (Settings → Secrets and variables → Actions → New repository secret) — this is the step that's easy to skip and the whole collector silently does nothing without it:
   - `VERCEL_APP_URL` — your deployed URL, e.g. `https://survivor-board.vercel.app` (no trailing slash)
   - `CRON_SECRET` — **the exact same string** you set in Vercel's env vars in step 3. If these two don't match, `/api/collect` returns 401 forever and Actions will show a red X on every run.
5. Deploy on Vercel (if you haven't already after step 3).
6. **Visit `https://<your-app>.vercel.app/api/health` in a plain browser.** No auth needed. If this doesn't return `{"ok":true,...}` with all three env flags `true`, stop here — the deploy or env vars are broken and nothing past this point will work. This is the single most useful debugging step; check it first every time something "isn't working."
7. Confirm the root `/` shows the plain "pipeline is running" page, not a dashboard. If it shows anything else, a different project or a cached deployment is still live — check Vercel → Deployments for what's actually serving traffic.
8. Go to the repo's **Actions** tab → `collect` workflow → **Run workflow** to trigger it by hand once. It should go green within a few seconds. If it's red, open the log — it's almost always the two secrets in step 4 not matching, or `VERCEL_APP_URL` having a typo or trailing slash.
9. Check Supabase's `launches` table has rows after that run.
10. Check Vercel → Project → **Cron Jobs** tab — `/api/report` should be listed with its schedule. It won't have a run yet.
11. Leave both schedulers running for 48h from step 8. Then `/api/report` fires on its own and produces the first real board — no manual step needed. Meanwhile you can peek at the Actions tab every so often to confirm `collect` is still going green every 15 minutes.

## Not validated against the live API

I could not reach `api.geckoterminal.com` from the environment I wrote this in —
outbound egress is restricted there by policy. The logic and the schema are right;
the exact JSON field names come from GeckoTerminal's documented v2 shape and should
be confirmed on your first run. Expect to adjust `attributes.volume_usd.h24` and
`attributes.transactions.h24` if they've moved. Run `/api/collect` once and log the
raw response before trusting the numbers.

## The survival definition

Alive at 24h = **≥ $5,000 liquidity AND ≥ $1,000 of 24h volume.**

Publish this. Put it in a pinned reply or the bio. Someone will ask how you're
counting, and "here's the exact bar, argue with it" is the entire credibility
play — it's the difference between a data account and a vibes account. If you
change the threshold later, say that you changed it and restate the old numbers
under the new bar.

## The rule the code enforces

`report.ts` emits `[YOUR READ — one sentence]` in every draft. **Do not delete
that step.** X's Original Content Rewards excludes "aggregated compilations
lacking substantial perspective." A bot posting a number is exactly that. The
human sentence is what makes it original content — and it's also the only part
anyone remembers.

## What to build next, in order

1. **Bucket the survivors by more than liquidity** — LP burned/locked, holder
   count at hour 1, deployer wallet history. That's where the actually useful
   pattern lives, and it's what turns the daily count into a thesis.
2. **Week-over-week** — the `boards` table exists so you can post "survival rate
   this week vs last." Trend beats snapshot.
3. **Order 66 feed** — flag cohort members that went from alive to zero liquidity
   inside an hour. That's a rug with a timestamp, and it writes its own post.
