# Independent recheck and native isolation repair — October 29, 2026

Author: Ethan. Fresh Terra review confirmed the original UI repairs within its coverage and found an isolated test-root escape through Choose Workspace. Central native startup now preserves that root. Actual folder-picker selection retained policy revision 2 and a pending request, with no normal profile created. Fixed singular audit count and API guide heading too. Final build/type/format, 15 browser UI tests and both native lifecycle scenarios pass. Broader offline results and exact limits: evidence/ux-fixes-2026-10-29/recheck-repair/VERIFICATION.md. Source PR only; published binaries unchanged.

---

# Four UX fixes qualified locally — October 29, 2026

Author: Ethan. Dialog position/path wrapping/focus, policy wording, dashboard/Codex labels and the 2.2.0 guide are fixed. Clean build/type/format checks, 15 UI tests, a final geometry assertion rerun and both final native lifecycle scenarios pass. Actual WKWebView verified scrolled long-path confirmation, an exact approved write, saved blocked-path rehearsal and labels. Evidence: evidence/ux-fixes-2026-10-29/VERIFICATION.md. Local, uncommitted changes only; no replacement release. Usage guards are disabled by the latest instruction.

---

# Version 2.2.0 published; final verification paused — October 28, 2026

Author: Ethan. Saved `evidence/rehearsal/release.json` reports publication at 2026-10-29T00:21:17Z; the saved tag record resolves to `f13bcbddbbd22f66976c0b8aa0bd2365d3869f44`. Authenticated draft-download bytes and quarantine-preserving native installation checks passed. The final unauthenticated public-download check remains unfinished. The production goal is paused at Ethan's request, not complete. No further tests or release operations were run during handoff. HANDOFF.md contains the exact continuation steps and exhausted live-session allowance. Earlier pending-publication statements below are historical.

---

# Version 2.2.0 local distribution qualified — October 28, 2026

Author: Ethan. The final layout candidate is signed, notarized and stapled. App submission `33622455-bddf-4fc2-bfe6-abfa32e0a0dc` and DMG submission `3af25eb7-fbbd-478c-bd24-e39d63e51791` were Accepted. The final DMG was mounted read-only; its copied app retained an explicit test quarantine and passed strict signature, Gatekeeper, staple, syspolicy and both native lifecycle checks. Installed npm archive checks passed, including no-effect rehearsal. Native helper file-backed sections and all JS/web runtime files match the independent clean build.

PR #9 contains the source and evidence. Release upload, downloaded-byte verification and publication are next. Earlier candidates and statuses below are historical. The final form-layout revision passed 14 UI scenarios and an actual native policy rehearsal; backend/MCP code is unchanged from the 18.253-second live pass. The fresh one-session authorization is exhausted.

---

# Final layout qualification — October 28, 2026

Author: Ethan. The native WKWebView policy rehearsal was driven with CUA after foreground activation and scrolling: blocked sample path, current approval versus draft denial, unchanged saved revision/requests/file, then successful Command-Q. The simplified fieldset layout passes all 14 UI scenarios plus strict/format checks. The prior 38-core, 58-browser, native-helper and live connection evidence remains applicable to unchanged behavior; the live pass predates this form-layout-only revision. Final package/signature/download checks will qualify the exact sealed bytes.

Earlier background AX captures were incomplete; an off-screen value-setting attempt stalled accessibility inspection. Normal typing in the foreground completed the flow. No precise root cause or exhaustive native accessibility claim is made. Evidence: `evidence/rehearsal/native-policy-ui.json`.

---

# Version 2.2.0 final candidate — October 28, 2026

Author: Ethan. The clean source passes build, strict checks, formatting, 38 core tests, 58 offline browser tests, 1,243 native helper checks (1,200 structured mutations), and dependency audit with zero vulnerabilities. The app assembles with Swift warnings treated as errors and passes both native lifecycle scenarios. All 11 approved Semgrep packs ran; two third-party packs have partial parse failures. There are 652 candidates, including 594 lexical matches and 58 previously reviewed audit flags; no new confirmed exploit. No cross-file taint or Swift semantic-analysis claim.

Policy rehearsal compares a draft with the saved policy for recent requests or a sample file action without execution, approval, saved-policy changes, request insertion or budget reservation. Tests check all four action categories and unchanged file/network/process state. A reproduced private-launch-file removal failure now preserves the retryable cleanup handle.

