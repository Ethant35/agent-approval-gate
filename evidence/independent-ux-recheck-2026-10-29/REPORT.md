# Independent UX review: Agent Approval Gate

Author: Ethan  
Reviewed: 2026-10-29  
Build: local `native-final/Agent Approval Gate.app`, bundle version 2.2.0. This is a local build review, not a release-signing or public-download qualification.

## Finding

**High — the test-root boundary is lost when choosing a workspace.** This finding concerns the isolated test launch, not an ordinary production launch.

1. Launch `AgentApprovalGate --test-root /private/tmp/aag-terra-recheck-20261029-uxreview` with that path initially absent.
2. Choose Reopen Last Workspace. The dashboard uses the generated workspace `/private/tmp/aag-terra-recheck-20261029-uxreview/workspace`; its gateway process uses `--root /private/tmp/aag-terra-recheck-20261029-uxreview/appdata`.
3. Save an isolated policy edit and submit requests. The dashboard showed revision 2 and recorded request history.
4. Choose Workspace, navigate to that same workspace, and select Use Workspace.
5. The new dashboard showed revision 1 and an empty action history. Process inspection showed the child gateway now using `--root /Users/ethantarnarider/Library/Application Support/Agent Approval Gate` for the same workspace. The separate state profile was created at `/Users/ethantarnarider/Library/Application Support/Agent Approval Gate/workspaces/9eed314e63393dfaac9172ce3766d70b1f56ba8dee5af8efbb2e380dd48d920a`.

Impact: a test operator can unexpectedly create real application-support state and see a different policy and history for the same folder. This undermines the promised isolation of this review and makes the apparent state change misleading. I did not test whether other selection sequences have the same behavior. The created application-support profile was left in place at the coordinator's direction.

**Low — singular audit count.** In a new workspace the audit card displays `1 entries`. Reproduce by opening a fresh workspace and viewing Audit history.

## Observed workflows

- Initial screen explains that new workspaces require file approval and that only actions sent through the gateway are checked. The normal dashboard separately labels `Dashboard connected to gateway` and `Codex not connected`, and explains that other Codex tools are outside the boundary. No Codex session was started.
- The isolated tutorial showed its baseline, exact path and proposed content. Approval confirmation initially focused Close; Escape closed it and returned focus to Review approval. Confirming approval produced a completed audit event and the actual tutorial file contained `You approved this change.`
- The normal workspace began with default decision APPROVAL and zero explicit rules. Basic policy editing describes explicit rule priority and warns that saving invalidates previous approvals. A draft expiry change was rehearsed: the result showed current and draft decisions and `300s → 50s`, with a clear no-execution/no-save explanation. Save produced revision 2 and a confirmation message. I did not test advanced rule editing or preservation.
- Two synthetic filesystem writes were submitted through the documented local API using the isolated agent credential. Rejecting one showed DENIED and Human rejected; its target file did not exist. Approving the other, with a long directory and filename, showed COMPLETED and wrote the expected test content. Both appeared in audit and recent history.
- The long-path request was opened after scrolling the queue. Its confirmation displayed the path and scope wrapped without observed clipping; scrolling within the dialog exposed Go back and Confirm approval. At the tested window size, the close control initially received focus. I did not complete a smaller-window test: attempts to resize through the UI did not reliably change the window.
- Choose Workspace opened the system folder picker and accepted the isolated workspace, with the isolation problem above. Reopen Last Workspace was available on initial test launch. Disconnect Codex was not available in the idle state; its connected-state availability and behavior were not tested because starting a session was outside scope. Stop and restart were visible, but were not exercised. Command-Q stopped the owned app and gateway processes.

## Assessment and limits

The boundary and separate connection labels were understandable in the idle state. The basic editor explains the priority of explicit rules and warns about invalidated approvals; a user still needs the guide or complete policy to understand the detailed defaults and advanced rules. The top-level wording is appropriately qualified for saved policies. The policy preview clearly distinguishes a decision comparison from execution. These are review judgments, not security guarantees.

`docs/desktop-operation.md` states it applies to version 2.2.0 and allows later source label/layout refinements; that matches the bundle's declared 2.2.0 version, but does not establish that this local build is the released artifact. `docs/API.md` labels the guided desktop connection section as a development checkout. No live agent, model call, sign-in, install, global config edit, release qualification, advanced-rule coverage, small-window coverage, or connected/disconnect flow was performed. Screenshots were inspected during the review but not saved.

## Cleanup

Command-Q stopped the owned native app and gateway; a process search found no remaining process for the review build or disposable root. The application-support profile created by the workspace-selection issue remains at the path above. The review's temporary root was removed after shutdown. No claim is made about other macOS preferences or state outside the examined profile.

During initial UI targeting, name-based app lookup also opened a different local acceptance bundle. Its tutorial attempt showed `The bundled gateway runtime is missing`; I terminated that extra process and then targeted the requested bundle by full path. That message is not a finding about the reviewed build. The exact-path build was used for the observations above.
