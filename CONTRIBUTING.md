# Contributing

Author: Ethan

Use Node.js 22.13+, macOS arm64, a C compiler, and Google Chrome. Install with `npm ci`, build with `npm run build`, and run `npm run test:e2e`. Native Codex acceptance needs an authenticated CLI and available test model; never replace it with a mock and claim AG-19 passed.

Tests are E2E only: actual CLI/server, temporary SQLite/filesystems, subprocesses, HTTP receivers, browser UI, and the native agent. Add a real acceptance scenario when changing a security boundary. Do not add unit mocks that substitute for executor behavior. Treat a build or static check as separate from behavioral acceptance.

Preserve the MIT license. Use Ethan for authored release artifacts; retain truthful compiler/application metadata. Keep changes scoped and reviewable. Do not commit credentials, database files, raw production logs, or browser traces. Document limitations and failed checks honestly.

No GitHub Actions are permitted in this repository. Do not add workflow files, dispatch workflows, or enable repository Actions. Run acceptance locally and update ACCEPTANCE.md with reproducible commands, platform, revision, outcomes, and sanitized evidence. Before a release push/PR/tag, verify repository Actions remain disabled.

Release only after AG-01 through AG-22 and applicable adversarial checks pass, clean installation works, and the native integration returns its real result. Then review the PR, merge, tag, and publish. A failed or externally blocked mandatory gate means NOT DONE.
