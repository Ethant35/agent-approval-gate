# Local release acceptance

Author: Ethan

**PASS: all applicable local v1 release gates.** Verified 2026-10-22.

Repository: https://github.com/Ethant35/agent-approval-gate
Review: https://github.com/Ethant35/agent-approval-gate/pull/1
Release target: `v1.0.0`
Tested implementation commit: `44c27e765662d736cea89dfab5c14d4ffaa50871`. Later release commits add only acceptance evidence, documentation, and inclusion of that evidence in the package; the implementation/test diff is checked before release.

## Environment and commands

macOS 27.2 (26B118), arm64; Node.js 22.13.1; native Codex CLI 0.163.0; GPT-6 Luna with High reasoning; Google Chrome through Playwright; real macOS Seatbelt. V1 support is macOS arm64. No Linux/Windows pass is claimed.

An independent `git clone --no-local --branch codex/initial-release` of the implementation commit began without node_modules or generated dist files. The complete sequence passed:

```sh
npm ci
npm run check
npm run build
npm run format:check
npm run test:e2e
npm audit --audit-level=high
```

Results: **32 passed, 0 failed, 0 skipped, no retries, 31.6 seconds**. Strict server and React TypeScript checks passed. Native C compiled with warnings treated as errors. Production build and formatting passed. Full npm dependency audit reported **0 vulnerabilities**. All executors are real; no unit tests or mock executors substitute for acceptance.

The generated npm tarball was installed into an empty prefix with `npm install`. Its actual `.bin/aag` command started the server, served the dashboard, accepted an agent request, required human approval, read the real temporary file, and returned the correct content. Package version and author were verified as 1.0.0 and Ethan.

GitHub Actions are **intentionally omitted and disabled per Ethan**. The repository permissions API returned `enabled: false`; workflow count and run count were zero. The original CI gate is replaced by the equivalent applicable local checks above. No GitHub Actions/CI pass is claimed.

## Required E2E matrix

| ID | Real scenario | Result | Duration |
| --- | --- | --- | --- |
| AG-01 | installation and real CLI startup | PASS | 0.52s |
| AG-02 | dashboard policies, history, keyboard and theme | PASS | 0.87s |
| AG-03 | automatic allowed read and CLI submission | PASS | 0.57s |
| AG-04 | forbidden write does not execute | PASS | 0.37s |
| AG-05 | pending approval blocks execution | PASS | 0.38s |
| AG-06 | real browser approval executes exactly once | PASS | 0.99s |
| AG-07 | browser rejection | PASS | 0.69s |
| AG-08 | expired approval rejected | PASS | 0.75s |
| AG-09 | approval token replay rejected | PASS | 0.49s |
| AG-10 | immutable parameters and exact file identity | PASS | 0.50s |
| AG-11 | traversal, symlink and parent replacement | PASS | 0.50s |
| AG-12 | blocked command has no side effect | PASS | 0.37s |
| AG-13 | unauthorized network and alternate IP never arrive | PASS | 0.50s |
| AG-14 | budgets retain unknown costs and settle recorded actuals | PASS | 0.39s |
| AG-15 | concurrent approvals cannot oversubscribe | PASS | 0.40s |
| AG-16 | restart preserves policy pending requests audit budgets | PASS | 0.87s |
| AG-17 | authentication CSRF origins and self approval | PASS | 0.39s |
| AG-18 | dashboard disconnect keeps pending blocked | PASS | 0.65s |
| AG-19 | native Codex MCP proposal approval execution result | PASS | 11.59s |
| AG-20 | CLI audit export matches actual transitions | PASS | 0.47s |
| AG-21 | real executor failure records FAILED | PASS | 0.49s |
| AG-22 | cancellation kills subprocess and child | PASS | 0.49s |

## Additional adversarial scenarios

- PASS: security: sandbox denies outside write, network and secret read.
- PASS: security: invalid policy fails closed and policy revision revokes approval.
- PASS: subagent real adapter and concurrency enforcement.
- PASS: security: scoped credentials enforce agent/session identity and ownership.
- PASS: security: redirect never reaches a second destination.
- PASS: security: OS sandbox blocks actual HTTP connection.
- PASS: security: timeout terminates running command.
- PASS: security: hardlink and case-alias denied paths.
- PASS: security: canonical routing cannot bypass API authentication.
- PASS: filesystem create and text result format.

AG-19 ran the actual native Codex CLI through stdio MCP. Codex submitted the exact action; it remained PENDING_APPROVAL; Playwright used the actual human-authenticated dashboard to approve it; the gateway wrote the real file; Codex received COMPLETED and bytesWritten and exited successfully. The host MCP `approve` setting permits gateway calls only; the adapter contains no human approval tool. No API key was supplied. Native built-in Codex tools remain outside this integration's enforcement claim.

The sandbox network scenario includes a positive control: a compiled socket probe reaches the real local receiver outside the gateway, then the same binary is denied by Seatbelt with no extra receiver hit. This avoids accepting an unrelated startup failure as proof of network enforcement.

## Evidence

- [Machine-readable full matrix](evidence/e2e-results.json)
- [Sanitized native Codex tool transcript](evidence/native-codex.jsonl)
- [Installed-package smoke result](evidence/package-install.json)
- [Actual dashboard screenshot](evidence/dashboard.png)

Raw Playwright traces are not published. The screenshot contains only synthetic fixture data and has embedded Author=Ethan metadata. The package manifest, Git commit author fields, and document author lines use Ethan. Compiler/application provenance is retained.

## Gates and boundaries

All four supported action categories are policy-checked before gateway execution. Filesystem traversal, symlink/hardlink escape, case aliases, file/parent replacement, command policy, unauthorized HTTP, private IP aliases, redirects, sandbox network/file access, replay, changed parameters, origin/CSRF attacks, and agent identity/session spoofing passed their bundled E2E scenarios. Subagent concurrency, atomic budget reservations, unknown-cost retention, authoritative test settlement, cancellation, timeout, persistence, shared CLI/dashboard state, and native integration passed.

These tests support the documented mediated boundaries, not universal security against arbitrary software. Remaining limits include same-user credential theft outside the gateway, unmediated native tools, cooperative process-group cancellation (hostile daemonizing runners are unsupported), privileged concurrent filesystem mutation, non-crash-atomic file writes, operator-editable audit storage, and declared rather than independently metered spending. See SECURITY.md.

## Failures repaired before final acceptance

The first process profile lacked a required root-directory read, preventing process startup. A narrow permission fixed it; successful process, exit-code, child-cancellation, and sandbox denial checks then passed. The vulnerable static-file plugin was removed in favor of fixed asset routes, followed by a zero-vulnerability audit. Native Codex initially required host MCP permission and then exposed ambiguous wait semantics; invocation-scoped configuration and terminal-state waiting fixed both. Curl failed before connecting in an early sandbox test; a real socket probe with a positive control replaced it. None of those failed or partial runs is counted as release acceptance.

A final native-helper review added a length check before appending the missing-file marker. The complete 32-scenario suite was rerun on commit `44c27e7` and passed; the earlier 43ff0b7 run is superseded. Finder/Windows Explorer display of PNG author metadata was not verified; the saved PNG Author field and package/Git author values were checked directly.
