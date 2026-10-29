# Independent UX/UI review: Agent Approval Gate 2.2.0

Author: Ethan
Date: October 29, 2026
Scope: manual review of the published macOS arm64 DMG, using isolated data and offline requests. No live agent or model was started.

## Assessment

The offline path is understandable and worked in the cases exercised. The tutorial presents the proposed path and content, confirms a decision, and reports the result. A separate synthetic request appeared in the normal workspace, was approved, and wrote the expected bytes. The policy rehearsal clearly says it does not execute, approve, or save. The strongest UI issue observed is that the approval dialog is partly hidden behind the native launcher and the displayed file path is visually clipped. This affects the screen where a user must check exact parameters.

The persistent boundary text says that only actions sent through the gateway are checked, and the Codex card adds that other Codex tools are outside the boundary. Those statements are prominent and correct in the observed interface. However, “Gateway connected” and “Not connected” appear together for different connections; a first-time user must infer that the former means the dashboard's gateway connection, not an agent. No user comprehension study was performed, and the live connection state was not tested.

## Findings and recommendations

### P2 — Approval dialog is partly hidden and path text clips

**Observed defect.** In the normal workspace, submit a filesystem write via the documented local API, then choose Approve in the action queue. At the captured 2240 × 1584 screenshot size, the native top panel covers the upper edge of the web dialog. The HUMAN DECISION label is cut off and the dialog's close control is not visible. The long path in the dialog's file-path field also appears vertically clipped and wraps awkwardly. The full path remained available in the accessibility tree; Go back and Confirm approval remained usable. The same test did not establish whether every display size or request is affected. See [approval-dialog-clipped.jpg](approval-dialog-clipped.jpg).

**Recommendation.** Constrain the dialog to the visible web content viewport below the native panel, keep its close control visible, and ensure long paths wrap without clipping. Check small windows, long paths, scrolling and keyboard focus before release.

### P2 — Static policy claim can conflict with the current policy

**Observed mismatch.** The launcher always displayed “File actions need your approval.” After adding the sample file to Blocked paths and saving revision 2, rehearsal showed that same file would be denied, while the launcher continued to make the unconditional statement. Advanced rules can also override defaults according to the editor. The statement describes the initial configuration more safely than an ongoing guarantee. See [policy-rehearsal.jpg](policy-rehearsal.jpg).

**Recommendation.** Say “File actions initially require approval” or show the actual current policy summary and explain that rules and blocked paths can change the outcome. Keep the protection-boundary statement visible.

### P3 — Distinguish the two connection indicators

**Design judgment, not a proven failure.** The top of the dashboard said “Gateway connected” while the Codex card said “Not connected.” Both can be true, but the short labels do not explain the difference. The card does explain the protection boundary, which helps.

**Recommendation.** Label them “Dashboard connected to gateway” and “Codex not connected,” with a short explanation that the dashboard connection alone does not mean an agent is connected or protected.

### P3 — Update release-specific documentation language

