# Contributing

Author: Ethan

Use Node.js 24.22.1 in the Node 24 LTS line, macOS arm64, a C compiler, and Google Chrome. Install with `npm ci`, build with `npm run build`, and run `npm run test:e2e`. Native Codex acceptance needs an authenticated CLI and available test model; never replace it with a mock and claim AG-19 passed.

Use meaningful unit/property tests, real SQLite/API integration, native sanitizer/structured fuzz tests, and real E2E. No mock substitutes for final executor acceptance. Run `npm run test:core`, `npm run test:native`, and the full E2E suite. Core upgrade tests require the verified v1.0.1 archive extracted under `.acceptance/legacy/package` with its dependencies available; see READINESS.md. Preserve original acceptance assertions. A build or static check is separate from behavioral acceptance.

Preserve the MIT license. Use Ethan for authored release artifacts; retain truthful compiler/application metadata. Keep changes scoped and reviewable. Do not commit credentials, database files, raw production logs, or browser traces. Document limitations and failed checks honestly.

No GitHub Actions are permitted in this repository. Do not add workflow files, dispatch workflows, or enable repository Actions. Run acceptance locally and update ACCEPTANCE.md with reproducible commands, platform, revision, outcomes, and sanitized evidence. Before a release push/PR/tag, verify repository Actions remain disabled.

Release only after AG-01 through AG-22 and applicable adversarial checks pass, clean installation works, and the native integration returns its real result. Then review the PR, merge, tag, and publish. A failed or externally blocked mandatory gate means NOT DONE.

Playwright runs gateway and operator UI suites as separate projects with one worker and no retries. This gives the UI checks a fresh browser after the gateway suite's long API/process phase. The default command includes every test in both projects. Local branded Chrome was observed exiting normally during a reused worker; the failed runs remain in readiness evidence. Do not remove assertions or add retries to hide a browser or product failure.
