# 2.2.1 candidate verification

Author: Ethan. October 29, 2026.

**Candidate ready; native acceptance blocked. No release was published.** The frozen contract is in ../../docs/release-2.2.1.md.

Source commit: `27b7e22b984a45d1e220af26281affb38f076a0a`, based on merged PR #10 (`8ce09eb`). Changes from that base are version 2.2.1, matching package assertions, changelog, README wording and the acceptance contract. There are no additional product runtime changes.

The app was assembled from that commit with qualified Node 24.22.1 and locked dependencies. `candidate-manifest.json` records every regular app file hash. The source dist and bundled dist matched. Those hashes still matched after the exact-bundle backend and dashboard checks. `archive-hash.json` ties the independently installed npm archive to the same source commit. Both package manifests name Ethan; the app copyright names Ethan. Finder/Windows author indexing is not verified.

## Passed checks

- Build, strict TypeScript, formatting and native Swift assembly with warnings as errors.
- 38 core tests and 59 offline browser tests. AG-19 was excluded explicitly because it invokes a model.
- 1,243 native filesystem-helper checks, including 1,200 seeded mutations under ASan/UBSan. These exercise the C helper, not native AppKit UI.
- Dependency audit: zero vulnerabilities.
- Installed npm archive: startup, dashboard response, normalized policy denial, allowed read, pending-before-approval, actual approved native process, protected-file preservation and side-effect-free policy rehearsal.
- The same backend checks passed with the exact app's bundled Node and CLI. A private test wrapper invokes Node plus cli.js, matching the app's launch convention. An initial harness attempt incorrectly executed the non-executable bundled JavaScript as an npm bin and failed with EACCES; the corrected wrapper passed without changing the app.
- 15 browser UI checks used the exact app's bundled runtime and dashboard files from a separate harness directory. They cover approvals, long paths, short viewports, focus, policy and connection labels. These are Chromium tests, not WKWebView or native manual evidence.

## Required checks still blocked

Normal native startup explicitly activates the app. The native lifecycle harness orders a visible key window. Start Codex opens Terminal without a background flag. Running these now would conflict with the instruction to avoid interrupting the user. No native window or Terminal was launched and no live-model session was consumed.

The exact candidate still needs native approval layout/long-path/focus checks, actual workspace selection with isolated policy/history continuity, native policy behavior and shutdown. It also needs the authorized integrated native Start Codex → handshake → inspected human approval → exact file result → disconnect check. The one new GPT-6 Luna High authorization is capped at three minutes and remains unused. Earlier native and browser-assisted live evidence remains historical and distinct.

Signing, notarization, draft asset qualification, publication and unauthenticated public download checks follow acceptance. They have not been run for 2.2.1. Actions is disabled. No global configuration or normal application data was changed. The production goal is incomplete.

## Resume and cleanup

The candidate, qualified runtime, source checkout and package remain under `/private/tmp/aag-release-2.2.1-20261029`. Do not infer their continued existence after a reboot; verify hashes before use. Retained evidence lives in this directory and is copied back to the original checkout. Disposable checks stopped their children. No live session or usage guard was started. Old artifacts remain in Trash from the earlier authorized cleanup.

When native interaction can proceed without violating the user constraint, verify this candidate (not an older app), then complete the single authorized live check. Preserve the accepted bytes and record any subsequent signing hashes. If source must change, rebuild and repeat impacted checks. Publish only after the frozen essential contract passes; the existing production goal is not complete.
