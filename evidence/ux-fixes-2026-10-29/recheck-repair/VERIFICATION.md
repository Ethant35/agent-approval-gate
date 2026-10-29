# Independent recheck and repairs

Author: Ethan. October 29, 2026.

Terra performed a fresh independent UI review of the local build without earlier reports or implementation context. See ../../independent-ux-recheck-2026-10-29/REPORT.md. It confirmed the dialog, qualified policy wording, separate connection labels and 2.2.0 guide, within its stated coverage. It found a test-root escape in Choose Workspace, a singular audit-count typo, and another development-checkout heading in the API guide.

Repairs:
- Every native gateway start now enforces the isolated application-data root when --test-root is active; an absent isolated root fails closed. This central check covers Choose Workspace as well as tutorial/reopen/restart.
- Audit count uses “1 entry” and plural “entries” otherwise.
- The guided API section identifies version 2.2.0.

Native regression: launched native-reviewed-final with a fresh test root, created revision 2 and a pending offline request through the documented local API, then selected the SAME directory using the actual NSOpenPanel. The gateway restarted with the same isolated --root. Read-back confirmed revision 2, the changed expiry and the pending request remained. No normal application-support profile was created. Command-Q exited; its port is closed. See isolation.json. The final native lifecycle harness passed Command-Q and window-close. Final build, type and format checks pass. All 15 final browser UI tests pass. The broader offline run had 58 passes and one stale Go back focus expectation; the expectation was updated to Close confirmation and that gateway test passed on rerun. No model session ran. Dependency audit reported zero vulnerabilities; installed-package checks passed before the final native-only and audit-count edits.

The unrelated test-created profile from Terra's repro was identified by its exact profile.json workspace and moved out of normal application support to the private ignored .acceptance/ux-fixes-2026-10-29/recovered-review-profile directory. No other workspace profile was touched. The original report's cleanup state is historical. Reviewer is stopped.

This is source and local-app qualification, not a signed replacement release. Small-window native manual coverage remains limited; browser geometry regression covers 760×616 and 760×320. Live/connected Codex and disconnect were not rechecked. Final artifact: .acceptance/ux-fixes-2026-10-29/native-reviewed-final/Agent Approval Gate.app; earlier local candidates are superseded. Images carry Author=Ethan metadata; Finder indexing remains unverified.
