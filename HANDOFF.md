# Desktop 2.1 local qualification complete; release pending

Author: Ethan. Current objective is the authorized downloadable macOS launcher. All local release gates pass. The source changes have not yet been committed/pushed. Do not call the release complete before the draft assets have been downloaded and checked.

Branch codex/desktop-usability starts at77965b6bef4a6da23ab8da4b46876b802be4a8d1. Candidate2.1.0 bundles Node24.22.1/native helper, native workspace chooser, separate per-workspace policy/history, last-workspace recall, real isolated tutorial, fresh per-child operator bearer, and startup/crash/reconnect handling. Source security review has no unresolved in-scope defect; arbitrary same-user process access is explicitly out of scope. All seven requested usability skills plus approved Semgrep were applied.

Clean checks: build/check/format,30core,56E2E,1243native,0dependency vulnerabilities. Later controlled newer-version refusal assertion passes with state unchanged. Actual signed native self-test and signed bundled-process acceptance pass;14JS/web files and all file-backed helper Mach-O sections match the clean build. App/DMG Accepted notary IDs and quarantined local mounted-install checks are in evidence/usability. DMG SHA256 dbd5f0cd4ae70510880e53e6401533bd47b6486db0221278375f06fe23f20631. Package archive installation also passes. No unfamiliar-user or manual first-open-dialog testing is claimed.

Sealed release staging: /private/tmp/aag-release-2.1.0-20261022. Preserve app, DMG and SHA256SUMS.txt until release is verified. Repo archive agent-approval-gate-2.1.0.tgz and its checksum are ready. Temporary signed/installed tests are under /private/tmp/aag-*; clean test source is .acceptance/usability-clean. Keep historical runtime/legacy fixtures/duplicates and prior released artifacts. Raw Semgrep is local ignored;503 candidates reviewed,2partialpacks,15parseerrors, cloned repos removed.

Both Luna High assistants finished and were interrupted. No nested agents. Usage checker cell47 runs every50sec; latest76%used. At90%used, stop work/ownworkers/processes, save precise handoff, pausegoal, stopchecker, endturn. No automatic resume, account credits/resets or provider bypass. No global config/hooks. Actions verifieddisabled. Next: source PR/attach/merge, draftrelease, upload/downloadsealedassets, remotechecksum/tag/installedappchecks, publish, final evidence-only bookkeeping and cleanup. No2.1remote writes yet.

---

# Completed qualification and release — 2026-10-22

Author: Ethan.

Agent Approval Gate 2.0.0 is published for macOS arm64 with Node 24.22.1–24.x. PR #5 merged implementation commit `78b872f43b6fc07b80efcef76fc900f040a9822d`; annotated tag `v2.0.0` points to merge commit `34965028b8727230fabb522f8eada968e4b58fa6`. Release: https://github.com/Ethant35/agent-approval-gate/releases/tag/v2.0.0.

The independent clean install passed production/native build, strict checks, formatting, all 26 core/property/integration tests, all 52 E2E tests including live native Codex, 1,243 ASan/UBSan checks, and dependency audit with zero vulnerabilities. Final E2E duration: 52.002 seconds; no failures, skips, retries or flaky results. Every original acceptance assertion is unchanged. Fresh installed-archive tests passed a useful human-approved native process and protected-file checks. All 14 runtime files match the clean build and installed package.

Downloaded release archive and checksum match SHA-256 `8dc896056611b8034d99d876ec5603df4cc74f200ee5d64e8ea17c1714d0fea2`; remote annotated tag resolves to the verified merge commit. Publication evidence is in evidence/readiness/release.json. This final handoff/evidence update changes no runtime and does not move the tag or rebuild the sealed archive.

All 26 explicit skill applications are recorded. Final Semgrep run used the approved 11-pack plan: 332 candidates, no confirmed exploit, two partial external rule packs. Raw scans remain local and ignored. Disposable rule clones were removed. Final pagination repair keeps all 100 active summaries visible and timestamps schema-valid while retaining complete original detail.

