# Production Readiness Differential Review

Author: Ethan
Date: 2026-10-22
Baseline: `v1.0.1` (`8c202c8b3fabac6ccf75b1b739193f397300d400`)
Reviewed state: working tree on `codex/production-readiness`, based at `77e4359592416190c10764d8b6b92ab84fd59c7d`

## Result

| Severity | Open findings |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 1 documented residual recovery limitation |
| Low | 0 |

**Recommendation: CONDITIONAL.** I found no confirmed authorization bypass, credential disclosure, budget-ledger corruption, or bypass of the filesystem identity checks in the reviewed changes. The empty-marker lease case remains a manual offline recovery limitation. The recovery procedure is documented and covered by a focused test; the helper intentionally does not reclaim an ambiguous marker automatically. Full release qualification remains open pending the final clean suite and package acceptance.

## Finding

### MEDIUM: An empty lease marker still requires manual offline recovery

**Location:** `native/safe-fs.c:75-90`
**Affected operations:** gateway startup and cold backup/restore, which all acquire the same state-directory lease
**Blast radius:** one data directory; startup and maintenance stay unavailable until an operator renames the empty lock file offline
**Authorization impact:** none observed; this is a service recovery failure

The helper creates `server.lock` with `O_CREAT|O_EXCL` at line 75. It writes the owner marker only after checking the file and acquiring `flock`, at lines 87-89. If the helper is killed or exits after creating the file but before the marker is written, the next helper can acquire the now-free OS lock, then rejects the zero-length file at lines 83-85. Gateway startup and maintenance remain unavailable until an operator confirms all owners are stopped and preserves the empty inode by renaming it offline. This fail-closed behavior avoids treating an ambiguous marker as stale while a legacy PID-only owner could still be starting.

**Reproduction and disposition evidence:** `tests/core/recovery.test.mjs` creates the empty marker after stopping the gateway, confirms two starts fail without changing or unlinking its inode, verifies no gateway or lock helper remains, renames the marker to a unique `.failed-*` name, and then restarts successfully. The test approves a pending request and verifies the useful write completes. `docs/backup-recovery.md` documents process inspection, the offline rename, and post-restart request inspection. This is a tested manual recovery procedure; the implementation does not auto-recover the empty marker.

**Existing safeguards:** the helper rejects symlinks, non-regular files, foreign ownership, and hard links; it takes an exclusive nonblocking `flock`; completed new-format markers are tied to that lock; and tests cover restart after killing an already-running gateway. Those controls protect normal contention and recovery after the marker has been written. They do not recover an empty marker left before that point.

**Residual limit:** the operator must stop launchers, inspect processes, and rename the empty marker before retrying startup. Automatic reclamation remains unsafe while an old v1.0.1 PID-only process could own the directory without a native `flock`. The current test validates offline recovery with an empty marker, but does not inject a kill at the native helper's exact create-to-marker instruction boundary.

## Resolved in the latest change: summary timestamp contract

The summary projection previously truncated `action.timestamp` to 64 characters and dropped the UTC `Z` for schema-valid long fractional seconds. The current projection at `src/store.ts:157-158` preserves the first 63 characters and appends `Z` only when truncation is needed. It leaves ordinary timestamps unchanged. `tests/core/history.test.mjs` now parses every summary action through `actionSchema`, while asserting that the stored 20,000-digit timestamp remains unchanged. The parent reports a red run reproduced the invalid datetime before this change and that the build plus both focused history tests pass after it.

The summary endpoint caps requested rows at 100. Its projection removes parameters, results, approval tokens, and fingerprints; bounds `resourceScope` to 4096 characters, permissions to 16 strings of at most 80 characters, and the reason to 500 characters; and now bounds timestamp to 64 characters. The boundary test checks 100 rows, parses every projected action through `actionSchema`, and keeps the serialized summary below 4 MB with metadata at the exercised bounds. These schema maxima also keep the response below 4 MB when JSON control characters expand during serialization; the summary intentionally may exceed the 1.25 MB budget used to paginate full records. Full pages retain that budget, and the test confirms the stored timestamp and private fingerprint remain available in full records.

## Coverage

This was a read-only differential review of the current tracked changes against the v1.0.1 tag. I inspected the baseline history/blame and changes affecting native filesystem operations and leases, maintenance backup/restore, server lifecycle and routes, SQLite storage and pagination, CLI and MCP response handling, dashboard data loading and approval flows, and the changed or added tests for those paths. I also checked focused callers and the route-to-store call paths for principal filtering, approval-token handling, request limits, failure handling, and complete paginated exports.

Tests were inspected but not run as part of this review. The parent reports a 22-test full core run passed before three added recovery tests, and the new recovery coverage includes the empty-marker offline procedure. The parent also reports 1,243 native checks passed and 51 of 52 E2E scenarios passed, including AG-19; the remaining UI run stopped when `browser.newContext` closed at the first new UI test, while two focused repeats passed unchanged. The final clean suite remains pending. These are parent-reported results, not independent verification in this review.

I made a focused source review of the dashboard's summary/detail merge, older-page cursors, deferred parameter/result loading, approval re-fetch, native dialog focus handling, and credential connect/disconnect paths. I found no new concrete dashboard regression. The approval dialog obtains a fresh full request and checks it is still pending before opening; the server independently rechecks the state, token, and policy on approval. Paging merges by stable request ID or audit sequence, and the dashboard never uses summary payloads for approval. The summary timestamp issue is resolved as described above. Browser accessibility and full-flow acceptance still depend on the outstanding E2E and manual accessibility gates.

## Retained security assertions

- Human-only routes still call `requireHuman`; scoped agent reads remain filtered by principal, and request detail hides approval tokens from agents.
- Approval still requires the pending state, a timing-safe token comparison, the current policy revision, and a fresh policy evaluation before execution.
- The native helper still uses descriptor-relative traversal, rejects symlinks and hard-linked/non-regular targets, verifies fingerprints before reads/writes, and bounds input/output before exposing data.
- The server stays bound to loopback and retains host, origin, cross-site, authorization, explicit-intent, and security-header checks.
- Storage failures enter fail-closed recovery mode; startup marks interrupted actions failed instead of retrying them. The reviewed changes do not remove transaction rollback around request/audit creation or budget reservation.
- Backup/restore uses an exclusive source lease, a fresh destination, private regular-file checks, streamed checksums, an incomplete marker, and SQLite integrity checks. Focused tests cover interrupted state, tampering, live-lease exclusion, and useful restored execution.

## Limits and confidence

Confidence is **medium-high for the reviewed lifecycle and authorization paths** and **medium overall**. The repository is medium-sized, so the review prioritized high-risk code and its direct callers instead of re-reading unchanged low-risk files. No provider compatibility was tested. No Semgrep result was assessed here; the parent review owns that work. The report does not establish accessibility, performance, sanitizer, dependency, upgrade, or package-release gates beyond the evidence already recorded in `HANDOFF.md`.

## Final qualification update from parent

After the independent review finished, the parent verified the final clean source: 26/26 core tests, 52/52 E2E tests including live Codex, zero retries/skips, and real installed-package acceptance. The timestamp regression passed. Native source is unchanged from the 1,243-check ASan/UBSan run. The manual empty-marker recovery limitation remains as reviewed. This update records parent evidence; it does not turn the read-only review into an independent test run.
