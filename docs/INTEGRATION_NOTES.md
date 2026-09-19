# Integration notes

Documentation checked **2026-09-19**. The user's later instruction to use their configured Jev MCP takes precedence over the original brief's direct `TypeSafeClient.systemOne` transport requirement. All app judgments therefore call **`jev_decide` over MCP**. The official SDK is installed, its types are verified, and its model-list method is used for access checks only.

## Sources checked

- https://docs.typesafe.ai/introduction
- https://docs.typesafe.ai/llms.txt
- https://docs.typesafe.ai/agent-skill
- https://docs.typesafe.ai/sdk/javascript
- https://docs.typesafe.ai/primitives
- https://docs.typesafe.ai/primitives/score
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/primitives/noul
- https://docs.typesafe.ai/confidence
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/cookbooks/semantic_find
- https://openrouter.ai/docs/quickstart
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://modelcontextprotocol.io/docs/develop/build-client
- https://nextjs.org/docs/app/getting-started/route-handlers

The browser search service could not retrieve TypeSafe's `llms.txt` or OpenRouter's structured-output page reliably. Direct HTTPS reads succeeded for both, including OpenRouter's `.md` version. No inaccessible source was silently treated as read.

The official TypeSafe skill was installed project-locally for Codex using `npx skills add typesafe-ai/skills --skill typesafe-ai --agent codex --yes`, then read in full. It lives at `.agents/skills/typesafe-ai/SKILL.md`. Product requirements override cookbook suggestions about composite/weighted scores; this application has no composite candidate score.

## Verified versions

The lockfile records exact transitive dependencies. Direct installed versions at implementation:

| Package | Version |
| --- | --- |
| next | 16.3.5 |
| react / react-dom | 19.3.0 |
| @modelcontextprotocol/sdk | 1.30.0 |
| @typesafe-ai/sdk | 0.6.0 |
| zod | 4.6.5 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| papaparse | 5.7.0 |
| lucide-react | 0.577.0 |
| typescript | 5.9.3 |
| vitest | 4.1.11 |
| tsx | 4.23.13 |

Configured JEV plugin inspected: **Jev MCP 0.1.0**. It is a Node stdio server, exports one tool named `jev_decide`, obtains credentials from the process environment, and returns the API response as `structuredContent` and a text block. The workspace points to the same configured server script via ignored `.env.local`; no global plugin source or credentials were modified.

Installed SDK declarations were inspected in `node_modules/@typesafe-ai/sdk/dist/index.d.mts`. Verified: `systemOne({ state, questions, model })`, `models.list()` returning `ModelCard[]`, `SystemOneResult` with `model`, `answers`, `usage`, typed Score/Choice/Noul results, and `retry.maxRetries`. SDK logging is disabled; its model-discovery retries are disabled. Question arrays satisfy the SDK's tuple requirements after runtime validation.

## Transport and model decisions

- The server launches the existing JEV MCP script through the official MCP client's `StdioClientTransport`; a single reused client connects, lists tools, and calls only `jev_decide`. MCP process configuration is server-only. The child receives the JEV environment, not the OpenRouter secret.
- `scripts/mcp-metadata.mjs` is loaded before the unmodified MCP server to preserve `Retry-After` / `retry-after-ms` on HTTP errors and remove potentially sensitive provider error bodies. MCP 0.1.0 otherwise drops these headers. It adds no retries or judgments. The application persists cooldown deadlines and blocks early manual retries.
- No assessment retries happen automatically at either the MCP or application layer. Bounded concurrency and explicit failed-item retry avoid nested retry storms. Completed answer bundles are saved before progress acknowledgement. Browser workers independently request one resume through `evaluate:next`, so a slow call no longer blocks the rest of a five-record batch. Atomic claims prevent duplicate work across concurrent requests, and an unowned running record can be reclaimed after a server restart. UI refreshes do not gate worker scheduling.
- Verify connections checks account model metadata and makes one fictional MCP probe. The returned `jev-1.13.0` was observed live. The app pins that actual version for batches/cache identity until explicit reverification. Versioned IDs may not appear in the provider's alias-only model list, so a probe verifies them. Unexpected response versions are rejected.
- OpenRouter uses server-side `fetch` to `/api/v1/chat/completions`. It verifies model availability and advertised structured-output support, sends strict `json_schema`, and requires supporting endpoints using `provider.require_parameters: true`. No alternate model list is provided. `allow_fallbacks: false` avoids unrequested provider failover.
- Zod validates all generated plans/questions. A malformed response gets at most one schema-repair attempt. Source quotations are exact substring checks; mismatches are flagged and cannot be approved. API/generation failures preserve manual editing.
- OpenRouter generation receives JD, recruiter instructions, and question definitions, never the candidate pool. Search interpretation gets current role/questions and the request, never resumes or candidate ranks. Plans use allowlisted data structures, never executable code.

## Evaluation and evidence

- General questions are bundled with `{resume}` state. Role questions and the one `role_relevance` Score are bundled with `{resume, approved_active_role_brief}`. Original JD, disabled criteria, and unapproved alternatives are absent from the relevance request.
- Only JEV's returned role score sorts candidates. Confidence, diagnostics, bookmarks, answer counts, and search filters never modify it. There are no fit percentages, keyword bonuses, probability buckets, or hidden thresholds.
- `assessability` is always evaluated. Insufficient/damaged records remain accessible with their native answers and no fabricated displayed score. A provider failure is also never converted into zero.
- Evidence uses real paragraph IDs in Choice options, an explicit `no_support` category, and a simultaneous Noul existence check, following the semantic-find pattern. IDs are validated and original strings are displayed. More than 254 passages are searched in windows before selecting among each window's returned candidate. Evidence is on demand and reports its native answer without inventing a rationale.
- The app validates native primitive shape, category/rubric bounds, probability keys/sums, and actual model version. Noul has no invented confidence field. Score/Choice show their native distributions and confidence.
- Cached results retain question definitions and model/revision provenance. A schema migration preserves early development cache files when adding question IDs to cache identity; it does not rerank or invent scores.

## Operational limits

One local Node server owns one data directory. Metadata writes serialize in process; completed bundle files use atomic replacement with short bounded retries for transient Windows file locks. There is no multi-process/database locking or durable worker. Browser refresh requires manual resume. Large resumes can be rejected by provider token limits; no silent truncation occurs. Local-origin checks protect write routes; this app is intentionally not an authenticated internet service.