Residual limits remain explicit: empty interrupted lock markers need the tested offline recovery procedure; the soak lasted 30 seconds; Community rules provide no cross-file analysis; native structured mutations are not libFuzzer/LeakSanitizer; browser test projects isolate a separately reproduced external Chrome lifetime issue. See READINESS.md, SECURITY.md and supporting reports.

Cleanup removed generated test checkout, package installations, downloaded release copy and browser result directories after saving sanitized evidence. No gateway, test browser, native helper or provider test process remains. Local Node 24 runtime and old-release fixture remain for reproducible checks. Preserved duplicate files remain in `.acceptance/preserved-duplicates-2026-10-22`; no user files were discarded. Both workers finished and were interrupted.

GitHub Actions remains disabled with zero runs. Latest supported usage: 33% used, 67% remaining. No credits, resets, provider bypass, global settings or hooks were changed. Ethan is the package/evidence/implementation author and tagger. GitHub's generated merge identity is Ethant35; factual provenance is preserved. Finder/Explorer author display was not independently verified. The session usage checker is stopped after final bookkeeping; no future automation or production server is left running.

The earlier paused/resumed snapshots below are historical. They do not change this completed release status.

---



# RESUMED by Ethan — 2026-10-22

Author: Ethan. Ethan explicitly revoked the pause and resumed the existing objective. The prior paused snapshot below remains the starting evidence, not a current stop instruction. New guard: check supported account usage every 50 seconds and stop project work at >=90% used (<=10% remaining) in any applicable window; unknown readings are unknown. Save unfinished work, stop own workers/processes, then pause under Ethan's conditional instruction. No credits, reset or provider bypass; no auto-resume.

Initial reading: 4% used / 96% remaining. Usage checker cell2. Goal tool still reports paused; it has no resume operation, so do not replace the goal or claim a status change. Work is authorized by Ethan's direct resume instruction.

Unexpected untracked older duplicate files with ` 2` names were preserved by moving them into `.acceptance/preserved-duplicates-2026-10-22/` with original relative paths. Their original source locations affected TypeScript inclusion; no contents were discarded. Parent owns backend/CLI/packaging/Semgrep/docs; two Luna High workers own read-only differential review and maintenance verification respectively. No nested agents or Actions.

---

# PAUSED by Ethan — production-readiness handoff

Author: Ethan. Saved 2026-10-22 after Ethan's explicit stop instruction. This section supersedes every completion, active-task, or continue instruction below. Do not resume without a new instruction from Ethan.

## Objective and exact checkout

Qualify Agent Approval Gate for real local users on an explicitly supported macOS arm64 platform: correctness, security, recovery, native memory safety, accessibility, bounded performance, upgrade, onboarding and verified packaging. Production readiness has NOT been achieved.

- Local path: `/Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate`
- Origin: `https://github.com/Ethant35/agent-approval-gate.git`
- Branch: `codex/production-readiness`
- HEAD: `77e4359592416190c10764d8b6b92ab84fd59c7d`
- All readiness changes are uncommitted. No new readiness PR, push, merge, tag or release was made. Package version remains 1.0.1. README describes an intended version 2; version selection and packaging are unfinished.
- Existing active goal was explicitly paused through `update_goal`. Actual returned status: `paused`. It was not completed or replaced.

## Shutdown

The active review worker `/root/readiness_ui` was interrupted. `/root/readiness_native` completed its maintenance/native pass and was interrupted. Earlier dashboard/interfaces workers remain completed. `collaboration.list_agents` showed no running child agents after shutdown.

Process inventories after the stop found no project gateway, native helper, test, Playwright, Semgrep, history workload or native Codex provider process. Only the inventory command itself matched. No unrelated process was killed. Already-running command sessions 43283 (build + two API tests) and 53540 (soak) had finished with exit 0 before collection; reading those completed outputs did not start new checks. No tests/builds/scans were started after the stop.

Session-local usage checker cell126 was terminated after process shutdown. Last supported account usage read before the stop: 68% used / 32% remaining. No credits, resets, external-provider bypass or global Codex config changes were used. No automatic resume is authorized.

## Work saved

