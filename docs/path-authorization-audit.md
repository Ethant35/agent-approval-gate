# Path authorization audit, 2026-10-22

Author: Ethan

## Expert method and bounded rewrite

Field: security engineering for permission gateways. Ethan invoked the installed be-ambitious skill and explicitly authorized executing the resulting prompt.

1. An expert would try to falsify resource identity guarantees across equivalent path spellings and approval/execution changes, instead of treating a passing release suite as completeness.
2. Raw material: released policy parsing and comparisons, SQLite policy records, server startup order, executor snapshots, native filesystem traversal, and actual protected file contents and process side effects. Historical 1.0.0 acceptance remains evidence of those tests, not proof against newly discovered cases.
3. Method: upstream Node implementation and Apple filesystem references, real CLI/server/browser E2E reproductions, directory and symlink replacement, persisted legacy data fixtures, and descriptor-relative native execution. No executor mocks or unit tests.
4. Independent criteria: denied reads return no protected data, protected writes leave files unchanged, overlapping startup creates no operator token, replaced workspaces receive no approved side effects, and valid approved controls still execute. Full applicable local acceptance must pass before release.

The executed rewrite was:

```text
Take Agent Approval Gate's existing path-authorization guarantees and try to
falsify them. Start from the released code and raw acceptance evidence.

Limit this task to three questions:
1. Do equivalent policy-path spellings preserve allow and deny decisions?
2. Can case or other path aliases hide overlap between the workspace and
   private operator state?
3. Can replacing a workspace after submission redirect an approved subprocess?

Use current Node source/documentation and Apple filesystem references.
Write real end-to-end reproductions before fixing confirmed defects. Keep
positive controls so a broken executor cannot count as successful protection.

Repair the smallest underlying authorization defects. Add no new product
features. Preserve existing interfaces where safe, and explain any fail-closed
compatibility change. Record before/after results and remaining limits.

Pass only if protected files and credentials remain inaccessible, changed
workspace identity invalidates old approval, approved controls still work,
and all applicable local acceptance gates pass. Then deliver a reviewed patch
through GitHub, with Actions disabled and reproducible evidence.
```

## Primary-source findings

- The [Node v22.13.1 path implementation](https://github.com/nodejs/node/blob/v22.13.1/lib/path.js) explicitly preserves a trailing separator in POSIX `normalize`; `resolve` removes it. This is the tested runtime's upstream source, not an assumption about every future Node release. The defect also retained the original strings after validating normalized copies.
- [Node 22 filesystem documentation](https://nodejs.org/docs/latest-v22.x/api/fs.html#fsrealpathpath-options-callback) states ordinary `realpath` does no case conversion on case-insensitive filesystems and that canonical paths need not be unique. `realpathSync.native` uses native realpath. The local case-alias fixture verifies native canonicalization on the release filesystem. This does not prove mount or hardlink uniqueness.
- Apple's archived [open(2) reference](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html) documents `O_NOFOLLOW` and `O_EXCL`. These support the component-by-component descriptor strategy; current behavior is established by compiled native code and local real-execution tests, not the age of this reference.
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html) serialize writers. They do not make external process/filesystem side effects atomic with a database transaction. This audit adds no such claim.

## Reproduced defects and repair

Baseline implementation: `471b6966106b232964589dba0fc1c6cd7b866a28`, with the released 1.0.0 implementation. Seven new real E2E scenarios produced six failures and one pass in 15.46 seconds. The [sanitized baseline](../evidence/path-authorization/before.json) preserves expected and observed results.

| Scenario | Released behavior | Repair |
| --- | --- | --- |
| Deny directory ending in `/`, `/.`, or `//` | Three protected reads completed | Normalize and store all policy paths before comparisons and Seatbelt generation |
| Allow workspace ending in `/./` | Valid read denied | Same canonical representation restores allowed read |
| Private state below case-alias workspace | Second gateway listened with state inside workspace | Native canonical spelling required; overlap checked before credential creation |
| Directory replaced after process submission | Approved shell wrote marker in replacement | Snapshot directory chain; native launcher rechecks and uses `fchdir` before `execv` |
| Symlink replacement | Already failed safely | Preserve rejection; explicitly verify shell and subagent paths |

The expanded suite also checks normal-spelling overlap without token creation, legacy persisted policy normalization with stale approval rejection, OS deny enforcement with a working process control, subagent replacement, and rejection of old process approvals without workspace identity. Offline SQLite edits create historical storage fixtures only; request handlers and executors are real.

## Compatibility and limits

No API or policy schema version changes. Native canonical spelling is now required for private state. Normalized legacy policy storage creates a new revision, which invalidates old approvals. A 1.0.0 process approval cannot survive the new workspace identity check and must be resubmitted. Unchanged filesystem approvals retain restart behavior. Policy load errors prevent startup; existing state is not silently discarded.

The native launcher closes the pathname-to-cwd replacement gap by opening and checking each component, then using the checked directory descriptor for cwd. Seatbelt and absolute command arguments still contain paths. Privileged concurrent renames, executable installation mutation, mount manipulation, inode reuse, and arbitrary hostile programs remain outside scope. Case-insensitive fixtures are qualified on the tested macOS volume, not all possible filesystems. See [SECURITY.md](../SECURITY.md).

## Acceptance

Targeted repair run: all 12 expanded scenarios passed. A thirteenth upgrade scenario was then added. Complete clean-checkout acceptance and installed-package verification are required before publishing 1.0.1; final results are recorded in ACCEPTANCE.md and evidence/path-authorization/.
