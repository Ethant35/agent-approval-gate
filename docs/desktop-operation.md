# Desktop operation and recovery

Author: Ethan. Applies to Agent Approval Gate 2.2.0, including its guided Codex connection, policy editor and policy rehearsal. See the [2.2.0 release](https://github.com/Ethant35/agent-approval-gate/releases/tag/v2.2.0) for downloads and READINESS.md for build-specific evidence. Later source changes may refine labels and layout without changing these workflows.

## Start and return

Install the app in Applications from the release DMG. Open it, choose Try Tutorial, inspect the exact path and proposed content, then approve or deny. The tutorial uses a fresh private folder for each run. It does not change your selected project. Choose Choose Workspace to use a dedicated project folder. Do not select your home folder, filesystem root, or app data directory.

The initial policy requires file approval and disables commands and network calls. Edit basic policy changes the default decision, approval expiry, execution timeout and blocked file paths. Explicit rules take priority over the default. The editor preserves advanced fields and rejects stale saves if another client changed the policy. Save invalidates previous approvals. Add exact commands, network destinations, budgets or advanced rules through the existing API/CLI. Each canonical workspace has separate policy and history. Reopen Last Workspace remembers only the path; the new session uses the existing policy, not a reset default.

The app keeps state below `~/Library/Application Support/Agent Approval Gate/workspaces/<workspace-hash>/state`. The private profile next to state records the canonical workspace and last app version. Tutorial state is separate under `tutorials/`. The native window shows the selected workspace; the dashboard uses the same policy and request store as API/CLI/MCP. Human credentials must never be sent to an agent. Advanced integrations use an agent credential and the current loopback URL, as described in README.

## Rehearse a policy

Open Edit basic policy, change the draft, then choose Rehearse policy. Preview a sample file action or up to 20 recent requests. The sample uses `sample-agent` and `sample-session`; choose real requests to check identity-specific rules. Current and draft decisions show the matching rule or scope reason. Rehearsal runs no action, grants no approval and saves no changes. Save policy remains a separate action.

Changing the draft hides its old preview. If another client saves a policy, reload before previewing or saving. Previews cover policy decisions and configured limits; they do not simulate available budgets, file state, DNS or runtime failures. Only actions submitted through the gateway receive these checks.

## Connect Codex

Install Codex CLI separately and sign in using its normal setup. Choose a workspace, then Start Codex. The app opens Terminal with invocation-only MCP settings and a credential scoped to this agent/session. It does not write global Codex configuration or install Codex. Codex CLI 0.164.0 is the qualified client. The managed session uses --no-daemon so its MCP server and processes belong to that session. The app checks standard local executable locations and its inherited PATH. If it cannot find the CLI, check the local installation and retry.

Waiting for Codex means Terminal launch was requested. Connected means the managed MCP transport completed initialization. Complete any CLI sign-in or trust prompt in Terminal. Ask Codex to submit a file action through Approval Gate; review the exact request in the app, confirm approval, then inspect the execution result. The connection indicator alone does not prove a file change.

Disconnecting means credential revocation and process cleanup are in progress. Disconnected appears only after cleanup succeeds. Disconnect Codex revokes the credential, cancels that principal's active requests and stops the owned session. It cannot undo an already completed effect. Start Codex again creates a fresh credential and session; saved workspace history remains. Gateway stop or restart also ends managed credentials. Never copy the operator token into a prompt. Codex's other tools are outside this gateway: this flow does not intercept arbitrary CLI actions.

Stop Gateway retains the selected workspace and enables Restart Gateway. Quit through the standard application menu, Command-Q, or window close stops the owned gateway. If shutdown fails, the app warns that Codex may still be running and offers Keep Open or Quit Anyway. Close that session in Terminal before retrying. CLI terminal windows may remain open after their managed process exits; the app does not close unrelated Terminal windows.

## Update and rollback

Quit the app before replacing it with a newer signed app. On the first open with a newer version, the launcher makes a cold backup of the workspace state under that profile's `backups/` directory before opening it. It then retains the policy and pending history. The backup path is included in the private readiness response. A backup failure stops startup. Backups contain plaintext private state and credentials; protect them.

Opening state recorded by a newer app with an older launcher fails closed. To roll back, keep the original state and restore a pre-update backup to a new private directory, outside all workspaces. Use the previous release's CLI against that restored directory. Do not edit profile version metadata to force a downgrade. Version 2.0 had no app launcher: qualification uses an actual 2.0 CLI database plus a clearly labeled profile-version fixture to test automatic backup selection.

The bundled CLI can perform offline backup and restore without installing Node globally:

```sh
APP="/Applications/Agent Approval Gate.app/Contents/Resources"
"$APP/runtime/bin/node" "$APP/gateway/dist/cli.js" backup --data /absolute/stopped/state --out /absolute/new/backup
"$APP/runtime/bin/node" "$APP/gateway/dist/cli.js" restore --from /absolute/backup --data /absolute/new/state
"$APP/runtime/bin/node" "$APP/gateway/dist/cli.js" serve --data /absolute/new/state
```

The full tested procedures and corrupt/locked/disk-full recovery limits are in [backup and recovery](backup-recovery.md). Restored CLI sessions use the persistent human credential; the native session bearer is never backed up.

## Failure and boundaries

A child crash clears the operator page and offers Restart Gateway. Pending approvals remain; interrupted executions fail and are not retried. If storage is corrupt or incomplete, stop and restore into fresh state. Never delete a live lock inode. Keep the failed original for inspection. An app update does not silently repair or discard user state.

The gateway mediates actions submitted through its interfaces. It does not contain arbitrary software running as your macOS user. Do not put application files, operator credentials, or backup directories inside an untrusted workspace. No system hooks, global Codex settings, cloud account settings, or telemetry are installed.
