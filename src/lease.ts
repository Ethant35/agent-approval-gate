import { spawn } from 'node:child_process';
import { helper } from './executor.js';

// A pipe-owned native flock survives normal operation and releases on parent death.
// The inode is retained: unlinking a lock permits two processes to lock different inodes.
export async function acquireLease(file: string) {
  const child = spawn(helper, ['lock', file, String(process.pid)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin' },
  });
  let alive = true;
  let releasing = false;
  let lost: (() => void) | undefined;
  let error = '';
  child.stderr.on('data', (b: Buffer) => {
    error = (error + b.toString()).slice(-4096);
  });
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => {
      alive = false;
      if (!releasing) lost?.();
      resolve();
    }),
  );
  child.stdin.on('error', () => {
    /* The close event handles a lost lease. */
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('State lock acquisition timed out')), 5000);
      let output = '';
      child.stdout.on('data', (b: Buffer) => {
        output += b.toString();
        if (output.includes('locked\n')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('close', () => {
        clearTimeout(timer);
        reject(Error(error.trim() || 'State lock unavailable'));
      });
    });
  } catch (e) {
    releasing = true;
    child.kill('SIGKILL');
    await exited;
    throw e;
  }
  return {
    assertHeld() {
      if (!alive) throw Error('State lock lost; restart required');
    },
    onLost(fn: () => void) {
      lost = fn;
      if (!alive && !releasing) fn();
    },
    async release() {
      releasing = true;
      child.stdin.end();
      await exited;
    },
  };
}