A newly authorized GPT-6 Luna High session through the signed app's bundled runtime passed in 18.253 seconds: actual Terminal/CLI, MCP handshake, unchanged file before human approval, exact 22-byte write, completed result, disconnect and private launch-artifact removal. The temporary adapter pins the model and isolates existing ChatGPT authentication. Browser bootstrap supplies the desktop context; native WKWebView and lifecycle have separate checks. This is not one integrated native chooser-to-Terminal UI test. All three authorized sessions are consumed.

Apple accepted app submission `07975fa1-d79b-4d9c-bfa9-db7a1fc08c6d`. Final distribution and public-download gates remain in progress. Qualified host remains macOS 27.2 (26B123), arm64, Node 24.22.1 and Codex CLI 0.164.0. Evidence: `evidence/rehearsal`; earlier sections are historical.

---

# October 28 continuation — qualification in progress

Author: Ethan. Existing connection regression passed 4/4, including partial-start cleanup-handle retention and disconnect status. The October 27 signed app now has a validated staple, Gatekeeper acceptance and both signed native lifecycle scenarios passing. These checks qualify that saved candidate, not later changed bytes.

Policy rehearsal is implemented after those checks. Its first two core tests and seven desktop UI tests pass, including no-execution invariants and unchanged saved policy/request/budget/audit state. Final clean regression, fresh signed packaging and public-download gates remain open. Both previously approved live sessions are consumed. No new model call has been made. Evidence: `.acceptance/alignment-2026-10-28`.

---

# Version 2.2.0 verification — October 27, 2026

Author: Ethan. Local source gates pass; release signing, notarization and public-download verification remain in progress. Historical releases below do not qualify changed bytes.

Qualified host: macOS 27.2 (26B123), arm64; Node24.22.1; Codex CLI0.164.0. Deployment target14.0 is not older-host qualification.

- Clean locked install/build, strict TypeScript and formatting passed. All35 core tests and57 offline browser tests passed. Core tests run serially because the actual1.0.1 helper includes parent-directory link counts that concurrent fixture creation changes; no assertions were removed.
- Native helper:1243 boundary checks including1200 deterministic structured mutations; no confirmed sanitizer defect. Fresh app lifecycle tests pass manual Stop/Restart, programmatic Command-Q and visible last-window close. Native CUA keyboard Quit also stopped the owned gateway and closed its port. An isolated exit1 fault verified warning, Keep Open and Quit Anyway.
- Real upgrade evidence uses actual1.0.1,2.0.0 and2.1.0 archives. The2.1 desktop profile retains policy and pending history and completes a useful approved write. Backup/restore, incompatible newer profiles, locked/corrupt/full storage and interrupted execution remain covered.
- Zod4.6.7 resolves GHSA-mrhx-c7xc-m3w5. Fresh audit reports zero vulnerabilities. All11 approved Community Semgrep scans ran,625 candidates contextually reviewed, no confirmed exploit; Elttam and Apiiro contain unsupported/parse-failing rules. Raw output stays local. No cross-file or Swift semantic-analysis claim.
- Live authorization is exhausted: two Luna High sessions through existing ChatGPT login, synthetic isolated workspaces. AG-19 passed in11.7s including returned result. The real Terminal-launched guided session completed handshake, human approval and exact22-byte write. Its early cleanup assertion failed because status became disconnected before cleanup finished; shutdown then completed and no test process remained. The final source adds Disconnecting until cleanup succeeds; four offline connection tests and UI checks verify that repair. No third live session was run. Guided evidence uses the production dashboard/backend in a browser with a desktop bootstrap and a temporary launcher adapter to fix the authorized model/auth context; WKWebView/native lifecycle are tested separately. Terminal UI inspection was unavailable through computer-use controls. Do not call this a single live test of every final packaged-app step.
- The30-second load check completed2276 polls at p95=4.3ms and rejected42 of50 burst submissions without unapproved writes. It is not a multiday soak.

Evidence is under evidence/connection. Same-user arbitrary process control, other Codex tools, and hostile-code containment remain outside the mediated gateway boundary. No Actions or global configuration changes. Ethan remains personal package/provenance author; Apple/upstream metadata is retained. Finder/Explorer author display is not independently verified.

---

# October 25 follow-up — paused and unfinished

Author: Ethan. The usage reset-to-100% stop fired during the approved implementation. Current changes are uncommitted and unreleased; the historical qualification below does not qualify them. See HANDOFF.md for exact current checks, unfinished backend/native review, the unexecuted app-local verification entry, remaining production gates and the unused two-session live Codex authorization. No new readiness or release claim is made.

