# Version 2.1 desktop qualification

Author: Ethan. Local qualification completed 2026-10-22; release download verification is recorded separately after upload. Earlier version2.0 evidence below remains historical.

On macOS27.2 (26B118) arm64, a separate clean installation passed the production build, strict TypeScript checks, formatting,30 core tests,56 browser tests (47.644s; no failures, skips, retries or flakes),1243 native ASan/UBSan checks and dependency audit with zero vulnerabilities. The later test-only downgrade assertion also passed: newer profile metadata is refused without database changes. Original acceptance assertions remain intact; one locator was narrowed to the same parameters field after a new preview added a second pre element.

The signed native app passed actual hidden AppKit/WKWebView tutorial approval, regular workspace approval, returning history, startup-exit and post-ready crash recovery, token clearing, restart and off-origin/popup denial. Its bundled Node/helper passed real approved-process and protected-file checks. All14 JS/web runtime files and every file-backed helper Mach-O section match the separate clean build. Tutorial and update tests use real pending writes; the upgrade fixture uses an actual2.0.0 CLI database plus explicitly controlled launcher-version metadata because2.0 had no launcher.

The app and DMG both received Apple notarization Accepted, were stapled and validated. The mounted DMG's copied, quarantined app passed strict codesign verification, Gatekeeper assessment, syspolicy_check distribution and the hidden native self-test. No quarantine flag was removed and no Gatekeeper bypass was used. This is automated installation/assessment; no manual first-open dialog or unfamiliar-user study is claimed. The app targets macOS14+, but onlymacOS27.2 is release-qualified here.

Semgrep used the approved11-pack Community plan with metrics off:503 candidates, zero confirmed exploitable findings after contextual review, no failed/skipped/empty/oversized scans. Two external packs remain partial (15 parse errors). Swift received generic lexical scanning, not Swift-specific taint analysis. See docs/semgrep-readiness.md and docs/desktop-security-review.md. Same-user arbitrary process control remains outside this mediated gateway's boundary.

Evidence: evidence/usability/{checks-clean.json,e2e-clean.json,runtime-identity.json,app-runtime-install.json,distribution-local.json,notary-app-status.json,notary-dmg-status.json}. App submission ed7b8806-22a0-4511-852b-75d7cf21f457; DMG submission a0743699-f687-46aa-bf1b-e291e955994e. Final sealed DMG SHA256: dbd5f0cd4ae70510880e53e6401533bd47b6486db0221278375f06fe23f20631.

Personal package/provenance authorship is Ethan; upstream licenses and factual signing/Apple metadata are retained. Finder/Explorer author display is not independently verified. Raw security scans and temporary private test data stay local. GitHub Actions remains disabled; no global config/hooks or telemetry were added. Final release publication and downloaded-asset identity are tracked in HANDOFF.md and evidence/usability/release.json when complete.

---

# Production-readiness qualification

Author: Ethan. Version 2.0.0 qualification, 2026-10-22. Clean acceptance and installed-package checks passed. The public v2.0.0 release tag, downloaded checksum and all runtime bytes are verified in evidence/readiness/release.json.

Target: one local operator using mediated filesystem/HTTP tools and trusted exact command templates. Verified platform: macOS27.2 (26B118) arm64; Node24.22.1 with SQLite3.53.4. Other Node major lines and OS/architectures are unqualified. Native Codex integration does not mediate native tools outside MCP.

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

`npm ci` runs the production/native build. Then `npm run check`, `npm run format:check`, `npm run test:core`, `npm run test:native`, and `npm audit --audit-level=high --json` all exit0. The clean checkout was populated from the exact intended working source, independently installed and built. All28 files under src/web/native/tests match the clean checkout, and all14 runtime files match its build. Package/config/build-script files were also compared before publication. The installed package produces a real approved process side effect and preserves the protected file. Archive metadata is sealed before the last install check; the final external package/release evidence records that check without altering the sealed archive.

Core upgrade setup: verify the historical1.0.1 archive SHA256 `9324f13f9973a8f1d82259a834c34ac404e6682376bc849b314d43a98b04a4ab`, extract it under `.acceptance/legacy/package`, and make its dependencies available. The test fails if the real old executable is absent; it never substitutes a fabricated schema or skips.

The first working-tree browser run passed51/52 including actual Codex AG-19, then failed at browser.newContext for the first onboarding test with “Target page, context or browser has been closed”. The unchanged onboarding test passed twice in a focused repeat. The first failure is retained in e2e-first-run.json. The clean shared-worker run reproduced it. A standalone Chrome control with a data URL and no gateway or native Codex disconnected after31,392ms and remained disconnected at35,516ms. This establishes an external browser-lifecycle failure, not its underlying OS/browser cause. Independent gateway and operator-ui Playwright projects prevent reuse of that ended process; all52 tests then passed in the full clean command with zero retries or skips. The final run after the pagination repair passed52/52 in52.002seconds. See e2e-clean.json and browser-control.json.

## Scope and residual limits

The kernel lease normally recovers after a killed process, but an interrupted marker write can require manual offline recovery. Never remove/truncate a live lock; follow the tested recovery procedure. If storage cannot create an INCOMPLETE marker, a failed maintenance destination can be empty and unmarked; failed destinations must never be reused.

Native testing uses structured seeded mutations, not coverage-guided libFuzzer or LeakSanitizer. Semgrep Community has no cross-file taint analysis; two external rulesets have parse errors. Accessibility is limited to the exercised keyboard, contrast, theme and Axe flows. 200% layout is viewport emulation, not OS/browser chrome zoom. The30-second soak does not establish long-duration memory stability. SQLite has a1GiB main-file cap and a retained-journal target, not a hard transient WAL cap. Same-user hostile code, unmediated tools, arbitrary daemonization and path-based sandbox limitations remain as documented in SECURITY.md.

All26 local explicit-only skills have concrete application records in docs/skill-use.md. No global settings, hooks, account resets or credit bypass were used. GitHub Actions is disabled. Usage is checked every50seconds; work stops at10% remaining in any applicable window.