**Observed documentation mismatch.** The linked [desktop operation guide](https://github.com/Ethant35/agent-approval-gate/blob/main/docs/desktop-operation.md) begins by calling itself the current development checkout and says the guided controls are not in the published 2.1.0 app. The [2.2.0 release](https://github.com/Ethant35/agent-approval-gate/releases/tag/v2.2.0) describes those controls in the released app. A user following the README link can reasonably wonder which documentation applies.

**Recommendation.** Identify the guide's applicable release explicitly and update its introductory version note.

## Hands-on paths and results

- Downloaded the published 2.2.0 arm64 DMG, mounted it read-only, and launched its native executable with `--test-root` pointing to a fresh path under `/private/tmp`. No installation to Applications or dependency installation was performed.
- **Tutorial approval:** Try Tutorial created a fresh workspace and pending write. Review approval opened a confirmation with path, content, request ID, scope and expiry. Confirming led to COMPLETED. The actual fixture contained `You approved this change.` and matched the proposed content.
- **Tutorial rejection:** A second tutorial made a separate workspace. Review rejection and Confirm rejection led to DENIED; the fixture still contained its original `This file has not been approved yet.` text.
- **Workspace selection:** Reopen Last Workspace opened the isolated workspace. Choose Workspace opened the native folder chooser; selecting a second disposable folder created an independent revision 1 policy and empty action queue. No user project was selected.
- **Policy editing and rehearsal:** Opened Edit basic policy. Observed Require approval and Deny default choices, expiry, execution timeout, blocked paths, sample request and operation/path controls, current/draft comparison, save and cancel. Added the isolated sample path as blocked; preview changed its draft from approval to deny without saving. Save produced revision 2; reopening and previewing showed current and draft deny. The editor states advanced rules take precedence and that saving invalidates prior approvals. Did not test stale concurrent edits or advanced-rule preservation.
- **Offline synthetic request:** Using the documented local JSON API and the isolated bootstrap agent credential, submitted `offline-review-write` to write a disposable file. The API returned 201/PENDING_APPROVAL; it was not a real agent integration. The queue displayed it and the confirmation showed its exact proposed content. Approval reached COMPLETED; reading the file confirmed `Offline review approved write.` The audit displayed submission, pending, approval, executing and completion transitions. No credential is included in this report or screenshots.
- **Search and history:** A nonmatching action search produced “No matching actions”; searching the synthetic request restored it. Audit search filtered to that request. A complete audit record and status dropdown were discoverable but not exhaustively exercised.
- **Lifecycle:** Stop Gateway produced “Gateway stopped” and enabled Restart Gateway. Restart returned to the same workspace, retained revision 2 and displayed the completed request and audit entries. The app's standard Command-Q ended the owned process.
- **Appearance:** The dark-mode control changed its accessible label to “Switch to light mode.” A full contrast/accessibility audit was not performed.

## Discoverable feature inventory and coverage limits

The launcher exposes Choose Workspace, Try Tutorial, Reopen Last Workspace, Restart Gateway and Stop Gateway. The dashboard exposes gateway status, light/dark appearance, Codex status and Start Codex, the protection-boundary notice, action queue search/status filter, request detail and approval/rejection controls, active sessions and budgets when applicable, policy summary/editor/rehearsal, audit search/details, and recent actions. Request cancellation and result expansion were visible where applicable; their execution was not tested. The app's native Edit and application menus were visible but their commands were not inventoried in detail. The public documentation also describes CLI/API/MCP integration, scoped credentials, connection revocation, advanced policy, backups, recovery and budgets; these were not exhaustively exercised.

Start Codex was deliberately not invoked. Therefore handshake, actual mediated Codex actions, managed connection error states, Disconnect Codex, credential revocation and owned Terminal/process cleanup were not tested. The offline synthetic request does not establish live integration. Notification behavior, large payloads, concurrent requests, stale policy changes, failure recovery, accessibility beyond the observed labels and visual layout, and all supported macOS versions remain untested. No security or penetration audit was performed.

## Evidence and cleanup

Screenshots are the two JPEGs in this directory. Their EXIF Artist field was set to Ethan and verified by reading it back; Finder's author indexing was not separately verified. The report uses an explicit Author field; Markdown has no standard Finder author field. Screenshots contain disposable paths and action text, with no credentials.

Command-Q exited the launched app (its launch process returned exit 0); a process scan found no command line associated with the isolated test root or mounted app. The owned image was detached successfully (`disk4` ejected). The isolated test directories and downloaded DMG remain under `/private/tmp/aag-independent-ux-20261029-instance` and `/private/tmp/aag-independent-ux-20261029-review`. The test state includes local credentials, so treat it as private. A recursive removal command was rejected by the execution environment; no deletion workaround was used. The report and screenshots remain in the evidence directory. No product files were edited. The production goal was not changed.