---

# Version 2.1 desktop qualification

Author: Ethan. Local and downloaded-release qualification is complete. Version 2.1.0 is published; final evidence is in evidence/usability/release.json. Earlier version 2.0 evidence below remains historical.

On macOS 27.2 (26B118) arm64, a separate clean installation passed the production build, strict TypeScript checks, formatting, 30 core tests, 56 browser tests (47.644s; no failures, skips, retries or flakes), 1,243 native ASan/UBSan checks and dependency audit with zero vulnerabilities. The later test-only downgrade assertion also passed: newer profile metadata is refused without database changes. Original acceptance assertions remain intact; one locator was narrowed to the same parameters field after a new preview added a second pre element.

The signed native app passed actual hidden AppKit/WKWebView tutorial approval, regular workspace approval, returning history, startup-exit and post-ready crash recovery, token clearing, restart and off-origin/popup denial. Its bundled Node/helper passed real approved-process and protected-file checks. All 14 JS/web runtime files and every file-backed helper Mach-O section match the separate clean build. Tutorial and update tests use real pending writes; the upgrade fixture uses an actual 2.0.0 CLI database plus explicitly controlled launcher-version metadata because 2.0 had no launcher.

The app and DMG both received Apple notarization Accepted, were stapled and validated. The mounted DMG's copied, quarantined app passed strict codesign verification, Gatekeeper assessment, syspolicy_check distribution and the hidden native self-test. No quarantine flag was removed and no Gatekeeper bypass was used. This is automated installation/assessment; no manual first-open dialog or unfamiliar-user study is claimed. The app targets macOS 14+, but only macOS 27.2 is release-qualified here.

Semgrep used the approved 11-pack Community plan with metrics off:503 candidates, zero confirmed exploitable findings after contextual review, no failed/skipped/empty/oversized scans. Two external packs remain partial (15 parse errors). Swift received generic lexical scanning, not Swift-specific taint analysis. See docs/semgrep-readiness.md and docs/desktop-security-review.md. Same-user arbitrary process control remains outside this mediated gateway's boundary.

Evidence: evidence/usability/{checks-clean.json,e2e-clean.json,runtime-identity.json,app-runtime-install.json,distribution-local.json,notary-app-status.json,notary-dmg-status.json}. App submission ed7b8806-22a0-4511-852b-75d7cf21f457; DMG submission a0743699-f687-46aa-bf1b-e291e955994e. Final sealed DMG SHA256: dbd5f0cd4ae70510880e53e6401533bd47b6486db0221278375f06fe23f20631.

Personal package/provenance authorship is Ethan; upstream licenses and factual signing/Apple metadata are retained. Finder/Explorer author display is not independently verified. Raw security scans and temporary private test data stay local. GitHub Actions remains disabled; no global config/hooks or telemetry were added. The published release and downloaded-asset identity are recorded in HANDOFF.md and evidence/usability/release.json.

---

# Production-readiness qualification

Author: Ethan. Version 2.0.0 qualification, 2026-10-22. Clean acceptance and installed-package checks passed. The public v2.0.0 release tag, downloaded checksum and all runtime bytes are verified in evidence/readiness/release.json.

Target: one local operator using mediated filesystem/HTTP tools and trusted exact command templates. Verified platform: macOS 27.2 (26B118) arm64; Node 24.22.1 with SQLite3.53.4. Other Node major lines and OS/architectures are unqualified. Native Codex integration does not mediate native tools outside MCP.

