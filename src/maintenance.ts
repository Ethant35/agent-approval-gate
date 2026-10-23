// Author: Ethan. Cold backup and restore for the private gateway state directory.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acquireLease } from './lease.js';

const manifestName = 'manifest.json';
const partialName = 'INCOMPLETE';
const stateFiles = ['gateway.sqlite', 'human.token', 'agent.token'] as const;
type StateFile = (typeof stateFiles)[number];
type Manifest = {
  format: 'agent-approval-gate-backup-v1';
  author: 'Ethan';
  createdAt: string;
  files: Record<StateFile, { sha256: string; size: number }>;
};
type Checksum = { sha256: string; size: number };

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertCompleteSource(directory: string) {
  if (await exists(path.join(directory, partialName))) throw Error('Source state is incomplete');
}

async function canonicalDirectory(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value)
    throw Error('Directory path must be absolute and canonical');
  const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error('Directory must be a real directory');
  if ((await realpath(value)) !== value) throw Error('Directory path must be canonical');
  return value;
}

async function freshDestination(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value)
    throw Error('Destination path must be absolute and canonical');
  const parent = path.dirname(value);
  if ((await realpath(parent)) !== parent) throw Error('Destination parent must be canonical');
  try {
    await lstat(value);
    throw Error('Destination already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return value;
}

async function marker(directory: string) {
  const handle = await open(path.join(directory, partialName), 'wx', 0o600);
  try {
    await handle.writeFile(
      'Backup or restore is incomplete. Do not use this directory as live state.\n',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function beginDestination(destination: string) {
  await mkdir(destination, { mode: 0o700 });
  try {
    await chmod(destination, 0o700);
    await marker(destination);
    await syncDirectory(destination);
    await syncDirectory(path.dirname(destination));
  } catch (error) {
    // Preserve a visible partial-state marker even if its first exclusive create failed.
    try {
      await writeFile(path.join(destination, partialName), 'Incomplete maintenance operation.\n', {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      /* The destination remains fresh and empty if marker creation itself failed. */
    }
    throw error;
  }
}

async function failClosed(directory: string, error: unknown): Promise<never> {
  try {
    await lstat(path.join(directory, partialName));
  } catch {
    try {
      await marker(directory);
    } catch {
      /* Preserve the original error if storage itself prevents a marker. */
    }
  }
  throw error;
}

async function finishDestination(directory: string) {
  await syncDirectory(directory);
  await unlink(path.join(directory, partialName));
  await syncDirectory(directory);
}

async function openRegularPrivateFile(file: string, maxBytes: number) {
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== process.getuid?.()
  )
    throw Error('State input must be an owned, single-link regular file');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.uid !== process.getuid?.() ||
      after.ino !== before.ino ||
      after.dev !== before.dev
    )
      throw Error('State input changed while opening');
    if (after.size < 0 || after.size > maxBytes) throw Error('State input size is out of range');
    return { handle, size: after.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readSmallPrivateFile(file: string, maxBytes: number) {
  const { handle, size } = await openRegularPrivateFile(file, maxBytes);
  try {
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== size || after.size !== size)
      throw Error('State input changed while reading');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function checksumPrivateFile(file: string, maxBytes: number): Promise<Checksum> {
  const { handle, size } = await openRegularPrivateFile(file, maxBytes);
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(buffer.length, size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw Error('State input changed while hashing');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== size) throw Error('State input changed while hashing');
    return { sha256: hash.digest('hex'), size };
  } finally {
    await handle.close();
  }
}

async function copyVerifiedFile(source: string, destination: string, expected: Checksum) {
  const { handle: input, size } = await openRegularPrivateFile(source, expected.size);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < size) {
      const length = Math.min(buffer.length, size - offset);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (!bytesRead) throw Error('Backup file changed while restoring');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(chunk, written, bytesRead - written);
        if (!result.bytesWritten) throw Error('Could not write restored file');
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    if ((await input.stat()).size !== size) throw Error('Backup file changed while restoring');
    if (size !== expected.size || hash.digest('hex') !== expected.sha256)
      throw Error('Backup checksum mismatch while restoring');
    await output.chmod(0o600);
    await output.sync();
  } finally {
    await input.close();
    await output?.close();
  }
}

function checkDatabase(file: string, readOnly: boolean) {
  const db = new DatabaseSync(file, { readOnly });
  try {
    const row = db.prepare('PRAGMA quick_check').get() as { quick_check?: unknown } | undefined;
    if (row?.quick_check !== 'ok') throw Error('SQLite quick_check failed');
  } finally {
    db.close();
  }
}

function quoteSql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function copyToken(source: string, destination: string) {
  const bytes = await readSmallPrivateFile(source, 256);
  const token = bytes.toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid gateway token file');
  const target = await open(destination, 'wx', 0o600);
  try {
    await target.writeFile(bytes);
    await target.chmod(0o600);
    await target.sync();
  } finally {
    await target.close();
  }
  return bytes;
}

async function writeManifest(
  directory: string,
  files: Record<StateFile, Checksum>,
  manifest?: Manifest,
) {
  const body: Manifest = manifest ?? {
    format: 'agent-approval-gate-backup-v1',
    author: 'Ethan',
    createdAt: new Date().toISOString(),
    files,
  };
  const handle = await open(path.join(directory, manifestName), 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(body, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyManifest(directory: string) {
  await assertCompleteSource(directory);
  const bytes = await readSmallPrivateFile(path.join(directory, manifestName), 64 * 1024);
  const candidate = JSON.parse(bytes.toString('utf8')) as Partial<Manifest>;
  if (
    candidate.format !== 'agent-approval-gate-backup-v1' ||
    candidate.author !== 'Ethan' ||
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    !candidate.files ||
    Object.keys(candidate.files).sort().join(',') !== [...stateFiles].sort().join(',')
  )
    throw Error('Invalid backup manifest');
  const manifest = candidate as Manifest;
  const files = {} as Record<StateFile, Checksum>;
  for (const name of stateFiles) {
    const entry = manifest.files[name];
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    )
      throw Error('Invalid backup checksum entry');
    files[name] = await checksumPrivateFile(
      path.join(directory, name),
      name === 'gateway.sqlite' ? 1024 * 1024 * 1024 : 256,
    );
    if (files[name].size !== entry.size || files[name].sha256 !== entry.sha256)
      throw Error(`Backup checksum mismatch: ${name}`);
  }
  const human = (await readSmallPrivateFile(path.join(directory, 'human.token'), 256))
    .toString('utf8')
    .trim();
  const agent = (await readSmallPrivateFile(path.join(directory, 'agent.token'), 256))
    .toString('utf8')
    .trim();
  if (!/^[a-f0-9]{64}$/.test(human) || !/^[a-f0-9]{64}$/.test(agent) || human === agent)
    throw Error('Invalid gateway token files');
  checkDatabase(path.join(directory, 'gateway.sqlite'), true);
  return { files, manifest };
}

/** Create a consistent cold backup. The destination must not exist. */
export async function backupState(sourceDir: string, destinationDir: string) {
  await canonicalDirectory(sourceDir);
  await assertCompleteSource(sourceDir);
  await freshDestination(destinationDir);
  const lease = await acquireLease(path.join(sourceDir, 'server.lock'));
  let created = false;
  try {
    lease.assertHeld();
    await beginDestination(destinationDir);
    created = true;
    const sourceDb = path.join(sourceDir, 'gateway.sqlite');
    const dbInfo = await lstat(sourceDb);
    if (
      !dbInfo.isFile() ||
      dbInfo.isSymbolicLink() ||
      dbInfo.nlink !== 1 ||
      dbInfo.uid !== process.getuid?.()
    )
      throw Error('SQLite source must be an owned, single-link regular file');
    checkDatabase(sourceDb, true);
    const db = new DatabaseSync(sourceDb);
    try {
      db.exec(`VACUUM INTO ${quoteSql(path.join(destinationDir, 'gateway.sqlite'))}`);
    } finally {
      db.close();
    }
    await chmod(path.join(destinationDir, 'gateway.sqlite'), 0o600);
    await syncFile(path.join(destinationDir, 'gateway.sqlite'));
    checkDatabase(path.join(destinationDir, 'gateway.sqlite'), true);
    const databaseChecksum = await checksumPrivateFile(
      path.join(destinationDir, 'gateway.sqlite'),
      1024 * 1024 * 1024,
    );
    const humanToken = await copyToken(
      path.join(sourceDir, 'human.token'),
      path.join(destinationDir, 'human.token'),
    );
    const agentToken = await copyToken(
      path.join(sourceDir, 'agent.token'),
      path.join(destinationDir, 'agent.token'),
    );
    if (humanToken.toString('utf8').trim() === agentToken.toString('utf8').trim())
      throw Error('Gateway tokens must differ');
    const files = {
      'gateway.sqlite': databaseChecksum,
      'human.token': { sha256: digest(humanToken), size: humanToken.length },
      'agent.token': { sha256: digest(agentToken), size: agentToken.length },
    } satisfies Record<StateFile, Checksum>;
    lease.assertHeld();
    await writeManifest(destinationDir, files);
    await finishDestination(destinationDir);
  } catch (error) {
    if (created) await failClosed(destinationDir, error);
    throw error;
  } finally {
    await lease.release();
  }
  return { destinationDir };
}

/** Restore a verified cold backup into a destination that does not exist. */
export async function restoreState(sourceDir: string, destinationDir: string) {
  await canonicalDirectory(sourceDir);
  await assertCompleteSource(sourceDir);
  await freshDestination(destinationDir);
  const lease = await acquireLease(path.join(sourceDir, 'server.lock'));
  let created = false;
  try {
    lease.assertHeld();
    const { files, manifest } = await verifyManifest(sourceDir);
    await beginDestination(destinationDir);
    created = true;
    for (const name of stateFiles) {
      await copyVerifiedFile(
        path.join(sourceDir, name),
        path.join(destinationDir, name),
        files[name],
      );
    }
    checkDatabase(path.join(destinationDir, 'gateway.sqlite'), true);
    await writeManifest(destinationDir, files, manifest);
    await finishDestination(destinationDir);
  } catch (error) {
    if (created) await failClosed(destinationDir, error);
    throw error;
  } finally {
    await lease.release();
  }
  return { destinationDir };
}
