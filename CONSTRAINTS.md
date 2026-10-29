# Production-readiness constraints

Author: Ethan. Established 2026-10-22 from the current production-readiness instruction.

Target: a local operator on macOS arm64, loopback-only server, trusted exact command templates, mediated API/CLI/MCP actions. Qualify actual OS/runtime versions; no hosted service, arbitrary hostile-code containment, Windows/Linux support, or untested provider claims.

## Release gates

- Preserve all existing meaningful acceptance assertions. No skipped/deleted tests, type/security suppressions, weakened thresholds or stubbed production behavior to obtain a pass. Review the full diff against v1.0.1.
- All strict TypeScript checks, native warnings-as-errors, production build, formatting, applicable unit/property/integration/E2E tests and package checks must pass locally. No arbitrary coverage quota.
- Reproduce defects before repairs; independently meaningful invariants and positive controls. Controlled faults are labeled and do not prove live-provider compatibility.
- No unresolved release-blocking authorization, credential disclosure, state/budget corruption, crash-recovery or onboarding defect. Unsupported behavior must have a defensible product boundary, not hide a central defect.
- Native sanitizer/fuzz runs must have zero confirmed memory-safety defects for the recorded seeds, iterations, toolchain and limits. No claim of exhaustive proof.
- Dependency audit: no high/critical vulnerabilities. Semgrep scan requires the exact skill-mandated plan approval; local output, metrics off, Community only unless already available, all failed/skipped rules disclosed.
- Accessibility: no serious/critical axe findings in qualified flows; manual keyboard/focus, contrast, themes, zoom/narrow/long-content checks required. This is an external WCAG-informed gate, not screenshot acceptance alone.
- Performance is measured before optimization. Representative history/load/soak results must record latency, memory, output/storage bounds and responsiveness. Set justified limits from observed product risks; no invented arbitrary coverage or throughput score.
- Actual old-release state must upgrade without silent data loss; interrupted work is never retried automatically. Backups must restore to a useful working result. Disk-full/locked/corrupt storage must fail safely and leave a recovery path.
- Fresh installation/onboarding must reach a real approved useful result; missing prerequisites, credentials, failure, restart and returning-user states must be checked.
- Final archive must be installed/tested; runtime bytes, manifest, author, license, release tag and remote checksum must match evidence.

## Execution and privacy

No GitHub Actions, hooks, global tools/settings, ~/.codex/config.toml edits, source uploads or default telemetry. Exact repository only. Keep Actions disabled before external writes. Ethan is personal author; preserve upstream notices. Credentials/payloads remain out of diagnostics. Account checker every <=60 seconds; stop work, workers and project processes at >=50% used (<=50% remaining) in any applicable account window; no credits/resets/provider bypass.

Commands and results are tracked in READINESS.md. Commands marked planned are not passes. Existing `npm run check`, `npm run build`, `npm run format:check`, `npm run test:e2e`, `npm audit --audit-level=high`, and `node scripts/verify-package.mjs` remain required. New focused checks will be wired to package scripts when implemented. Do not weaken this file to make a change pass.