| Gate | Current evidence | Result |
| --- | --- | --- |
| Fresh frozen install / production build | Separate `.acceptance/clean-readiness` checkout, `npm ci` including prepare/build | Pass; no inherited node_modules or dist |
| Strict TypeScript | clean-checks.json / check-clean.log | Pass |
| Formatting | format-clean.log | Pass |
| Core/property/integration | core-clean.log |26/26, zero fail/skip |
| Authorization / replay / OS sandbox | Original45 browser scenarios retained unchanged | 52/52 full clean suite pass, including live Codex AG-19 |
| Native memory and bounds | native-clean.log |1243 checks, including1200 structured mutations, seed0xA6610; ASan+UBSan pass |
| Dependency audit | audit-clean.log |Zero vulnerabilities |
| Static analysis | semgrep-summary.json, docs/semgrep-readiness.md |332 candidates triaged; no confirmed exploit; two partial packs disclosed |
| Independent differential review | docs/readiness-review.md |No confirmed auth/budget/path bypass; manual empty-marker recovery is documented and tested |
| Crash recovery / live ownership | recovery.test.mjs, six tests in core suite |Pass; SIGKILL, lost helper, live exclusion, stale/live/malformed/empty legacy markers |
| Storage faults | storage.test.mjs |Pass; real SQLite full/locked/corrupt conditions, atomic rollback and restart recovery |
| Upgrade and rollback | actual verified1.0.1 archive fixture in upgrade.test.mjs |Pass; history/pending/cost preservation, stale fingerprint refusal, explicit resubmission, pre-upgrade backup restored into old release |
| Backup / restore | maintenance and maintenance-cli tests |Pass; real CLI cold backup→restore→restart→approved write; tampering/linked/malformed/missing credentials and incomplete state refused |
| Pagination / admission / diagnostics | API/history/client tests |Pass; principal isolation, summary omission, complete135-row export, escaped result, all 100 active summaries despite large metadata, valid UTC timestamps, 100-active rejection before persistence, private health |
| Performance | history-before/after.json and soak.json |Measured bounded improvement; four-poller30-second soak only |
| Onboarding / accessibility | seven additional browser scenarios |7/7 within clean52-test run; Axe/keyboard/narrow/theme pass |
| Packaged fresh install / runtime bytes | scripts/verify-package.mjs |Pass; real installed CLI, protected read denial, useful approved native process, dashboard |
| Metadata / license / release integrity | Ethan personal author, MIT and upstream notices retained |Package author/license and 14 runtime files verified; remote tag/checksum verified in release.json |

## Exact clean checks

`npm ci` runs the production/native build. Then `npm run check`, `npm run format:check`, `npm run test:core`, `npm run test:native`, and `npm audit --audit-level=high --json` all exit0. The clean checkout was populated from the exact intended working source, independently installed and built. All28 files under src/web/native/tests match the clean checkout, and all 14 runtime files match its build. Package/config/build-script files were also compared before publication. The installed package produces a real approved process side effect and preserves the protected file. Archive metadata is sealed before the last install check; the final external package/release evidence records that check without altering the sealed archive.

Core upgrade setup: verify the historical1.0.1 archive SHA256 `9324f13f9973a8f1d82259a834c34ac404e6682376bc849b314d43a98b04a4ab`, extract it under `.acceptance/legacy/package`, and make its dependencies available. The test fails if the real old executable is absent; it never substitutes a fabricated schema or skips.

The first working-tree browser run passed51/52 including actual Codex AG-19, then failed at browser.newContext for the first onboarding test with “Target page, context or browser has been closed”. The unchanged onboarding test passed twice in a focused repeat. The first failure is retained in e2e-first-run.json. The clean shared-worker run reproduced it. A standalone Chrome control with a data URL and no gateway or native Codex disconnected after31,392ms and remained disconnected at35,516ms. This establishes an external browser-lifecycle failure, not its underlying OS/browser cause. Independent gateway and operator-ui Playwright projects prevent reuse of that ended process; all52 tests then passed in the full clean command with zero retries or skips. The final run after the pagination repair passed52/52 in52.002seconds. See e2e-clean.json and browser-control.json.

## Scope and residual limits

The kernel lease normally recovers after a killed process, but an interrupted marker write can require manual offline recovery. Never remove/truncate a live lock; follow the tested recovery procedure. If storage cannot create an INCOMPLETE marker, a failed maintenance destination can be empty and unmarked; failed destinations must never be reused.

Native testing uses structured seeded mutations, not coverage-guided libFuzzer or LeakSanitizer. Semgrep Community has no cross-file taint analysis; two external rulesets have parse errors. Accessibility is limited to the exercised keyboard, contrast, theme and Axe flows. 200% layout is viewport emulation, not OS/browser chrome zoom. The30-second soak does not establish long-duration memory stability. SQLite has a1GiB main-file cap and a retained-journal target, not a hard transient WAL cap. Same-user hostile code, unmediated tools, arbitrary daemonization and path-based sandbox limitations remain as documented in SECURITY.md.

All26 local explicit-only skills have concrete application records in docs/skill-use.md. No global settings, hooks, account resets or credit bypass were used. GitHub Actions is disabled. Usage is checked every50seconds; work stops at10% remaining in any applicable window.
