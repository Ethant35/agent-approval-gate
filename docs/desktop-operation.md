# Desktop operation and recovery

Author: Ethan. Version 2.1. See READINESS.md for the tested host and installation evidence.

## Start and return

Install the app in Applications from the release DMG. Open it, choose Try Tutorial, inspect the exact path and proposed content, then approve or deny. The tutorial uses a fresh private folder for each run. It does not change your selected project. Choose Choose Workspace to use a dedicated project folder. Do not select your home folder, filesystem root, or app data directory.

The initial policy requires file approval and disables commands and network calls. Review and edit policy in the dashboard before adding exact commands or network destinations. Each canonical workspace has separate policy and history. Reopen Last Workspace remembers only the path; the new session uses the existing policy, not a reset default.

The app keeps state below `~/Library/Application Support/Agent Approval Gate/workspaces/<workspace-hash>/state`. The private profile next to state records the canonical workspace and last app version. Tutorial state is separate under `tutorials/`. The native window shows the selected workspace; the dashboard uses the same policy and request store as API/CLI/MCP. Human credentials must never be sent to an agent. Advanced integrations use an agent credential and the current loopback URL, as described in README.

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