- Native helper rejects unknown operations, strictly validates limits, bounds reads/writes before exposing/truncating data, checks allocations, and uses a pipe-owned flock lease that survives stale PID markers safely. Native directory fingerprints now exclude changing directory link counts while preserving inode/device identity and regular-file hardlink rejection. This fixes a reproduced failure caused by unrelated sibling directory creation.
- Server uses the native lease; crash/restart and helper-loss controls exist. Startup checks private regular state files and rejects incomplete maintenance output. Supported runtime checks require macOS arm64 and Node >=24.22.1 <25.
- SQL list pagination, projected summaries, active-request query, indexed state/principal lookups and lazy UI details replace unbounded history polling. CLI lists/audit exports stream all pages; CLI and MCP response cap is 16 MiB to accommodate JSON-escaped bounded execution output.
- Admission limits are 100 active requests, 8 preparations and 8 executions. Storage primary error codes trigger fail-closed recovery mode and bounded diagnostics; human-only health reports status/counts. SQLite main-file cap is 1 GiB with normal WAL checkpoint behavior. The WAL retained-journal target is not a hard transient bound.
- Cold backup/restore module uses a held source lease, exclusive fresh destinations, INCOMPLETE markers, streamed database checksum/copy, token checks, quick_check and fsync. CLI backup/restore wiring has been added, but its command-level flow has not yet received final acceptance. Module tests did pass.
- UI includes skip/replay setup, clearer token recovery, native dialog keyboard/focus handling, narrow layouts, theme persistence, summary/active merge, older pages and on-demand full details. Seven new UI tests include axe scans.
- Four deterministic fast-check tests cover budget ledger sequences/rollback and path normalization/deny equivalence. Native ASan/UBSan and structured mutations cover boundary cases.
- CONSTRAINTS.md, READINESS.md, docs/skill-use.md and an ADR were started. README, API and contributor docs were updated. These records are incomplete; READINESS.md and skill-use.md still contain stale pending labels and must be reconciled on resume. Do not treat skill reads alone as completed application.

## Last actual verification and failures

All results below concern dirty working-tree states, not a clean final release.

- Parent last completed command: Node24 production/native build and `node --test tests/core/api-readiness.test.mjs`: 2/2 pass, exit0. It covers principal boundaries, summary/health fields and active-cap recovery through cancellation.
- Parent `node --test tests/core/storage.test.mjs tests/core/recovery.test.mjs`: 6/6 pass on Node24, including SIGKILL recovery with actual approved write, live lease exclusion/helper loss, token symlink, SQLITE_FULL rollback, corrupt-file preservation and SQLITE_BUSY recovery mode.
- Parent actual v1.0.1 archive upgrade test: 1/1 pass. Old completed work, pending work and reserved spending survive crash/upgrade; duplicate IDs remain rejected; settlement works; old fingerprints may require explicit resubmission.
- Parent earlier client/history/recovery tests: 3/3 pass. Complete paged CLI output and a 400,000-NUL-byte read result pass.
- Worker final report: all 17 then-current core tests passed on Node24 after maintenance streaming/durability repairs. This is worker-reported and predates the final two API tests. Parent has not run the final combined core suite.
- UI worker: 7/7 browser tests passed against summary routes, with axe light/dark/modal checks; strict check, focused format and Vite build passed at that state. Final all-52-ish E2E suite has not been run; original 45 acceptance tests and live Codex AG-19 remain unqualified for this branch.
- Native worker: ASan+UBSan 1,243 checks including 1,200 structured mutations, seed0xA6610, passed. No coverage-guided libFuzzer or LeakSanitizer claim; local toolchain lacks those capabilities.
- Known earlier failures were real: SIGKILL restart blocked by old wx lock; summary route returned all rows; CLI returned only first100 of135 after pagination; maintenance restore approval failed due directory nlink fingerprint. Focused fixes passed. An intermediate combined suite was13/14 with maintenance failing; that failure was later reproduced/fixed, not hidden by moving fixtures.
- History benchmark (Node22 same workload,2500 rows/4096-byte content): before11,786,391 response bytes/p50 42.29ms/p95 65.73ms/RSS438,896KiB; after53,001 bytes/p50 1.24ms/p95 15.45ms/RSS86,592KiB. Evidence JSON saved.
- Completed30-second Node24 soak: four pollers,2,284 polls; p50 1.87ms/p95 3.34ms/p99 6.19ms; maxresponse51,201bytes; RSS84,560->122,976KiB. Burst50 accepted8/rejected42 with no unapproved effect. Query plan used requests_state index. This short workload is not evidence of a multiday soak.
- Semgrep user explicitly approved run-all with exact11 packs/repos. Initial runner completed11 scans,235 merged findings; elttam and apiiro were partial due invalid third-party rule syntax. No Pro; p/yaml404 excluded from approved plan. Native findings triaged by worker. Parent found scoped JS/TS coverage omitted src files, likely shell expansion of include globs at repo-root cwd. A same-plan rerun from an empty cwd is REQUIRED before claiming source coverage. No rerun occurred before stop.
- No final whole-project format/check/audit/signatures/security review/clean package-install/runtime-byte comparison has been completed for this branch. No production-readiness or release pass is claimed.

