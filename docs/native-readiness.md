# Native filesystem boundary qualification

Author: Ethan

## Scope and status

This report covers the C helper in `native/safe-fs.c`, which is compiled into the
packaged macOS arm64 application. It is not a general sandbox and does not enforce
the gateway's authorization policy by itself. The TypeScript service remains
responsible for policy, authentication, approval and lifecycle handling. The helper
only applies the checked descriptor operations and lock protocol requested by that
service.

The v1.0.1 acceptance suite provides historical evidence for approved file reads and
writes, symlink/hardlink rejection, workspace replacement rejection, and the actual
native process launcher. It did not exercise malformed native operation names,
caller-supplied byte limits below 1 MiB, or process-lifetime ownership of
`server.lock`. Those are distinct from the 1.0.1 path-authorization scenarios.

## Findings and repairs

Two native helper defects were reproduced before the implementation changed.

| Finding | Reproduction on original helper | Repair |
| --- | --- | --- |
| Unknown operation fell through to `read` | `safe-fs read-anything-else <file> <valid-snapshot> 1048576` returned the file bytes with status 0 | Accept only `inspect`, `read`, `write`, and `inspect-directory`; reject unknown verbs before opening a path |
| `max-bytes` was ignored | `read <6-byte-file> <snapshot> 2` returned all six bytes; `write ... 2` wrote a seven-byte input and truncated the original | Parse a strict decimal limit from 1 through 1,048,576; enforce it before modifying a file. Buffer reads through EOF before writing stdout so over-limit reads emit no prefix |
| Unrelated child-directory creation invalidated a file approval | Inspect an existing file, create a sibling directory under an ancestor, then write with the original snapshot; the helper rejected it with `ESTALE` because the ancestor directory's link count increased | Omit `st_nlink` from directory fingerprint entries while retaining directory device/inode identity. Keep the regular-file single-link check and file link count in its fingerprint |

The lock mode adds a held, nonblocking `flock(2)` lease for the state lock path. It
walks each parent directory with `openat` and `O_NOFOLLOW`, then requires an
effective-user-owned regular file with one link, applies mode 0600, and takes an
exclusive nonblocking lock. It writes `v2:<parent-pid>` only after acquiring the
lock and keeps the descriptor open while reading its stdin pipe. EOF releases the
kernel lock. The helper never unlinks the lock inode.

The helper creates a missing lock inode with `O_CREAT|O_EXCL`. When a path exists,
it opens without following a symlink, takes the lock, and checks the prior marker.
A live legacy PID causes refusal, a stale numeric PID may be upgraded, and malformed
or empty existing markers fail closed. The TypeScript layer propagates native legacy-PID acquisition failures and stops
the server if the held helper exits unexpectedly. This avoids silently continuing after loss of the lease. The native
marker does not establish authorization; it is an instance-ownership signal.

Apple documents `flock` as advisory and says non-cooperating programs can still
access the file. Therefore this lease serializes supported gateway versions that use
it; it does not control arbitrary same-user software. The actual lock test below ran
on the supported local macOS arm64 system. Network filesystems and other operating
systems are not qualified.

## Static finding triage

I reviewed the native-path findings in the completed Semgrep outputs
`static_analysis_semgrep_1/raw/all-0xdea-semgrep-rules.json`,
`all-security-audit.json`, and `all-elttam-semgrep-rules.json`. The 0xdea and
security-audit outputs reported no execution errors. Elttam reported 12 errors
outside this native finding; its only `safe-fs.c` result was the `execv`
candidate below. Findings use source line numbers from the scan snapshot, so
they may differ from the current file after the repair below.

- The security-audit `insecure-use-strcat-fn` candidate at the missing-file
  fingerprint append was bounded by a prior `strlen`/capacity check, but the
  C string API obscured that proof. I replaced it with a subtraction-safe size
  check and `memcpy` of the complete literal, including its NUL terminator. The
  focused missing-file and existing-file positive controls pass under ASan and
  UBSan.
- The Elttam `exec` candidate is `execv` in the explicit `run-workspace` mode.
  The branch checks argument count and an absolute executable path, compares the
  current directory identity against the approved snapshot, changes directory
  through the checked descriptor, and passes the exact remaining argv to
  `execv`; it does not invoke a shell. The positive `/usr/bin/pwd` control and
  replaced-workspace rejection exercise this boundary.
- The 0xdea argv findings are review candidates. The helper checks mode-specific
  `argc` before each indexed access: exactly four arguments for `lock`, exactly
  five for filesystem operations, and at least five for `run-workspace`.
  Operation names are allow-listed, paths must be absolute and at most 4096
  bytes, and decimal limits/PIDs are parsed with overflow checks before use.
- The signed/unsigned conversion and truncation candidates are guarded: decimal
  digits are range-checked before conversion; `snprintf` lengths are checked
  for negative or out-of-capacity results before conversion to `size_t`; and
  `pread` results are checked for errors and buffer length before indexing.
  The reported size arithmetic candidates operate on limits capped at 1 MiB,
  with reads/writes bounded by the remaining capacity and an extra byte used
  only to detect overflow of the caller's limit.
- The two stack-buffer candidates are bounded local buffers. The lock marker
  buffer reads at most its fixed capacity and rejects a full buffer before
  adding a terminator; the path/fingerprint buffers use fixed capacity checks
  before formatting or appending. The two typo candidates and the generic
  bad-word match were reviewed in context and did not identify a behavioral
  defect. The 28 `interesting-api-calls` matches are candidate sinks, not
  vulnerabilities: descriptor opens use `O_NOFOLLOW` and checked descriptor
  types; reads/writes are length-bounded; lock and metadata calls implement the
  stated protocol; and process execution is limited to the checked argv path
  above.

