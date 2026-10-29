# Workspace and policy

Author: Ethan. Source: `src/desktop.ts`, `src/server.ts`, `web/workspace-controls.tsx`.

## Sub-features

Chosen workspace, distinct saved policy/history, last-workspace recall, basic default/timeout/expiry/blocked-path controls, advanced API/CLI policy.

## How to get to it (user POV)

Choose Workspace. Start Codex is the primary connection action. Open Edit basic policy to make a deliberate policy change. Advanced rules remain visible in View complete policy.

## Driving it with Playwright and core tests

Run the policy UI test and desktop persistence tests. Save a blocked path and expiry. Read the actual policy back; compare advanced rules, commands, network, budgets and allowed roots. Change the policy through another client while the editor is open: Save must be blocked and Reload must show the new value. The API must reject an outdated expectedRevision too. Return to two workspaces and compare distinct policy/history.

## Gotchas

Explicit rules override the default decision. Saving invalidates old approvals. Do not broaden command/network permissions to make onboarding pass. Preserve unknown advanced fields through the schema-supported complete policy object.

## Policy rehearsal

Preview a changed draft against recent requests and a sample file path. Confirm current/draft decisions and rule/scope reasons. Check that pending request state and approval tokens remain unchanged, the saved revision and budgets are unchanged, and the target has no new bytes. Core checks include allowed process, subagent and HTTP samples with no process marker or server hit. Changing the draft or saved revision must hide stale results. Human credential is required; preview never grants an approval.
