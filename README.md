# CheckAble

A local, recruiter-controlled web app for exploring resume evidence. Built with Next.js, TypeScript, and Tailwind. Assessments use your configured **Jev MCP** server. OpenRouter generates proposed questions and interprets explicit search requests; it never ranks candidates.

## Run locally

Requires Node.js 20.9+ (tested with Node 24.14.1).

```powershell
npm install
# For a new checkout, copy .env.example to .env.local and configure it.
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds to loopback. For a production build on the same computer:

```powershell
npm run build
npm start
```

Both API credentials can be inherited from the environment. The already-configured local workspace only needs its ignored `.env.local` entry pointing to the existing MCP server:

```dotenv
JEV_MCP_SERVER=C:/absolute/path/to/jev-mcp/scripts/server.mjs
```

The complete environment template is in `.env.example`. Credentials never use a `NEXT_PUBLIC_` variable. The interface, imports, manual question editing, and saved roles work without credentials; provider actions explain the missing setup. There is no mock mode in the application.

## Explore the workflow

1. Run `npm run dataset:demo` for the prepared 1,000-resume workspace at **http://127.0.0.1:3001**, or import your own JSON, CSV, or plain-text resumes.
2. **Verify Jev** once. This pins the returned model version. OpenRouter is optional for generated role questions and natural-language search.
3. Select a saved role and open the **Question library**. All 23 built-in definitions are available: seven shared resume questions and the original 16 work-evidence, experience-detail, and writing-diagnostic questions. Select individual questions or groups, inspect their complete definitions, and save the selection. Questions can be edited or added. Assessability always runs; the seven shared questions can be switched off.
4. Add a job description and use **Generate questions** to propose focused assessments. Review, edit, remove, or regenerate proposals before approval. Separately approve the criteria and alternatives used in the active role brief. Only the native `role_relevance.score` orders candidates, with ID ties; with no relevance score, candidates stay in ID order.
5. **Scan 1,000 resumes** explicitly starts the pool scan using the saved selection. One square represents each resume, with genuine pending, scanning, saved, and failed states. The browser drives resumable batches; keep the tab open and use **Pause scan** when needed. **Evaluate resume** processes only the selected resume.
6. Read the original resume beside compact bars for the selected questions. Expand a bar for the complete definition, rubric or category probabilities, native confidence where provided, saved model/date, and supporting passages. General answers are reusable across roles. Date-dependent experience answers include the actual UTC assessment date; earlier and missing answers remain available without fabricated scores.
7. Refine the pool through the visible natural-language search or **Answer filters**. Review each interpretation with **Apply / Edit / Cancel**. Existing-answer filters use saved results without provider calls; approved new questions or revised relevance criteria evaluate only the missing or changed answers.

Existing workspaces retain their saved selections and answers. A one-time migration records the previously implicit seven questions as explicit selections and restores missing library definitions without overwriting edits. Later deselections remain off. A paused scan from a different question selection must be replaced with a new scan; current cached answers are reused.

Sample roles are implementation consultant, backend engineer, and financial analyst. Fixtures include direct and transferable work, keyword-only claims, missing detail, equivalent plain/polished versions, and an instruction-injection example. All 16 are fictional. The library and sample role criteria are prototypes, not validated hiring measures.

## Imports and storage

The prepared mixed dataset contains **500 Djinni profiles + 500 synthetic resumes + 20 JDs**. Run `npm run dataset:demo` to open it in a separate workspace at **http://127.0.0.1:3001**, or import `data/datasets/hackathon/candidates.json` manually. Run `npm run dataset:build` on a fresh checkout. See [dataset files, source attribution, and reproduction steps](docs/DATASET.md). Opening it makes no model calls. Resume-only questions need no approved role brief; approve role criteria before adding role relevance.

Canonical JSON:

```json
[{ "id": "c001", "name": "Example Candidate", "text": "Original resume text..." }]
```

CSV requires a header row; select ID, optional name, and resume-text columns. Quoted multiline CSV is supported. Plain text is one resume, or multiple resumes separated by a line containing `---CANDIDATE---`. Blank lines remain inside each resume. Downloads are at `/samples/candidates.json`, `/samples/candidates.csv`, and `/samples/jobs.json`.

JSON records may include an optional boolean `fictional` field to label synthetic data without modifying source text. It is display metadata only and never affects assessment or ranking.

Limits: 20 MB per upload, 10,000 records per import, 100,000 characters per resume. Invalid/empty records and duplicate IDs reject the entire import. Text is never silently truncated. Provider context limits can still reject a long record; it remains visible as failed.

Ignored `data/` contains `workspace.json` and per-candidate answer/evidence files. Writes use temporary files and atomic rename; metadata updates are serialized. Run one application server per data directory. Use `CANDIDATE_DATA_DIR` for an alternate local directory. Back up this directory if the records matter. This workspace lives under OneDrive, so the operating system's OneDrive settings may sync local files.

The browser drives independent workers, with bounded JEV concurrency (default 5, configurable from 1–10). Each worker requests one resume and picks up another as soon as it finishes; a slow call does not block the other workers. The server claims records atomically and enforces the limit across overlapping tabs. Progress refreshes separately from scheduling; the full results list refreshes at most about every three seconds during a scan. **Keep the tab open**. Pause stops scheduling new work; current calls can finish and save. Refresh/restart requires a manual **Resume**. Failed records can be retried without repeating completed bundles. Elapsed time counts overlapping requests once. This is not durable background processing.

Cache identity includes full resume/state hash, question ID/version/payload, applicable role/rubric revision, and actual JEV model version. General questions use resume-only state and can be reused across jobs. Earlier answers remain inspectable as stale; the current ranking never mixes role/model revisions.

Resume content is untrusted evidence. It is rendered as text, not executed HTML/scripts/links. Local operation still sends resume content to TypeSafe/JEV. OpenRouter gets role/question definitions and recruiter requests, never the resume pool. Use synthetic or authorized data.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

Automated tests mock provider adapters and HTTP separately from live mode. They cover imports, quotes and generation repair, constrained search plans, direct-score ranking, all-pool filters, revisions/cache invalidation, cancellation/resume/retry, native answers/evidence, persistence, local-origin checks, and secret isolation.

Generate a local load fixture without any provider calls:

```powershell
npm run fixtures:load -- 1000
```

This creates `data/load-1000.json`. Records are templated fictional load data, not an accuracy benchmark. Import it manually; do not run a live 1,000-record test unintentionally.

A deliberately opt-in live smoke script uses six fictional records plus one OpenRouter generation and one interpretation call:

```powershell
npm run smoke:live -- --allow-live
```

The script writes `data/live-smoke-report.json` and never changes the UI candidate pool. It uses the same MCP adapter and requires configured credentials. It checks keyword-only, plain/polished, injection, and same-project examples; it does not assert model invariance or hiring validity. See `docs/VALIDATION.md` for the actual checks performed and `docs/INTEGRATION_NOTES.md` for API decisions.

## Scope

This version has no hosting/deployment, authentication, ATS pipeline, outreach, scheduling, cloud/vector database, Redis, separate worker, PDF/DOCX parser, or Solari integration. Scores and confidence are model judgments for inspection, not verified work histories or hiring-success probabilities. Writing diagnostics remain separate from role relevance and never claim verified AI authorship, fraud, or honesty.