The reported existing-file UI approval error (`Stale NFS file handle`) first
passed a direct inspect/write reproduction, then reproduced in the actual
backup/restore approval flow. Creating backup and restore directories as
siblings changed an ancestor directory's `st_nlink`, which the old fingerprint
included even though the target file and directory identities were unchanged.
The repair excludes directory link counts from fingerprints. The native
regression changes a sibling directory between snapshot and write; the gateway
integration test now keeps backup destinations in the same state-directory
parent and still completes approval after restore. This does not establish
arbitrary race immunity.

## Reproducible verification

Run `scripts/verify-native.sh` from the repository root. It compiles the production
C source into a temporary directory with Apple Clang AddressSanitizer and
UndefinedBehaviorSanitizer, strict warnings, and debug symbols. The Python harness
invokes that real compiled helper against temporary filesystem fixtures. It checks
observable content, file existence and metadata; it does not duplicate the C path
walker or snapshot algorithm as its oracle.

The accepted local run completed **1,243 checks**, including **1,200 structured
mutations** with seed `0xA6610`, in 13.01 seconds. It tested:

- malformed and incomplete argv, unknown operations, relative/dot/traversal/long
  paths, invalid and overflowing byte limits, and invalid lock owners;
- exact 1 MiB read/write success, one-byte-over-limit failure, no partial read
  output, and no create/truncate side effect after oversized writes;
- symlink parents/finals, hardlinks, FIFOs, stale file snapshots, and replaced
  directory snapshots;
- an approved snapshot followed by a positive write to an existing file, then
  a fresh snapshot of the updated file;
- successful approved write after creating an unrelated sibling directory
  under an ancestor of the target;
- old workspace identity rejection paired with a successful `/bin/pwd` launch
  control;
- state-lock mutual exclusion, marker format and mode, live/stale/malformed legacy
  markers, symlink/hardlink rejection, reacquisition after EOF, and persistent path
  identity without unlink.

The environment was macOS 27.2 arm64, Apple Clang 21.0.0 (`clang-2100.4.1.1`),
and Python 3.15.0. The sanitizer build and all checks passed. AddressSanitizer's
memory error checks and UBSan ran; LeakSanitizer did not. This Apple runtime reports
that `detect_leaks` is unsupported on this platform.

I also tried the compiler's libFuzzer link mode. The installed Apple Clang lacks
`libclang_rt.fuzzer_osx.a`, so a coverage-guided campaign cannot run with this local
toolchain. The checked-in fallback is a deterministic, seeded structured mutation
campaign that drives the real helper as a subprocess under ASan and UBSan. It is not
represented as coverage-guided fuzzing, exhaustive fuzzing, or a proof of race
immunity.

To test lease release on parent death, the holder must remain a child process whose
stdin is a pipe owned only by its gateway parent. The current harness closes that
pipe and verifies EOF release. The parent integration must additionally verify that
SIGKILL of the actual TypeScript parent closes the pipe and permits a fresh server
to start; that service-level restart check belongs to the gateway integration suite.

## Skill use

| Installed skill | Phase | Files/workflow applied | Output and verification |
| --- | --- | --- | --- |
| `harness-writing` | Native test design | Read `SKILL.md`; identified helper CLI as the target, isolated exit-based invocations in child processes, bounded inputs, used deterministic fixtures and saved seed/iteration details | `tests/native/verify_native.py`; actual compiled helper run under ASan/UBSan |
| `property-based-testing` | Invariant design | Read `SKILL.md`, `references/generating.md`, and `references/refactoring.md`; used structured generation because filesystem effects have a useful independent invariant; did not add a property library or expose an artificial pure seam | 1,200 seeded path/operation/fingerprint/size mutations; outside sentinel remained byte-identical |
| `test-driven-development` | Defect repair | Read `SKILL.md`; ran the real helper first with unknown operation and small byte-limit cases; observed the incorrect successful read/write before changing C | New regression assertions now reject both, while positive read/write controls pass |
| `systematic-debugging` | Root cause | Read `SKILL.md`; traced CLI argv through the operation branch and compared the caller's `1048576` argument with the C hard-coded limit; verified separate failure paths before repair | Added strict operation/limit parsing and regression tests; sanitizer suite passes |
| `variant-analysis` | Defect-family sweep | Read `SKILL.md` and `references/root-cause.md`, `searching.md`, `triage.md`, and `reporting.md`; searched the whole repository for native operation dispatch, limits, snapshot calls and lock creation; triaged actual helper entrypoints | Found the operation-default and ignored-limit instances in one CLI dispatcher; the HTTP/application code has independent limits and was left outside this native patch. The live-lock compatibility check is repeated inside the native lock after acquisition to close the legacy startup race |

## Primary references

- Apple's [`flock(2)` reference](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html) documents exclusive nonblocking locks and explicitly describes them as advisory.
- Apple's [`open(2)` reference](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html) documents `O_NOFOLLOW`, `O_EXCL`, and `O_NONBLOCK`. These older archived references informed the design; compilation and behavioral claims come from current local macOS tests.
- The current [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) and [UndefinedBehaviorSanitizer documentation](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) describe the runtime checks used by the local build.
- The [LLVM libFuzzer guide](https://llvm.org/docs/LibFuzzer.html) describes the unavailable coverage-guided mode. Its runtime library was absent from this installed Apple Clang toolchain.

## Remaining limits

This harness tests serialized replacement cases, not privileged concurrent rename or
mount races. Advisory locking only coordinates callers that use the lock protocol.
The TypeScript startup/shutdown integration and real gateway SIGKILL/restart scenario
must pass before the application can claim crash-recovery qualification. The checks
here establish behavior on this one local macOS arm64 environment only.
