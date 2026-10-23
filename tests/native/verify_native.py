#!/usr/bin/env python3
# Author: Ethan. Real safe-fs CLI acceptance and structured mutation harness.
import os
import random
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def run(binary, *args, data=b"", timeout=3):
    return subprocess.run(
        [str(binary), *map(str, args)],
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def expect_rejected(result, message):
    require(result.returncode != 0, f"{message}: unexpectedly succeeded")


def acquire_lock(binary, lock_path, timeout=3):
    process = subprocess.Popen(
        [str(binary), "lock", str(lock_path), str(os.getpid())],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    ready, _, _ = select.select([process.stdout], [], [], timeout)
    if not ready:
        process.kill()
        raise AssertionError("native lock helper did not report readiness")
    line = process.stdout.readline()
    if line != "locked\n":
        stderr = process.stderr.read()
        process.kill()
        raise AssertionError(f"native lock helper failed to acquire: {line!r} {stderr!r}")
    return process


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_native.py SAFE_FS")
    binary = Path(sys.argv[1]).resolve()
    require(binary.is_file(), f"missing native helper: {binary}")
    checks = 0
    with tempfile.TemporaryDirectory(prefix="aag-native-") as temporary:
        root = Path(temporary).resolve(strict=True)
        workspace = root / "workspace"
        outside = root / "outside"
        workspace.mkdir()
        outside.mkdir()
        original = workspace / "target.txt"
        original.write_bytes(b"before")
        protected = outside / "secret.txt"
        protected.write_bytes(b"protected-secret")
        relative = str(original)
        fingerprint = run(binary, "inspect", relative, "", "1048576")
        require(fingerprint.returncode == 0, f"valid inspect failed: {fingerprint.stderr.decode(errors='replace').strip()}")
        stamp = fingerprint.stdout.decode("ascii").strip()
        require(bool(stamp), "valid inspect returned an empty snapshot")
        checks += 1

        for argv in (
            (),
            ("inspect",),
            ("inspect", relative, ""),
            ("run-workspace", str(workspace), "snapshot"),
            ("run-workspace", str(workspace), "snapshot", "relative-executable"),
        ):
            expect_rejected(run(binary, *argv), f"malformed argv {argv!r}")
            checks += 1

        allowed_read = run(binary, "read", relative, stamp, "1048576")
        require(allowed_read.returncode == 0, "positive read control failed")
        require(allowed_read.stdout == b"before", "positive read returned wrong bytes")
        checks += 1

        # Snapshot and replace an already-existing regular file. This mirrors
        # the gateway's approved write path, including a fresh metadata stamp.
        approved_stamp = run(binary, "inspect", relative, "", "1048576")
        require(approved_stamp.returncode == 0, "existing-file write snapshot failed")
        approved_write = run(
            binary,
            "write",
            relative,
            approved_stamp.stdout.decode().strip(),
            "1048576",
            data=b"approved result",
        )
        require(approved_write.returncode == 0, "positive existing-file write failed")
        require(original.read_bytes() == b"approved result", "existing-file write returned wrong bytes")
        stamp = run(binary, "inspect", relative, "", "1048576").stdout.decode().strip()
        require(bool(stamp), "existing-file write did not produce a fresh snapshot")
        checks += 1

        # A new unrelated sibling changes ancestor directory st_nlink, but it
        # must not invalidate an approval for this unchanged file and path.
        sibling_snapshot = run(binary, "inspect", relative, "", "1048576")
        require(sibling_snapshot.returncode == 0, "sibling-change snapshot failed")
        (root / "unrelated-sibling").mkdir()
        sibling_write = run(
            binary,
            "write",
            relative,
            sibling_snapshot.stdout.decode().strip(),
            "1048576",
            data=b"approved result",
        )
        require(sibling_write.returncode == 0, "unrelated sibling invalidated file snapshot")
        require(original.read_bytes() == b"approved result", "sibling control changed file incorrectly")
        stamp = run(binary, "inspect", relative, "", "1048576").stdout.decode().strip()
        checks += 1

        # The implementation ceiling accepts exactly 1 MiB and rejects one
        # byte more without creating/truncating a file or emitting a read prefix.
        boundary = workspace / "boundary.bin"
        boundary_data = b"x" * 1048576
        boundary_snapshot = run(binary, "inspect", str(boundary), "", "1048576")
        boundary_write = run(
            binary,
            "write",
            str(boundary),
            boundary_snapshot.stdout.decode().strip(),
            "1048576",
            data=boundary_data,
        )
        require(boundary_write.returncode == 0, "exact maximum write failed")
        boundary_after_write = run(binary, "inspect", str(boundary), "", "1048576")
        boundary_read = run(
            binary,
            "read",
            str(boundary),
            boundary_after_write.stdout.decode().strip(),
            "1048576",
        )
        require(boundary_read.returncode == 0, "exact maximum read failed")
        require(boundary_read.stdout == boundary_data, "maximum-size roundtrip changed bytes")
        checks += 1

        too_big_missing = workspace / "oversized-create.bin"
        too_big_snapshot = run(binary, "inspect", str(too_big_missing), "", "1048576")
        too_big_write = run(
            binary,
            "write",
            str(too_big_missing),
            too_big_snapshot.stdout.decode().strip(),
            "1048576",
            data=boundary_data + b"x",
        )
        expect_rejected(too_big_write, "write above hard maximum")
        require(not too_big_missing.exists(), "above-limit create left a file")

        too_big_read_path = workspace / "oversized-read.bin"
        too_big_read_path.write_bytes(boundary_data + b"x")
        too_big_read_snapshot = run(binary, "inspect", str(too_big_read_path), "", "1048576")
        too_big_read = run(
            binary,
            "read",
            str(too_big_read_path),
            too_big_read_snapshot.stdout.decode().strip(),
            "1048576",
        )
        expect_rejected(too_big_read, "read above hard maximum")
        require(too_big_read.stdout == b"", "above-limit read emitted partial bytes")
        require(too_big_read_path.stat().st_size == 1048577, "oversized read changed source file")
        checks += 1

        # Unknown operations must fail closed. The old helper treated any unknown
        # operation as read, which emitted a valid target's contents.
        malformed = run(binary, "read-anything-else", relative, stamp, "1048576")
        expect_rejected(malformed, "unknown operation")
        require(malformed.stdout == b"", "unknown operation emitted file contents")
        checks += 1

        # Same bytes at the same pathname do not preserve authorization when an
        # opened parent directory is replaced.
        nested = workspace / "nested"
        nested.mkdir()
        nested_file = nested / "item.txt"
        nested_file.write_bytes(b"same")
        nested_snapshot = run(binary, "inspect", str(nested_file), "", "1048576")
        moved_nested = workspace / "moved-nested"
        nested.rename(moved_nested)
        nested.mkdir()
        replaced_nested_file = nested / "item.txt"
        replaced_nested_file.write_bytes(b"same")
        stale_parent = run(
            binary,
            "write",
            str(replaced_nested_file),
            nested_snapshot.stdout.decode().strip(),
            "1048576",
            data=b"no",
        )
        expect_rejected(stale_parent, "replaced parent directory snapshot")
        require(replaced_nested_file.read_bytes() == b"same", "parent replacement received stale write")
        checks += 1

        # The byte limit is a caller-supplied bound. Reject before output/write,
        # and leave existing content intact.
        small_read = run(binary, "read", relative, stamp, "2")
        expect_rejected(small_read, "read above caller limit")
        require(small_read.stdout == b"", "limited read leaked a partial prefix")
        checks += 1

        small_write = run(binary, "write", relative, stamp, "2", data=b"replacement")
        expect_rejected(small_write, "write above caller limit")
        require(original.read_bytes() == b"approved result", "oversized write changed target")
        checks += 1

        # Limits must parse as strict decimal integers and remain capped by the
        # helper's documented hard maximum.
        for invalid_limit in ("", "0", "-1", "2x", "1048577", "999999999999999999999"):
            result = run(binary, "inspect", relative, "", invalid_limit)
            expect_rejected(result, f"invalid byte limit {invalid_limit!r}")
            checks += 1

        # Approval binds both file metadata and every opened parent directory.
        old_stamp = run(binary, "inspect", relative, "", "1048576").stdout.decode().strip()
        original.write_bytes(b"changed")
        changed = run(binary, "write", relative, old_stamp, "1048576", data=b"no")
        expect_rejected(changed, "changed file snapshot")
        require(original.read_bytes() == b"changed", "stale snapshot modified file")
        checks += 1

        # Traversal, symlink parents/finals, hardlinks, and special files are
        # rejected based on actual filesystem effects, with path controls.
        escaping = run(binary, "inspect", str(workspace / ".." / "outside" / "secret.txt"), "", "1048576")
        expect_rejected(escaping, "parent traversal")
        require(protected.read_bytes() == b"protected-secret", "traversal changed outside file")
        checks += 1

        for bad_path in ("relative.txt", f"{workspace}/./target.txt", "/" + "a" * 4097):
            expect_rejected(run(binary, "inspect", bad_path, "", "1048576"), f"invalid path {bad_path[:32]!r}")
            checks += 1

        symlink = workspace / "secret-link"
        symlink.symlink_to(protected)
        expect_rejected(run(binary, "inspect", str(symlink), "", "1048576"), "final symlink")
        checks += 1
        parent_link = workspace / "linked-dir"
        parent_link.symlink_to(outside, target_is_directory=True)
        expect_rejected(run(binary, "inspect", str(parent_link / "secret.txt"), "", "1048576"), "parent symlink")
        checks += 1

        hardlink = workspace / "hardlink"
        os.link(original, hardlink)
        expect_rejected(run(binary, "inspect", str(hardlink), "", "1048576"), "hardlinked target")
        checks += 1

        fifo = workspace / "fifo"
        os.mkfifo(fifo)
        expect_rejected(run(binary, "inspect", str(fifo), "", "1048576"), "FIFO target")
        checks += 1

        # Missing-file creation is exclusive and bounded; the approved positive
        # case writes through the descriptor that passed the snapshot check.
        created = workspace / "created.txt"
        missing_stamp = run(binary, "inspect", str(created), "", "1048576")
        require(missing_stamp.returncode == 0, "missing-file positive snapshot failed")
        created_result = run(
            binary,
            "write",
            str(created),
            missing_stamp.stdout.decode().strip(),
            "3",
            data=b"four",
        )
        expect_rejected(created_result, "oversized exclusive create")
        require(not created.exists(), "oversized create left a file")
        checks += 1

        # Native workspace identity is checked again before exec. A same-name
        # replacement must not receive an old approved command.
        old_workspace_stamp = run(binary, "inspect-directory", str(workspace), "", "1048576")
        require(old_workspace_stamp.returncode == 0, "workspace inspect positive control failed")
        old_identity = old_workspace_stamp.stdout.decode().strip()
        moved = root / "moved-workspace"
        workspace.rename(moved)
        workspace.mkdir()
        marker = workspace / "unexpected-marker"
        replacement = run(
            binary,
            "run-workspace",
            str(workspace),
            old_identity,
            "/usr/bin/touch",
            str(marker),
        )
        expect_rejected(replacement, "replacement workspace launch")
        require(not marker.exists(), "replacement workspace received old command")
        checks += 1

        # Positive launch control confirms the test does not pass merely because
        # the native process launcher is broken. /bin/pwd reports checked cwd.
        current_identity = run(binary, "inspect-directory", str(workspace), "", "1048576")
        launched = run(
            binary,
            "run-workspace",
            str(workspace),
            current_identity.stdout.decode().strip(),
            "/bin/pwd",
        )
        require(launched.returncode == 0, "positive workspace launch control failed")
        require(launched.stdout.strip() == str(workspace).encode(), "launcher used wrong cwd")
        checks += 1

        # Native held locks serialize servers, survive the textual PID marker,
        # and release on pipe EOF without unlinking a potentially newer lease.
        lock_path = root / "state" / "server.lock"
        lock_path.parent.mkdir(mode=0o700)
        holder = acquire_lock(binary, lock_path)
        require(lock_path.read_text() == f"v2:{os.getpid()}\n", "lock marker was not written")
        require(lock_path.stat().st_mode & 0o777 == 0o600, "lock mode is not 0600")
        competing = run(binary, "lock", str(lock_path), str(os.getpid()))
        expect_rejected(competing, "second lock owner")
        require(holder.poll() is None, "first lock holder exited while pipe stayed open")
        holder.stdin.close()
        require(holder.wait(timeout=3) == 0, "EOF did not release native lock cleanly")
        # The persistent lock file is intentional. A fresh process may acquire
        # it after the prior descriptor has closed.
        next_holder = acquire_lock(binary, lock_path)
        next_holder.stdin.close()
        require(next_holder.wait(timeout=3) == 0, "released lock could not be reacquired")
        require(lock_path.exists(), "lock helper unlinked persistent lock path")
        checks += 1

        legacy_live = root / "legacy-live.lock"
        legacy_live.write_text(f"{os.getpid()}\n")
        expect_rejected(
            run(binary, "lock", str(legacy_live), str(os.getpid())),
            "live legacy PID lock",
        )
        require(legacy_live.read_text() == f"{os.getpid()}\n", "live legacy lock was overwritten")
        checks += 1

        legacy_stale = root / "legacy-stale.lock"
        legacy_stale.write_text("2147483647\n")
        stale_holder = acquire_lock(binary, legacy_stale)
        require(legacy_stale.read_text() == f"v2:{os.getpid()}\n", "stale legacy marker was not upgraded")
        stale_holder.stdin.close()
        require(stale_holder.wait(timeout=3) == 0, "upgraded legacy lock did not release")
        checks += 1

        empty_legacy = root / "legacy-empty.lock"
        empty_legacy.touch(mode=0o600)
        expect_rejected(
            run(binary, "lock", str(empty_legacy), str(os.getpid())),
            "ambiguous empty existing lock",
        )
        require(empty_legacy.read_bytes() == b"", "empty existing lock was overwritten")
        checks += 1

        malformed_legacy = root / "legacy-malformed.lock"
        malformed_legacy.write_text("not-a-pid\n")
        expect_rejected(
            run(binary, "lock", str(malformed_legacy), str(os.getpid())),
            "malformed existing lock marker",
        )
        require(malformed_legacy.read_text() == "not-a-pid\n", "malformed lock marker was overwritten")
        checks += 1

        wrong_parent = run(binary, "lock", str(root / "wrong-parent.lock"), "1")
        expect_rejected(wrong_parent, "mismatched parent PID")
        require(not (root / "wrong-parent.lock").exists(), "invalid owner created lock file")
        checks += 1

        lock_symlink = root / "lock-symlink"
        symlink_target = root / "symlink-target"
        symlink_target.write_text("untouched")
        lock_symlink.symlink_to(symlink_target)
        expect_rejected(run(binary, "lock", str(lock_symlink), str(os.getpid())), "symlink lock path")
        require(symlink_target.read_text() == "untouched", "symlink target changed")
        checks += 1

        lock_parent_symlink = root / "lock-parent-link"
        lock_parent_symlink.symlink_to(lock_path.parent, target_is_directory=True)
        through_symlink = lock_parent_symlink / "through-link.lock"
        expect_rejected(
            run(binary, "lock", str(through_symlink), str(os.getpid())),
            "symlink lock parent",
        )
        require(not (lock_path.parent / "through-link.lock").exists(), "lock parent symlink was followed")
        checks += 1

        lock_hardlink = root / "lock-hardlink"
        lock_hardlink_source = root / "lock-hardlink-source"
        lock_hardlink_source.write_text("untouched")
        os.link(lock_hardlink_source, lock_hardlink)
        expect_rejected(run(binary, "lock", str(lock_hardlink), str(os.getpid())), "hardlink lock path")
        require(lock_hardlink_source.read_text() == "untouched", "hardlink source changed")
        checks += 1

        malformed_lock = run(binary, "lock", str(root / "malformed.lock"), "-1")
        expect_rejected(malformed_lock, "malformed lock owner")
        require(not (root / "malformed.lock").exists(), "malformed owner created lock file")
        checks += 1

        # Deterministic structured mutation campaign. It exercises malformed
        # path, operation, fingerprint, and size fields against the real helper.
        # The independent oracle is the protected file's exact bytes plus the
        # rule that only explicit read/write/inspect verbs may succeed.
        seed = 0xA6610
        rng = random.Random(seed)
        protected_before = protected.read_bytes()
        tokens = ["", ".", "..", "...", "target.txt", "secret.txt", "fifo", "hardlink", "secret-link", "a" * 255]
        operations = ["inspect", "read", "write", "inspect-directory", "run-workspace", "", "unknown"]
        fingerprints = ["", "0", stamp, "0" * 65535, "../../x", "not:a:snapshot"]
        limits = ["0", "1", "2", "1048575", "1048576", "1048577", "-1", "x", "9" * 200]
        started = time.monotonic()
        iterations = 1200
        for index in range(iterations):
            op = rng.choice(operations)
            parts = [rng.choice(tokens) for _ in range(rng.randrange(0, 5))]
            path = str(workspace) + ("/" + "/".join(parts) if parts else "")
            fp = rng.choice(fingerprints)
            limit = rng.choice(limits)
            result = run(binary, op, path, fp, limit, data=rng.randbytes(rng.randrange(0, 32)))
            require(result.returncode in (0, 1, 2), f"unexpected status at mutation {index}")
            require(protected.read_bytes() == protected_before, f"mutation {index} changed outside sentinel")
        elapsed = time.monotonic() - started
        checks += iterations

    print(
        f"PASS native boundary checks={checks} structured_mutations={iterations} "
        f"seed=0xA6610 elapsed_seconds={elapsed:.2f}"
    )


if __name__ == "__main__":
    main()
