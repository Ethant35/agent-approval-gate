---
name: verify-agent-approval-gate
description: Explicit local verification of Agent Approval Gate native lifecycle, tutorial, workspace policy, managed MCP connection and returning use.
disable-model-invocation: true
---

Author: Ethan. Invoke this file explicitly. It is app-local and does not use the shared `.agents/skills` symlink. Picker discovery is not claimed.

## Launch

Use this repository's macOS arm64 checkout, Node 24.22.1, locked dependencies and an unsigned development app built from the same source. Never rebuild sealed release assets. Read `CONSTRAINTS.md`. Preserve unrelated files. If duplicate source/test files exist, copy tracked files and the intended new files to a private validation checkout; do not include, move or delete the duplicates. Set a task-local PATH to the qualified Node distribution. Use `npm ci --ignore-scripts`, `npm run build`, then `node scripts/build-desktop.mjs --node-root ABSOLUTE_NODE_ROOT --output NEW_OUTPUT_DIRECTORY`.

Each drive below creates its own isolated workspace, state, port and child. No normal Application Support data is used. The window-close drive shows an isolated visible window; menu dispatch remains programmatic. Do not launch a real model or change global Codex settings. First inspect the exact test selection. The existing AG-19 test calls a model; it requires separate authorization.

## Doctor

Before drives, run `node --version` and `npm run check`. Verify `dist/desktop.js`, `dist/cli.js`, `dist/codex-session-launcher.js`, and the supplied app executable exist. Every desktop/core harness waits for its owned child's ready message and uses the returned loopback URL and private credential. A ready line alone is not usable proof: the drives check authenticated policy/workspace identity and expected page content before acting. Native `GatewayProcess.validate` checks loopback, selected workspace and owned data paths, then its hidden self-test checks the loaded dashboard. On an unexpected response, stop that harness, inspect retained evidence, and start with fresh scratch state. Do not reuse a broken UI session merely because its port answers.

## Drive

From the checkout root, with evidence directed to a new private directory:

1. `node --test tests/core/desktop.test.mjs tests/core/desktop-update.test.mjs tests/core/connection.test.mjs` exercises exact writes/denials, returning workspaces, upgrade, scoped credentials, real stdio MCP initialization, revocation and owned process shutdown. The upgrade fixture requires the actual 2.0 archive extracted under `.acceptance/legacy-v2/package` with its dependencies available.
2. `./node_modules/.bin/playwright test tests/ui-desktop.spec.ts tests/ui-readiness.spec.ts --project=desktop-ui --project=operator-ui` exercises the real dashboard, approval dialog, policy editor, responsive layout and accessibility. Connection status UI uses an explicitly labeled external-client contract fixture; the core connection tests separately drive the actual MCP transport.
3. `bash tests/native/verify_desktop_lifecycle.sh ABSOLUTE_APP_EXECUTABLE NEW_ABSOLUTE_EVIDENCE_DIRECTORY` exercises manual Stop/Restart, menu Command-Q routing and window close with live owned gateways. These are programmatic AppKit actions, including a visible window-close drive, not physical-keyboard or unfamiliar-user tests.
4. Broader regression: `npm run test:core`, `npm run test:native`, and `./node_modules/.bin/playwright test tests/gateway.spec.ts --project=gateway --grep-invert 'AG-19'`. Preserve AG-19 unchanged and report it excluded because it calls a provider. Never present the selection as a full model-driven pass.

Map: [features/README.md](features/README.md). The current source and live results both matter. A failed feature stays a product finding; do not weaken its map or assertions.

## Evidence

Save command exit codes, counts, sanitized logs, browser screenshots and native lifecycle logs under `.acceptance/alignment-YYYY-MM-DD/` or another explicitly named new directory. Copy `test-results/` before a later Playwright run replaces it. Record build/runtime/OS and the exact source state. Observe file bytes and unchanged denied targets alongside visible results. Never save bearer tokens, private launch JSON, or raw model transcripts. Synthetic Codex executables prove the wrapper boundary and teardown, not real provider compatibility or full CLI TUI behavior.

## Cleanup

Harnesses terminate only their owned children and remove their private workspaces in `finally` blocks. Native scenario roots must be removed after logs/screenshots are retained. Check no process references the unique test roots and that tested ports reject connections. Remove disposable validation checkouts and launch files only after saving evidence. Keep the evidence directory and verify its files still exist. Never kill all processes by name. Do not leave a usage poller running while waiting for the user.

## Helpers

This entry reuses existing test harnesses and `tests/native/verify_desktop_lifecycle.sh`; it does not duplicate them. The native helper is executable and its exact invocation is above. Re-run the source-and-live feature map when changing these paths. This is explicit local use, not an installed upstream pstack command.
