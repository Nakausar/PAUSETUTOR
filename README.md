# PAUSE AI Tutor

A research prototype for studying **metacognitive regulation and temporal patterns of generative-AI use in programming education** (University of Eastern Finland).

Students solve Python tasks in five phases:

| | Phase | What the student does |
|---|---|---|
| **P** | Plan | Describes their approach and rates their confidence |
| **A** | Attempt | Writes and runs code, runs the visible tests |
| **U** | Use AI | Chooses a kind of help (hint, debug, explain, review, question, or a complete solution after a minimum effort) and can ask follow-up questions |
| **S** | Scrutinise | Judges the AI's answer, decides what to do with it, edits and tests code |
| **E** | Evaluate | Reflects on difficulty, independence and learning |

Researchers create tasks with visible and hidden tests, assign them, review sessions on a timeline, approve AI-suggested assessments, run temporal/transition analyses, and export TNA-ready data.

## Documentation

* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Supabase, secrets, hosting, launch checklist
* [docs/EVENT_CODEBOOK.md](docs/EVENT_CODEBOOK.md): every logged event and metadata field, paste-provenance rules, R example
* [docs/DATA_COLLECTED.md](docs/DATA_COLLECTED.md): plain-language summary for ethics and consent forms

## Architecture

```
Browser (React + Vite + Tailwind)
 ├─ Student workspace ── CodeMirror editor
 │                    └─ Python in a Web Worker (Pyodide, self-hosted in /pyodide)
 ├─ Activity logging (paste/copy provenance, focus, idle, 15 s autosave)
 └─ Researcher pages (tasks, tests, timelines, assessment, temporal analysis, exports)
        │
        ▼
Supabase
 ├─ Postgres with row-level security (students see only their own data)
 ├─ Auth (email + password; everyone signs up as a student)
 └─ Edge functions
     ├─ ai-tutor     builds the prompt server-side, enforces limits and the solution gate,
     │               calls OpenAI, writes ai_interactions
     ├─ ai-assessor  researcher-only draft marks and metacognitive ratings
     └─ run-python   fallback code runner (Judge0) when the browser cannot run Python
```

Key source files:

| Path | Purpose |
|---|---|
| `src/pages/TaskWorkspace.tsx` | The five-phase student workspace |
| `src/lib/python/` | Pyodide worker and runner (timeouts, stdin, clean tracebacks) |
| `src/lib/codeRunner.ts` | Run code and test cases (browser first, server fallback) |
| `src/lib/useActivityTracking.ts`, `src/lib/provenance.ts` | Paste/copy provenance, focus and idle logging |
| `src/lib/eventLogger.ts` | Event logging with duplicate protection |
| `src/lib/tnaCodebook.ts`, `src/lib/exporter.ts` | TNA action codebook and data exports |
| `src/lib/temporal/` | In-app temporal and transition analysis |
| `supabase/functions/ai-tutor/prompts.ts` | Recommended tutor prompt and per-category instructions |
| `supabase/migrations/` | Database schema, in date order |

## Local development

Requirements: Node 22, a Supabase project (see [DEPLOYMENT.md](docs/DEPLOYMENT.md)).

```bash
npm install
```

Create `.env.local`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

```bash
npm run dev
```

## Checks and tests

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run test:unit` | Temporal analysis, paste provenance and TNA codebook tests |
| `npm run test:e2e` | Browser tests of the real app against a mocked Supabase (no database or API key needed) |
| `npm test` | Unit and browser tests |
| `npm run build` | Production build into `dist/` |

The browser tests need Chromium once: `npx playwright install chromium`. GitHub Actions runs all checks on every pull request (`.github/workflows/ci.yml`).

## Research use

This is a research prototype. It makes no claims about learning outcomes or regulatory compliance. Participant data is pseudonymised by participant ID in all exports; see [DATA_COLLECTED.md](docs/DATA_COLLECTED.md) before collecting data.

**Authors:** Nabeela Kausar, Friday Joseph Agbo, Mohammed Saqr.
