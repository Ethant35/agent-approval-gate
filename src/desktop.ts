// Author: Ethan. Private child-process entry for the native operator launcher.
// This is not an HTTP pairing endpoint. The parent owns stdin/stdout pipes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { startServer } from './server.js';
import { acquireLease } from './lease.js';
import { backupState } from './maintenance.js';
import { requireRuntime } from './runtime.js';
import { within } from './policy.js';

const version = (
  JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
type Profile = { format: 1; author: 'Ethan'; workspace: string; lastVersion: string };
function privateDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(directory);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid!() ||
    fs.realpathSync.native(directory) !== directory
  )
    throw Error('Use an owned folder with a canonical path for app data.');
  fs.chmodSync(directory, 0o700);
}
function readProfile(file: string): Profile | undefined {
  const s = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!s) return undefined;
  if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid!() || s.size > 16384)
    throw Error('The saved workspace profile is not a private regular file.');
  const p = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile;
  if (
    p.format !== 1 ||
    p.author !== 'Ethan' ||
    typeof p.workspace !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(p.lastVersion)
  )
    throw Error(
      'The saved workspace profile is invalid. Keep the original data and recover from a backup.',
    );
  return p;
}
function saveProfile(file: string, profile: Profile) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(profile) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
function compareVersions(a: string, b: string) {
  const aa = a.split('.').map(Number),
    bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i]! - bb[i]!;
  return 0;
}

async function main() {
  requireRuntime();
  // This checks transport shape, not caller identity. Same-user arbitrary local
  // execution is outside the mediated-agent boundary, as documented in SECURITY.md.
  if (process.stdin.isTTY || process.stdout.isTTY)
    throw Error('Start the desktop operator from Agent Approval Gate.app.');
  const args = process.argv.slice(2);
  if (
    args[0] !== '--root' ||
    !args[1] ||
    !(
      (args.length === 3 && args[2] === '--tutorial') ||
      (args.length === 4 && args[2] === '--workspace' && args[3])
    )
  )
    throw Error('Expected --root DIR and --workspace DIR or --tutorial.');
  const root = path.resolve(args[1]);
  privateDirectory(root);
  const tutorial = args[2] === '--tutorial';
  let workspace: string, profileDir: string;
  if (tutorial) {
    const tutorialRoot = path.join(root, 'tutorials');
    privateDirectory(tutorialRoot);
    profileDir = fs.mkdtempSync(path.join(tutorialRoot, 'session-'));
    workspace = path.join(profileDir, 'workspace');
    privateDirectory(workspace);
    fs.writeFileSync(
      path.join(workspace, 'approval-example.txt'),
      'This file has not been approved yet.\n',
      { flag: 'wx', mode: 0o600 },
    );
  } else {
    workspace = fs.realpathSync.native(path.resolve(args[3]!));
    if (!fs.statSync(workspace).isDirectory()) throw Error('Choose a workspace folder.');
    if (within(workspace, root) || within(root, workspace))
      throw Error(
        'Choose a project folder separate from the app data. Your home folder is too broad.',
      );
    const profiles = path.join(root, 'workspaces');
    privateDirectory(profiles);
    profileDir = path.join(profiles, createHash('sha256').update(workspace).digest('hex'));
    privateDirectory(profileDir);
  }
  const lease = await acquireLease(path.join(profileDir, 'launcher.lock'));
  const dataDir = path.join(profileDir, 'state');
  const profileFile = path.join(profileDir, 'profile.json');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let parentGone = false;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await server?.close();
      await lease.release();
    })());
  process.stdin.on('end', () => {
    parentGone = true;
    if (server) void close().then(() => process.exit(0));
  });
  process.stdin.resume();
  try {
    const profile = readProfile(profileFile);
    if (profile && profile.workspace !== workspace)
      throw Error('Saved workspace identity does not match this folder.');
    let backupDir: string | undefined;
    if (profile && compareVersions(profile.lastVersion, version) > 0)
      throw Error(
        'This workspace was used by a newer app. Use that version, or restore a pre-update backup into fresh state before downgrading.',
      );
    if (
      profile &&
      profile.lastVersion !== version &&
      fs.existsSync(path.join(dataDir, 'gateway.sqlite'))
    ) {
      const backups = path.join(profileDir, 'backups');
      privateDirectory(backups);
      backupDir = path.join(
        backups,
        `${new Date().toISOString().replaceAll(':', '-')}-from-${profile.lastVersion}`,
      );
      await backupState(dataDir, backupDir);
    }
    process.chdir(workspace);
    const operatorToken = randomBytes(32).toString('hex');
    server = await startServer({ dataDir, port: 0, startupLog: false, operatorToken });
    if (parentGone) {
      await close();
      return;
    }
    const agentToken = fs.readFileSync(path.join(dataDir, 'agent.token'), 'utf8').trim();
    const policyResponse = await fetch(server.url + '/v1/policy', {
      headers: { authorization: 'Bearer ' + operatorToken },
    });
    if (
      !policyResponse.ok ||
      ((await policyResponse.json()) as { policy: { workspace: string } }).policy.workspace !==
        workspace
    )
      throw Error(
        'Saved policy points to another workspace. Keep the state and inspect the policy before continuing.',
      );
    if (tutorial) {
      const target = path.join(workspace, 'approval-example.txt');
      const response = await fetch(server.url + '/v1/requests', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + agentToken,
          'content-type': 'application/json',
          'x-aag-intent': 'agent',
        },
        body: JSON.stringify({
          id: 'tutorial-write',
          agentId: 'agent',
          sessionId: 'tutorial',
          category: 'filesystem',
          operation: 'write',
          parameters: { path: target, content: 'You approved this change.\n' },
          resourceScope: target,
          timestamp: new Date().toISOString(),
          requestedPermissions: ['filesystem:write'],
          expectedResultFormat: 'json',
        }),
      });
      if (
        !response.ok ||
        ((await response.json()) as { state: string }).state !== 'PENDING_APPROVAL'
      )
        throw Error(
          'The tutorial could not create its pending approval. No automatic retry was made.',
        );
    }
    saveProfile(profileFile, { format: 1, author: 'Ethan', workspace, lastVersion: version });
    lease.assertHeld();
    lease.onLost(() => {
      void close().then(() => process.exit(1));
    });
    // This process-lifetime capability is sent only through the inherited stdout pipe.
    process.stdout.write(
      JSON.stringify({
        type: 'ready',
        url: server.url,
        operatorToken,
        workspace,
        dataDir,
        mode: tutorial ? 'tutorial' : 'workspace',
        ...(tutorial ? { tutorialRequestId: 'tutorial-write' } : {}),
        ...(backupDir ? { backupDir } : {}),
        version,
      }) + '\n',
    );
  } catch (error) {
    await close();
    throw error;
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof Error ? error.message : 'The desktop gateway could not start.') + '\n',
  );
  process.exitCode = 1;
  process.stdin.destroy();
});
