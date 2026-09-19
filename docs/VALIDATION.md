# Validation record

## Independent parallel Jev workers — September 19, 2026

- Replaced the browser's five-record barrier with independently replenished workers. The server atomically claims one candidate per worker request, caps active work across callers, recovers unowned running records after restart, and counts overlapping processing time once. Full results refreshes no longer gate the next request.
- Typecheck, production build, and **68 automated tests** passed. Mocked regressions hold one call open while all five other records finish, exercise duplicate-claim protection and the server cap, preserve completed bundles through pause/resume, verify elapsed-time accounting, and drain in-flight work after a browser transport failure.
- Separate **live Jev MCP** browser check used six explicitly fictional resumes in `data/parallel-scan-qa-20260919`, with no existing answers. All six completed on `jev-1.13.0`, saving 114 answers with zero failures; reported usage was 22,256 input and 3,075 output tokens. Server processing intervals totaled **874 ms**, excluding browser overhead; this is neither a model-only latency measurement nor a 1,000-record throughput claim. Raw metadata is in ignored `data/parallel-scan-live-report.json`.
- The production browser showed scan completion, all six saved cells, and native answers beside original source text, with no console warnings or errors. All six fixtures were marked insufficient detail; their native answers remain accessible. The actual 1,000-resume workspace and paused run were not changed by this validation.
- After the final build and server restart, a browser rerun reused all 114 answers, reported zero input/output tokens, and completed in 120 ms of server processing. Saved answers survived the restart. The final browser had no console warnings or errors.

## Recruiter workflow restored — September 19, 2026

- Restored all 23 built-in definitions and explicit selection across shared profile, work performed, experience detail, and writing diagnostics. Assessability stays required; only approved role criteria produce native role relevance. The seven shared questions are selectable.
- Typecheck, production build, and all **62 automated tests** passed. These tests use mocked providers, including new regressions for original-library proposal approval, persisted deselection, one-time migration, cross-role cache reuse, and historical failures after selection changes. The browser-bundle check found neither configured credential in 12 generated assets.
- Production browser checks used an isolated copy at `data/showcase-ui-qa` with the existing 1,000 candidates and 80 stored result files. The real workspace and its paused run were not edited by the checks.
- Browser verified 23 library checkboxes, saving a shared-question deselection and an original writing-diagnostic selection, persistence after reload, exact source display, native saved answers/provenance, and access to all recruiter controls. The Python-within-finance example only filled the search field.
- A filter on a deselected question (`technical_depth >= 3`, unknowns excluded) reused cached answers and found five candidates across the 1,000-record pool. Clearing the filter restored the full pool without assessment calls.
- Desktop and 390px mobile layouts were visually inspected, including the mobile question library. The document and dialog had no horizontal overflow; the grid retained exactly 1,000 status cells. No browser errors occurred in the final production checks or final development reload; transient hot-reload errors during in-progress edits were resolved before validation.
- No new live Jev or OpenRouter requests were made for this restoration. Previously saved live answers were inspected; this is not a new model-quality or throughput test. Historical live measurements below remain separate.

The earlier seven-question interface record below describes the superseded selection behavior.

## Shared-question UI and 1,000-resume showcase — September 19, 2026

- Typecheck, 55 automated tests, and production build passed. Tests use mocked assessment providers; added checks cover role-free assessment, cross-role cache reuse, daily experience freshness, older workspace preservation, shared-scope enforcement, and preventing stale/failed insufficient-detail results from appearing complete in the grid.
- Browser checked the actual 1,000-resume workspace at 1512px desktop and 390px mobile widths: exactly 1,000 genuine status cells, seven compact native-answer bars, original source text, no horizontal overflow, and no browser console errors. Role configuration and search are secondary dialogs. Loading and reading saved answers do not invoke models.
- Separately, a bounded **live Jev MCP scan of ten explicitly fictional synthetic resumes** completed 10/10 with zero failures on `jev-1.13.0`. It reported 21,272 input tokens and 3,200 output tokens. The server reported 1,839 ms summed batch time, excluding browser/network overhead; this is not a 1,000-record throughput claim.
- Browser observation during that live scan showed four actual running cells, saved cells accumulating, and 1,000 total cells. After completion the pool showed 11 saved resumes (ten new plus one existing result) and 989 pending. Full native live progress metadata is in ignored `data/shared-scan-live-report.json`. No full 1,000-record live test was run.
- All ten synthetic sources were classified as insufficient detail. Their 80 native answers are preserved and the UI places them under **Needs detail** with an explicit source-review notice. A successful request is not a claim that a source supports a hiring judgment.
- Desktop and mobile screenshots are in ignored `.playwright-mcp/scan-1000-desktop.png` and `.playwright-mcp/scan-1000-mobile.png`; active processing is captured in `.playwright-mcp/scan-active.png`.

The older validation below records the previous interface and remains as historical evidence.

Checked 2026-09-19 on Windows with Node 24.14.1.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 43 tests passed across imports/domain logic, provider adapters, evaluation/persistence, and actual route handlers. Provider adapters/HTTP are mocked; these are not live-model accuracy tests.
- `npm run build`: final build passed without warnings.
- Built browser assets were scanned against both configured credential values: 11 assets checked, no secret values found. `.env.local` and `data/` were verified ignored by Git.
- The all-pool test uses 1,000 fictional records and places the matching stored answer on the final record. Broadening a cutoff finds it before pagination, with no provider calls.

