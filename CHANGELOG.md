# 2.2.0

- Add Start Codex, scoped session credentials, MCP handshake status, disconnect and revocation. Keep all configuration local to the invocation.
- Add basic workspace policy editing with concurrent-change protection and preserve advanced rules.
- Rehearse draft policies against recent requests or a sample file action without saving, approving or executing.
- Retain cleanup handles when private launch artifacts cannot be removed; allow cleanup to be retried.
- Add standard application/edit menus, keep workspace selection after Stop, and verify visible window-close shutdown.
- Simplify tutorial and workspace controls; retain launch errors across status polls.
- Update Zod to4.6.7 for GHSA-mrhx-c7xc-m3w5 and qualify existing schema/MCP behavior.
- Add explicit local verification journeys and real 2.1 desktop update coverage. See READINESS.md for exact qualification and distribution status.

# 2.1.0

- Add a macOS arm64 launcher with a bundled runtime, workspace selection and separate saved policies/history.
- Add an isolated real approval tutorial and direct native operator-session setup.
- Show exact action parameters and clearer lifecycle states; preserve manual CLI/browser use.
- Use process-lifetime desktop operator tokens and clear sessions when the child stops.
- Add cold backups on version changes, guarded downgrade and tested old-CLI restore.

The arm64 app and DMG are signed, notarized and locally qualified. See READINESS.md for exact platform, tests and limits.

# Changelog

Author: Ethan

## 2.0.0

Requires macOS arm64 and Node >=24.22.1 <25. Large request/audit lists now use cursor pages; external clients must follow `X-AAG-Next-Cursor`. CLI exports follow every page. These runtime and API compatibility changes require a major version.

- Recovers after ordinary abrupt process loss with a kernel-held state lease. Interrupted executions are recorded as failed and never retried automatically.
- Adds cold backup/restore into fresh private directories, bounded health diagnostics and fail-closed storage recovery.
- Bounds active requests, preparation, execution, history responses and main database size. Dashboard summaries and on-demand details reduce history polling cost.
- Fixes native byte-limit/unknown-operation handling and false fingerprint invalidation after unrelated directory creation.
- Adds skippable/replayable setup, credential recovery, keyboard-contained approval dialogs, narrow layouts and accessibility checks.
- Preserves old state, costs and audit records. Old pending fingerprints require explicit resubmission. Rollback uses a pre-upgrade backup; see docs/backup-recovery.md and ADR0001.

Qualification scope and residual limitations are in READINESS.md, SECURITY.md and docs/semgrep-readiness.md. Historical1.0.1 evidence remains unchanged.
