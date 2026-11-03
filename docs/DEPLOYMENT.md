# Deploying PAUSE AI Tutor

PAUSE has two parts:

1. **Supabase** (database, sign-in, and three edge functions: `ai-tutor`, `ai-assessor`, `run-python`).
2. **The website**: a static React app (the `dist/` folder after `npm run build`), hosted on Netlify, Vercel, Cloudflare Pages or a university web server.

Use an **EU region** for Supabase (e.g. Frankfurt or Stockholm) so research data stays in the EU.

## Quick path: Supabase project created by Bolt + Netlify

No command-line tools needed.

1. **Database:** Supabase → SQL Editor → New query → paste all of [`supabase/manual/apply_2026-11_updates.sql`](../supabase/manual/apply_2026-11_updates.sql) → Run. Then run the checks at the bottom of that file (researcher accounts).
2. **Auth:** Authentication → Sign In / Providers → Email → turn on **Confirm email**.
3. **Edge functions:** in GitHub → Settings → Secrets and variables → Actions, add `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens) and `SUPABASE_PROJECT_REF`. Then Actions → **Deploy Supabase edge functions** → Run workflow. Later changes to the functions deploy automatically.
4. **Secrets:** Supabase → Edge Functions → Secrets: `OPENAI_API_KEY` (and later `ALLOWED_ORIGIN`).
5. **Website:** Netlify → Add new site → Import an existing project → GitHub → PAUSETUTOR. Build settings come from `netlify.toml`. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API), then deploy. Every push to `main` redeploys.
6. Put the Netlify address into `ALLOWED_ORIGIN` (step 4) and into Supabase → Authentication → URL Configuration → **Site URL**.
7. Work through the launch checklist at the end of this page.

`supabase/tests/security_check.sh` (run in CI) applies the original migrations plus this update file to a plain PostgreSQL and checks the row-level security, so the update file is tested on every change.

The detailed steps for other setups follow.

## 1. Supabase project

1. Create a project at supabase.com (EU region). Note the **Project URL**, the **anon public key** and the **project ref** (Settings → API).
2. **Apply the database migrations.** Every file in `supabase/migrations/` must be applied, in filename (date) order. Either:
   * **Supabase CLI** (recommended):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   * **SQL Editor:** open each file in date order, paste it in, and click Run.
   * **Project already created by Bolt?** The earlier migrations are already applied. Run only the files dated **2026-11-03 or later** (`20261103…` onwards) in the SQL Editor, in order.
3. **Authentication → Sign In / Providers → Email:** turn **Confirm email** on.
4. **Authentication → URL Configuration:** set **Site URL** to the website address (step 3 below).

## 2. Edge functions and secrets

Set the secrets (Edge Functions → Secrets, or with the CLI):

| Secret | Required | Value |
|---|---|---|
| `OPENAI_API_KEY` | yes | Your OpenAI API key. Without it the tutor answers with a placeholder. |
| `ALLOWED_ORIGIN` | yes, once the site is live | The website address, e.g. `https://pause-tutor.netlify.app` (comma-separate several; add `http://localhost:5173` for local development) |
| `OPENAI_MODEL` | no | Tutor model (default `gpt-4o-mini`) |
| `OPENAI_ASSESSOR_MODEL` | no | Assessor model (default: same as `OPENAI_MODEL`) |
| `AI_DAILY_LIMIT` | no | AI requests per student per 24 h (default 40) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... ALLOWED_ORIGIN=https://your-site.example
```
```bash
npx supabase functions deploy ai-tutor ai-assessor run-python
```

In the OpenAI dashboard, set a **monthly spending limit** (Settings → Limits).

## 3. Website

Build settings for any static host:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 |
| Environment variable `VITE_SUPABASE_URL` | Project URL from step 1 |
| Environment variable `VITE_SUPABASE_ANON_KEY` | anon public key from step 1 (safe to expose; access is controlled by database policies) |
| Environment variable `VITE_CODE_RUNNER` | optional. Default `browser`: code runs in the student's browser and falls back to the `run-python` function (which uses the public Judge0 service, outside the EU) only if Python cannot load. `browser-only`: never send code to a server. `server`: always use `run-python`. |

The build copies the Python runtime (Pyodide, about 13 MB, downloaded once per browser and then cached) to `dist/pyodide/`. The host must serve `.wasm` files as `application/wasm`; Netlify, Vercel and Cloudflare Pages do this by default. The app uses hash routes (`/#/...`), so no redirect rules are needed.

After the first deploy, put the site address into `ALLOWED_ORIGIN` (step 2) and **Site URL** (step 1.4).

## 4. Accounts

* Everyone signs up as a **student**.
* Promote researchers in the SQL Editor:
  ```sql
  UPDATE profiles SET role = 'researcher' WHERE email = 'name@uef.fi';
  ```
* Check who has researcher access:
  ```sql
  SELECT email, role, created_at FROM profiles WHERE role = 'researcher';
  ```

## 5. Before participants use it

- [ ] All migrations applied; **Confirm email** on
- [ ] Secrets set; functions deployed; `ALLOWED_ORIGIN` = live site
- [ ] Researcher accounts promoted; no unexpected researchers
- [ ] Tutor configuration: system prompt reviewed and saved; solution gate and follow-up limits set
- [ ] Each study task has visible and hidden tests, checked against a reference solution
- [ ] Smoke test as a student: plan → run code → run tests → ask for a hint and a follow-up → scrutinise → reflect
- [ ] Data Export works and the TNA files open in R
- [ ] Database backups enabled (Supabase → Database → Backups; daily backups need a paid plan, otherwise export weekly)
- [ ] OpenAI spending limit set