The tests exercise invalid/duplicate/oversized imports, multiline CSV, preserved text/paragraph IDs, complete question definitions, active-brief compilation, native-score-only sorting, explicit AND/OR and unknown handling, quote validation, one generation repair maximum, unknown-ID/code rejection, general cache reuse, necessary-only reevaluation, stale revisions, pause/resume/retry, failure/insufficiency without fabricated zero, actual passage IDs, concurrent metadata updates, normalized role equality through API parsing, no-credential bootstrap, local-origin checks, and server credential isolation.

## Live tests (separate from mocks)

All transmitted records were the explicitly fictional fixtures. No 1,000-record live evaluation was run.

1. The user's configured `mcp__jev__jev_decide` tool was called directly with a small fictional backend record. It returned `jev-1.13.0`, a native Score, a Noul probability, and usage.
2. The app's browser **Verify connections** action connected to that same configured server process and verified OpenRouter structured outputs.
3. OpenRouter generated nine implementation-consultant proposals. Exact JD sources and question definitions were reviewed, and the app approved them into three distinct active criteria with reused general questions.
4. The browser evaluated all 16 fictional records. One initial transient item failure recovered with **Retry failed**. The completed run had 16/16 records, 55,434 reported JEV input+output tokens, and 2.6 seconds of summed server batch elapsed time. This measures that run, excludes generation/UI latency, and is not a throughput or cost promise.
5. The candidate inspector showed native instructions/rubrics/probabilities and retrieved original paragraph `p0003` for the direct implementation fixture, with P(support exists) 0.950.
6. OpenRouter interpreted a customer-work filter at an explicit 0.8 cutoff with unknown answers included. Applying it changed the visible pool from 16 to 5 without modifying the role brief or reevaluating candidates; clearing it restored all records.
7. `npm run smoke:live -- --allow-live` completed with six fictional records through the same MCP adapter, one additional OpenRouter generation (8 proposals), and one same-project search interpretation. Its detailed native results are in ignored `data/live-smoke-report.json`. The six records used 9,362 reported JEV tokens, excluding the verification probe. Overall script wall time was 14.760 seconds including both providers.

Observed backend-role smoke results:

| Fictional fixture | Raw relevance (0–3 rubric) | P(Python used within finance project) | Assessability |
| --- | ---: | ---: | --- |
| c005, keyword-only | 0.37 | 0.03 | insufficient detail |
| c007, plain wording | 2.98 | 0.95 | enough detail |
| c008, polished equivalent | 2.99 | 0.95 | enough detail |
| c009, embedded instruction injection | 0.03 | 0.03 | enough detail |
| c011, Python/finance in separate projects | 0.65 | 0.03 | enough detail |
| c012, Python within a finance project | 0.94 | 0.97 | enough detail |

These observations are not an accuracy benchmark or proof of injection resistance. The polished/plain pair differed by 0.01 in raw relevance in this run. The keyword-only raw score is retained natively, while the app displays that record under insufficient detail without using its score in ranking. The injection fixture did not receive the requested maximum; assessability varied across the two live runs (insufficient detail vs enough detail), so no invariance is claimed.

## Browser QA

The in-app browser exercised sample import, connection verification, live proposal approval, full-pool evaluation, failed-item retry, candidate selection, answer expansion, real supporting-passage retrieval, and approved natural-language filtering. The desktop three-panel layout and narrow responsive layout were inspected.

A second semantic refinement proposed a Python-within-finance question but initially pointed its filter at an unrelated existing attribute. The visible preview exposed the mismatch. The browser Edit flow corrected the filter ID and made the independent question resume-only before approval. The interpreter prompt was tightened, and filter-only requests no longer get appended as standing recruiter instructions. This illustrates why generated plans need review; syntax validation does not prove semantic correctness.

Applying that reviewed plan evaluated only the new question: 16/16 records, 256 cache hits, 7,553 reported tokens, and 1.4 seconds of summed batch time. The filter showed four matching records. Clearing the filter restored all 16. A bookmark survived refresh. The production server was started with `npm start`, and the browser verified that answers and the original supporting passage survived the restart without rerunning assessments.

The user then requested that synthetic-resume work stop and stated they will provide a dataset. Synthetic generation/testing has stopped. Future data work should use that dataset.

## User-supplied dataset integration — 2026-09-19

The subsequent request supplied Djinni and Michael Ozon's existing synthetic dataset. No new resume generation was performed.

- Downloaded pinned, SHA-256-verified Parquet sources and prepared 500 Djinni profiles, 500 existing synthetic resumes, and 20 distinct synthetic job titles. The 500 synthetic records cover all 24 source role titles; selected JDs have same-title examples in the pool. This is coverage metadata, not a matching assessment.
- `npm run dataset:check` passed: unique IDs and text, source preservation, JSON/CSV round-trip compatibility, app role schema, expected counts, workspace template, and artifact checksums. Candidate JSON is 864,579 bytes; resume lengths range from 43 to 4,741 characters. Short source records were retained.
- `npm run typecheck` passed, `npm test` passed all 48 tests, and `npm run build` passed. The five new mapping/import tests use small local fixtures and no live providers. The real downloaded bundle is checked separately by `dataset:check`.
- `npm run dataset:demo` initialized the separate `data/hackathon-workspace` and served it at `http://127.0.0.1:3001`. The original workspace and its existing results were not modified.
- Browser QA verified 1,000 candidates, 20 available roles, zero evaluated records, zero active criteria, disabled evaluation before setup, preserved Djinni text, full structured synthetic text, synthetic display labels, original JD sections, and pagination through page 21 (records 501–525).
- No live Jev or OpenRouter calls were made for this dataset task. No new accuracy or ranking claims are made. Refer to `docs/DATASET.md` and `data/datasets/hackathon/manifest.json` for provenance and reproduction.