## Remaining gates and known incomplete areas

1. Complete review of maintenance streaming/durability edits, native changes, UI diff and backend lifecycle. The read-only differential reviewer was interrupted before saving `docs/readiness-review.md`; no report currently exists. Check all changed files and preserve every original meaningful assertion.
2. Rerun the approved Semgrep plan through its supplied runner from an empty working directory using absolute paths. Verify src/*.ts coverage explicitly; report partial rules, all finding dispositions and limitations. Merge SARIF and remove only its disposable cloned rule repos when complete. Raw scan files and clones remain local and ignored now.
3. Reconcile all26 explicitly requested local skills against actual outputs. Still finish detailed differential/find-bugs/floor audit, simplification decision and launch/verification records; do not claim every phase completed because SKILL.md was read.
4. Check CLI backup/restore end to end, INCOMPLETE startup, current health/storage-diagnostic privacy, permission edge cases and final combined core tests. Maintenance worker owns no pending active work now. Review duplicate shutdown listener behavior and any reviewer findings before broad acceptance.
5. Finalize runtime/package version and migration/rollback/retention/troubleshooting docs. Current package is1.0.1 despite README version2 wording; proposed major bump was not executed. Package verification script still asserts1.0.1 and writes old evidence location; adapt without overwriting historical evidence. Final exact-version support claims need actual clean evidence.
6. Run strict checks, full formatting, meaningful core/property/native tests, all original+new E2E including actual native Codex, current npm audit, fresh frozen install and installed archive acceptance. Dist may be from the last successful concurrent build; rebuild only after resume and edits settle. Do not weaken or skip failed gates.
7. Do final author/license/metadata checks and full diff review. Only after real qualification, verify Actions remain disabled before any remote mutation, create/attach PR, and publish matching tested archive/checksum if still authorized. No Actions permitted.

External constraints: Semgrep Pro unavailable; third-party partial rule syntax; p/yaml unavailable; libFuzzer/LSan unavailable on this toolchain. No unresolved approval blocker: scan approval was received. No external blocker justifies calling this complete. Stop instruction, not exhaustion, is why work is paused.

## Preserved local artifacts and precise resume setup

Only resume on Ethan's explicit instruction. First read this handoff, inspect git diff/status and current supported account usage, and re-establish a <=60-second usage guard that stops at100%. Do not change ~/.codex/config.toml, hooks or global runtime. Team work requires the user's applicable authorization; no nested agents and at most two Luna High workers under the current project instruction.

The verified official Node runtime is local at `.acceptance/runtime/node-v24.22.1-darwin-arm64/bin/node` (SQLite3.53.4). For commands use a task-local PATH prefix: `PATH="$PWD/.acceptance/runtime/node-v24.22.1-darwin-arm64/bin:$PATH"`. Do not overwrite global Node. The actual verified1.0.1 archive remains `agent-approval-gate-1.0.1.tgz`, SHA2569324f13f9973a8f1d82259a834c34ac404e6682376bc849b314d43a98b04a4ab. It is extracted at `.acceptance/legacy/package`, with node_modules symlinked to this repo for the upgrade fixture. `tests/core/upgrade.test.mjs` intentionally requires that archive preparation; it does not silently skip.

Run focused review/repairs first, then `npm run build`, `npm run check`, `npm run test:core`, `npm run test:native`, `npm run format:check`, full `npm run test:e2e`, and package checks with the local Node PATH. These are resume instructions, not commands run after pause. New evidence is under `evidence/readiness/{history-before,history-after,soak}.json`. Native/UI/property details are in their respective docs. Semgrep output is `static_analysis_semgrep_1/`; `.git/info/exclude` was locally extended for that directory. Shared `.agents/skills` remains an ignored symlink; no new skills were installed in this pass.

## Exact dirty and untracked inventory at pause

```text
 M CONTRIBUTING.md
 M HANDOFF.md
 M README.md
 M docs/API.md
 M native/safe-fs.c
 M package-lock.json
 M package.json
 M playwright.config.ts
 M src/cli.ts
 M src/mcp.ts
 M src/server.ts
 M src/store.ts
 M web/main.tsx
 M web/style.css
?? AGENTS.md
?? CONSTRAINTS.md
?? READINESS.md
?? docs/backup-recovery.md
?? docs/decisions/
?? docs/native-readiness.md
?? docs/property-readiness.md
?? docs/skill-use.md
?? docs/ui-readiness.md
?? evidence/readiness/
?? scripts/measure-history.mjs
?? scripts/soak-history.mjs
?? scripts/verify-native.sh
?? src/lease.ts
?? src/maintenance.ts
?? src/runtime.ts
?? tests/core/
?? tests/native/
?? tests/ui-readiness.spec.ts
```

Untracked nested files include `docs/decisions/0001-production-target.md`; `tests/core/{fixture,api-readiness,client,history,maintenance,properties,recovery,storage,upgrade}.test.mjs` (fixture is `fixture.mjs`); `tests/native/verify_native.py`; and the three evidence JSON files above. No unfinished work was deleted or cleaned away.

---

## Historical handoff (superseded; retain for provenance)

# Agent Approval Gate handoff

Author: Ethan

## Current status

Completed the bounded be-ambitious path-authorization audit and published **v1.0.1**. All 45 real E2E scenarios passed in a clean independent checkout, including 13 new path/upgrade scenarios and actual native Codex MCP/browser approval. No failures, skips or retries; 36.65 seconds. npm ci, strict checks, production/native build, formatting and dependency audit passed; zero vulnerabilities. Installed-package CLI startup, allowed/denied reads, human approval and a real native process side effect passed.

Repository: https://github.com/Ethant35/agent-approval-gate
Local path: /Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate
Release: https://github.com/Ethant35/agent-approval-gate/releases/tag/v1.0.1
Merged implementation PR: https://github.com/Ethant35/agent-approval-gate/pull/3
Tested implementation: 023ff465d2548376c7e7cd27fa38f06d6d005233
Release commit: 8c202c8b3fabac6ccf75b1b739193f397300d400
This final handoff and remote-release evidence are metadata-only follow-up work; they do not move the release tag or alter the tested runtime.

## Findings and repair

The released 1.0.0 implementation failed six of seven new E2E checks: three equivalent deny spellings allowed protected reads, an equivalent allow spelling blocked a valid read, case-aliased state overlap started a gateway, and an approved shell wrote into a replacement directory. Symlink replacement already failed safely. Historical 1.0.0 acceptance remains evidence of its own tests, not a completeness claim.

Repairs normalize and persist policy paths, normalize older saved policies with revision invalidation, require native canonical private-state paths, validate overlap before token creation, bind process approval to directory-chain identity, and recheck/fchdir in a native launcher before executing Seatbelt. Positive controls require real permitted reads and processes to succeed. No new product features or API schema changes.

Upgrading may require resubmission after saved policy normalization. All 1.0.0 process approvals lack workspace identity and must be resubmitted. Unchanged filesystem approvals retain normal restart behavior. Primary-source research, the four-question method, executed rewrite, reproducible failures, and exact limits are in docs/path-authorization-audit.md. Full acceptance is in ACCEPTANCE.md and evidence/path-authorization/.

## Release verification and cleanup

Release is public, not draft or prerelease. Its annotated tag resolves locally/remotely to the release commit above. Downloaded archive and checksum were verified. SHA-256: 9324f13f9973a8f1d82259a834c34ac404e6682376bc849b314d43a98b04a4ab. All 11 packaged runtime files match both clean-tested and installed-tested builds; CLI bin is executable. No known failing checks or remaining release gates. The previous v1.0.0 tag and evidence remain unchanged.

Disposable .acceptance/ clones/installations/downloads and test-results/ were removed after saving sanitized evidence. All test gateway/native-agent processes are stopped. No production server remains running. The local ignored 1.0.1 archive remains available as well as the remote release assets.

Supported usage checker cell 73 was stopped during final cleanup. Last supported account reading: 34% used, 66% remaining. No credits, resets, or API-key bypass were used. No workers were spawned for this audit; both earlier completed workers were interrupted. The goal is marked complete after the final handoff is committed and checked.

## Constraints and limits

GitHub Actions remains disabled, with zero workflows/runs. Do not add or dispatch Actions. Do not edit ~/.codex/config.toml. All personal author fields checked in manifests, Git, documents and evidence use Ethan. Native transcripts retain truthful source records; Finder/Explorer display of author metadata was not independently verified. Original MIT license preserved.

Supported execution platform remains macOS arm64, locally macOS 27.2 / Node 22.13.1. Same-user credential theft outside mediation, unmediated Codex tools, privileged concurrent filesystem changes, path-based Seatbelt and absolute command arguments, hostile daemonizing commands, partial file writes on crash, operator-editable audit and declared-only spending remain limits. SECURITY.md documents them.

No implementation work remains. Before any future follow-up, inspect current main, this handoff, authoritative account usage and Actions permissions. Do not repeat native model tests just to read existing evidence.

## Active production-readiness task (2026-10-22, supersedes prior completion)
The production-readiness goal is active on codex/production-readiness. No release is qualified yet. Read CONSTRAINTS.md, READINESS.md and docs/skill-use.md. Usage checker is cell126 (50sec); parent also checks supported usage at least each minute; latest63%used/37%remaining. Stop at100%, no credits/reset/provider bypass. No global config changes or Actions.

User approved the exact11-rulepack Semgrep run-all plan. Initial run completed11 scans,235 merged findings, two partial third-party rule compilations. Discovered runner shell-glob expansion omitted src files from scoped rules when started at repo root; rerun same approved plan from empty cwd before claiming coverage. Raw local outputs static_analysis_semgrep_1 (gitignored). No Pro, p/yaml unavailable404.

Implemented and focused-tested: native unknown operation and byte limits, pipe-owned flock stale-lock recovery, bounded SQL summary/history pages and CLI complete exports, 100 active/8 preparation/8 execution admission limits, real SQLite capacity/corrupt/lock failure controls, runtime Node24.22.1 floor, private state-file checks, native directory nlink fingerprint fix, onboarding/modal/responsive/UI lazy detail and7 axe/browser tests. PBT4 generated invariants pass. Benchmark history-before/after retained under evidence/readiness. C ASan+UBSan 1243 checks+1200 structured mutations passed; not coverage-guided libFuzzer.

Workers: readiness_ui completed UI then property tests, interrupted. readiness_native completed native then owns maintenance backup/restore plus native directory fingerprint repair; stop it after final. Parent owns server/store/CLI/runtime/integration/docs. No nested agents. All changes uncommitted; original acceptance must be rerun. New maintenance CLI wiring, actual v1.0.1 upgrade test, final source/security review, current Semgrep rerun, longish local soak, docs and fresh package qualification remain. No production-ready claim until gates pass. Node runtime at .acceptance/runtime/node-v24.22.1-darwin-arm64/bin; use per-command PATH, never global settings.
