# Agent Approval Gate handoff
Author: Ethan

Status: ACTIVE, implementation started; NOT RELEASED. Goal remains active.
Repository: https://github.com/Ethant35/agent-approval-gate
Local: /Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate
Branch: codex/initial-release
Base: see `git log -1`; no implementation commit yet.

Verified: GitHub CLI authenticated as Ethant35; origin exact; original MIT license preserved. Repository Actions disabled via repository permissions API, verified enabled=false. No workflow files exist. Parent Git repository is not this project.
Usage at startup: 1% used (99% remaining). Stop all project work on exhausted applicable account window; never buy/reset credits to continue.

Architecture: Node 22 strict TypeScript, Fastify, React, node:sqlite, YAML; separate human/agent tokens; immutable requests; atomic budget reservation; native descriptor-based filesystem helper; sandboxed shell/subagent; pinned DNS HTTP executor; stdio MCP agent adapter.

Tests: none run yet. AG-01 through AG-22 all pending. Native Codex integration and platform isolation must be tested; release forbidden until all applicable local gates pass. GitHub Actions intentionally omitted per Ethan.

Next: implement core, dashboard, CLI/MCP; build; real-process Playwright E2E; native Codex acceptance; security review; clean installation; record evidence in ACCEPTANCE.md; PR; merge/tag/release only upon acceptance.
Running processes: none. Do not edit ~/.codex/config.toml. Use at most two bounded Luna High assistants, no nested agents.
Resume: `cd '/Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate'`, `git status`, `npm ci`, `npm run build`, `npm run test:e2e` (once implemented).

## Implementation milestone (2026-10-22)
Core implementation added: strict action/policy schemas; persistent SQLite lifecycle and transactional budgets; descriptor-based native filesystem helper; macOS Seatbelt process executor; pinned-address HTTP; authenticated Fastify API; React dashboard; CLI and MCP. Both bounded Luna assistants completed and were interrupted. Lead implemented core and E2E suite. `npm run build` passes. First local E2E run is in progress; AG-01 through AG-07 passed so far. `npm audit` exposed high severity @fastify/static vulnerabilities; dependency removed in favor of an exact build-file route allowlist. Need rerun build/audit/E2E after this change. Release still forbidden.
Usage-stop checker is running as a supported tool loop at 50-second intervals; last reported 6% used, 94% remaining. It is attached to this chat runtime, not persistent after chat execution ends. No credentials read by checker.
