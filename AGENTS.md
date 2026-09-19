# CheckAble

Build a local Next.js/TypeScript recruiter workspace. Use the user's configured Jev MCP (`jev_decide`) for all assessments. Use OpenRouter only for question generation and constrained search plans. Keep credentials on the server. No mock fallback in the application.

Rank only by the native `role_relevance.score`, descending, with candidate ID ties. Never weight other answers, confidence, writing diagnostics, demographics, names, or school prestige. Only approved enabled criteria and approved alternatives enter the active brief. Keep general resume-only answers reusable across roles. Preserve unknown, failed, pending, insufficient, and stale records.

Keep original resume text, validate imports and passages, require recruiter approval before applying generated changes, and treat resume text as untrusted data. Persist completed work atomically. Browser-driven batches are resumable, not durable background jobs. No live calls on page load or automatic 1,000-record live tests.

Use the project-local TypeSafe skill. Read current docs and installed types. Run typecheck, tests, build, and a browser check before delivery. Record live results separately from mocked tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
