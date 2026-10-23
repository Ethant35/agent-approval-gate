# Cold backup and restore

Author: Ethan

The native gateway data directory contains the SQLite request history and the
human and agent bearer tokens. Treat the directory and every backup as
credentials. Keep backups encrypted by the local storage device, restrict access,
and do not put them in cloud sync or send them to another service.

`backupState(sourceDir, destinationDir)` and
`restoreState(sourceDir, destinationDir)` are exported from
`dist/maintenance.js`. They accept absolute canonical directory paths. The
destination must not exist. Each operation takes the native `server.lock` lease
for its source directory and fails if a gateway already holds that lease. Stop
the gateway before starting either operation. The lock check also protects
against two maintenance operations using the same source at once.

A backup uses SQLite `VACUUM INTO` while holding the lease, checks the copied
database with `PRAGMA quick_check`, copies only owned single-link regular token
files, and writes a manifest with SHA-256 checksums and file sizes. Restore
validates the manifest, checks every checksum and token shape, runs SQLite
`quick_check`, and only then creates a fresh destination. It does not start the
gateway, approve requests, execute pending actions, or replay effects. After a
restore, start the gateway normally and inspect pending requests before taking
any action.

The implementation hashes and copies database files in 64 KiB chunks. It does
not load a full database into memory. It rejects source directories with an
`INCOMPLETE` marker. It syncs output files and the destination directory before
removing that marker, then syncs the directory again. This uses local filesystem
`fsync` behavior; it does not promise crash durability on network filesystems or
cloud-mounted storage.

The manifest is not digitally signed. Its checksums detect changes to files
when the manifest remains intact; they do not prove who created a backup or
detect an attacker who can replace both the files and manifest. Protect the
backup directory as sensitive state.

Both operations create the destination directory with mode 0700 and files with
mode 0600. They never overwrite an existing destination. If an operation fails
after destination creation, it tries to leave an `INCOMPLETE` marker and partial
files for inspection. A storage or permission failure can also prevent the
marker from being created, leaving an empty, unmarked destination. Treat every
failed destination as unusable. Never start the gateway from it or reuse that
path; preserve it for inspection and retry only with a new destination path.

Use the CLI after stopping the gateway. The destination must be new, and its
parent directory must already exist:

```sh
aag backup --data /absolute/path/to/state --out /absolute/path/to/new-backup
aag restore --from /absolute/path/to/new-backup --data /absolute/path/to/new-state
```

Each command prints the destination path as JSON. It does not print token values.
The same operations are available to local Node maintenance scripts through
`backupState` and `restoreState` exported from `dist/maintenance.js`.

Restore is manual and cold. It does not restore a `server.lock` inode, host
policy files, the application binary, or external agent state. Keep policy and
application deployment material separately. The backup includes bearer-token
credentials, so changing host access may require rotating them through a future
supported workflow. Same-user hostile software that races filesystem changes is
outside this maintenance boundary. Network filesystems and cloud storage are not
qualified.

## Interrupted lease recovery

`server.lock` is a persistent inode. Never delete or overwrite it while a
gateway or native `safe-fs lock` helper may own the lease. Unlinking a live lock
can let another process create and lock a different inode for the same state.
Normal shutdown leaves the lock file in place. The native helper can reclaim a
stale versioned marker after it obtains the file lock, and it can reclaim a
legacy numeric PID marker only when the operating system confirms that PID is
gone. It refuses a live numeric PID, malformed marker, or empty marker.

For an empty or malformed marker, first stop launchers and gateway processes.
Inspect the process table and confirm there is no gateway using the exact state
directory and no `safe-fs lock` helper using its `server.lock` path:

```sh
ps -axo pid=,ppid=,command=
```

Review the rows manually for the exact canonical state path. If any matching
owner is running, or you cannot identify every owner, stop and investigate. Do
not rename the lock while an owner is live or while another startup can race the
recovery. Once the system is offline, preserve the suspect inode under a unique
name in the same directory:

```sh
STATE_DIR=/absolute/canonical/path/to/state
FAILED_LOCK="$STATE_DIR/server.lock.failed-$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$STATE_DIR/server.lock" && test ! -L "$STATE_DIR/server.lock"
test ! -e "$FAILED_LOCK"
mv "$STATE_DIR/server.lock" "$FAILED_LOCK"
```

Do not use `rm`, truncate, or replace `server.lock`. The rename preserves the
failed marker for inspection and lets the next startup create a new lock inode.
Restart the gateway, confirm it opens successfully, then inspect pending
requests before approving any action. The restart must not replay interrupted
effects automatically.
