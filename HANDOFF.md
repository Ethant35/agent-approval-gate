# Agent Approval Gate handoff

Author: Ethan

## Current status

Active bounded path-authorization audit on `codex/authorization-invariants`, based on main `471b6966106b232964589dba0fc1c6cd7b866a28`. Ethan invoked be-ambitious and explicitly authorized executing its rewritten prompt. The three questions, primary sources, reproduced failures, repairs, and limits are in docs/path-authorization-audit.md.

The released 1.0.0 implementation failed six of seven new real E2E checks: three equivalent deny spellings allowed protected reads, an equivalent allow spelling blocked a valid read, case-alias state overlap started a gateway, and an approved shell wrote into a replacement directory. Symlink replacement already failed safely. Sanitized baseline is evidence/path-authorization/before.json. The old acceptance report remains historical evidence, not a completeness claim.

Repairs implemented: normalize and persist policy paths, normalize older saved policies with revision invalidation, require native canonical private-state paths, validate overlap before creating tokens, bind subprocess approval to directory-chain identity, and recheck/fchdir in a native launcher before executing Seatbelt. New positive controls require real permitted reads and processes to succeed. Expanded targeted suite passed 12/12; a thirteenth legacy-process upgrade check is being verified. Version staged as 1.0.1; not released yet.

## Remaining gates

Commit reviewed implementation and run clean independent clone acceptance: npm ci, strict checks, production/native build, format, full E2E (45 scenarios including real native Codex MCP and browser approval), dependency audit. Verify installed package through actual CLI and check runtime bytes. Then create/attach a reviewable PR, merge and publish 1.0.1 only after passing gates. Update acceptance, release evidence and this handoff; stop monitor and complete goal only when finished.

## Constraints and runtime

GitHub Actions prohibited: repository API currently disabled. No workflows/runs or dispatches. Do not edit ~/.codex/config.toml. Primary engineer with no workers spawned in this audit; no active children. Goal is active, no numeric budget. Supported usage checker cell 73 checks every 50 seconds and invokes checkout-scoped scripts/stop-active.mjs on exhaustion. Last manual observation 29% used / 71% remaining. No credits, resets or API-key bypass. Stop at exhaustion. Monitor is chat-local.

All files/commits use Ethan as author where supported. No UI change. Tests use temporary synthetic state; raw traces may contain synthetic bearer tokens and must not be published. Durable evidence is sanitized. Preserve original MIT license and v1.0.0 evidence. Disposable clean/install fixtures belong under ignored .acceptance/ and must be cleaned after verification.

## Repository and historical release

Repository: https://github.com/Ethant35/agent-approval-gate
Local path: /Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate
Historical release: https://github.com/Ethant35/agent-approval-gate/releases/tag/v1.0.0
Historical release commit: ea505ab88d36f446590cf87b4472c43e450c85d9
Original PRs #1 and #2 merged and attached. Original 32 E2E and package acceptance passed; this audit adds new adversarial coverage. Do not move or replace v1.0.0.

Supported execution platform remains macOS arm64, locally macOS 27.2 / Node 22.13.1. Same-user credential theft outside mediation, unmediated Codex tools, privileged concurrent filesystem changes, path-based Seatbelt/absolute command arguments, hostile daemonizing commands, partial file writes on crash, operator-editable audit and declared-only spending remain limits. SECURITY.md documents them.
