// Browser automation of the desktop bootstrap contract; this does not exercise WKWebView or AppKit.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Action } from '../src/contracts.js';

const repo = path.resolve('.');
const desktopCli = path.join(repo, 'dist/desktop.js');
const fixtureBaseline = 'This file has not been approved yet.\n';
const tutorialContent = 'You approved this change.\n';
type DesktopReady = {
  type: 'ready';
  url: string;
  operatorToken: string;
  workspace: string;
  dataDir: string;
  mode: 'workspace' | 'tutorial';
  tutorialRequestId?: string;
  version: string;
};
type DesktopBootstrap = Omit<DesktopReady, 'type' | 'url' | 'operatorToken' | 'dataDir'>;

let root: string;
let workspace: string;
let desktopProcess: ChildProcess | undefined;
let desktop: DesktopReady;
let stderr = '';

async function startDesktop(mode: 'workspace' | 'tutorial') {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'aag-desktop-data-')));
  const args = [desktopCli, '--root', root];
  if (mode === 'tutorial') {
    args.push('--tutorial');
  } else {
    workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'aag-desktop-workspace-')));
    args.push('--workspace', workspace);
  }
  desktopProcess = spawn(process.execPath, args, {
    cwd: mode === 'workspace' ? workspace : repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = await new Promise<DesktopReady>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error('Desktop launcher did not become ready.')),
      20000,
    );
    desktopProcess!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      for (const line of output.split(/\r?\n/)) {
        try {
          const value = JSON.parse(line) as DesktopReady;
          if (value.type === 'ready') {
            clearTimeout(timeout);
            resolve(value);
            return;
          }
        } catch {
          // The ready object is one JSON line; partial output is kept until its newline arrives.
        }
      }
    });
    desktopProcess!.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    desktopProcess!.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    desktopProcess!.once('exit', (code) => {
      clearTimeout(timeout);
      reject(Error(`Desktop launcher exited before ready (${code}): ${stderr}`));
    });
  });
  desktop = ready;
  workspace = ready.workspace;
}

async function stopDesktop() {
  const child = desktopProcess;
  desktopProcess = undefined;
  if (!child || child.exitCode !== null) return;
  child.stdin?.end();
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function installDesktopBootstrap(page: Page) {
  const { operatorToken, mode, workspace: selectedWorkspace, tutorialRequestId, version } = desktop;
  const bootstrap: DesktopBootstrap = {
    mode,
    workspace: selectedWorkspace,
    ...(tutorialRequestId ? { tutorialRequestId } : {}),
    version,
  };
  await page.addInitScript(
    ({ token, context }) => {
      sessionStorage.setItem('aag-human-token', token);
      (window as Window & { __AAG_DESKTOP__?: DesktopBootstrap }).__AAG_DESKTOP__ = context;
    },
    { token: operatorToken, context: bootstrap },
  );
}

async function connectDesktop(page: Page) {
  await installDesktopBootstrap(page);
  await page.goto(desktop.url);
  await expect(page.getByRole('heading', { name: 'Action overview' })).toBeVisible();
  await expect(page.getByLabel('Human token', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Setup guide' })).toHaveCount(0);
}

async function submitAction(action: Action) {
  const agentToken = readFileSync(path.join(desktop.dataDir, 'agent.token'), 'utf8').trim();
  return fetch(`${desktop.url}/v1/requests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
      'X-AAG-Intent': 'agent',
    },
    body: JSON.stringify(action),
  });
}

function baseAction(
  id: string,
): Pick<
  Action,
  'id' | 'agentId' | 'sessionId' | 'timestamp' | 'requestedPermissions' | 'expectedResultFormat'
> {
  return {
    id,
    agentId: 'agent',
    sessionId: 'desktop-ui',
    timestamp: new Date().toISOString(),
    requestedPermissions: [],
    expectedResultFormat: 'json',
  };
}

test.afterEach(async () => {
  await stopDesktop();
  if (root) rmSync(root, { recursive: true, force: true });
  if (workspace && !workspace.startsWith(path.join(root, 'tutorials') + path.sep))
    rmSync(workspace, { recursive: true, force: true });
});

test('desktop tutorial approval executes its isolated real write and shows the result', async ({
  page,
}) => {
  await startDesktop('tutorial');
  const target = path.join(workspace, 'approval-example.txt');
  expect(readFileSync(target, 'utf8')).toBe(fixtureBaseline);
  expect(desktop.tutorialRequestId).toBe('tutorial-write');
  const apiRequests: { method: string; authorization?: string; intent?: string }[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v1/')) {
      void request.allHeaders().then((headers) =>
        apiRequests.push({
          method: request.method(),
          authorization: headers.authorization,
          intent: headers['x-aag-intent'],
        }),
      );
    }
  });
  await connectDesktop(page);

  const walkthrough = page.getByRole('region', { name: 'Safe approval walkthrough' });
  await expect(walkthrough).toContainText('tutorial fixture baseline');
  await expect(walkthrough.locator('pre').first()).toHaveText(fixtureBaseline);
  await expect(walkthrough).toContainText(target);
  await expect(walkthrough).toContainText(tutorialContent);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();

  const checkA11y = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
  };
  await checkA11y();
  const reviewButton = page.getByRole('button', { name: 'Review approval', exact: true });
  const bounds = await reviewButton.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: test.info().outputPath('tutorial-review.png') });
  await page.getByRole('button', { name: 'Review approval', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm approval' });
  await expect(dialog).toContainText(target);
  await expect(dialog).toContainText(tutorialContent);
  await checkA11y();
  await page.getByRole('button', { name: 'Confirm approval' }).click();

  await expect(walkthrough).toContainText('The gateway reports that the write completed.');
  await expect(walkthrough).toContainText('bytesWritten');
  expect(readFileSync(target, 'utf8')).toBe(tutorialContent);
  await expect(walkthrough).toContainText('Try Tutorial');
  await expect.poll(() => apiRequests.some((request) => request.method === 'POST')).toBe(true);
  expect(apiRequests.filter((request) => request.method === 'POST')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        authorization: `Bearer ${desktop.operatorToken}`,
        intent: 'human',
      }),
    ]),
  );
});

test('desktop tutorial denial preserves the seeded file and explains the result', async ({
  page,
}) => {
  await startDesktop('tutorial');
  const target = path.join(workspace, 'approval-example.txt');
  await connectDesktop(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm rejection' });
  await expect(dialog).toContainText(target);
  await page.getByRole('button', { name: 'Confirm rejection' }).click();

  const walkthrough = page.getByRole('region', { name: 'Safe approval walkthrough' });
  await expect(walkthrough).toContainText(
    'The request was denied. The gateway did not execute this write.',
  );
  expect(readFileSync(target, 'utf8')).toBe(fixtureBaseline);
});

test('desktop workspace mode shows exact command and HTTP request fields', async ({ page }) => {
  await startDesktop('workspace');
  const target = path.join(workspace, 'proposed.txt');
  const actions: Action[] = [
    {
      ...baseAction('desktop-file-preview'),
      category: 'filesystem',
      operation: 'write',
      parameters: { path: target, content: 'first line\nsecond line\n' },
      resourceScope: target,
    },
    {
      ...baseAction('desktop-command-preview'),
      category: 'shell',
      operation: 'run',
      parameters: { executable: '/usr/bin/printf', args: ['%s %s', 'two words', '; safe text'] },
      resourceScope: workspace,
    },
    {
      ...baseAction('desktop-http-preview'),
      category: 'http',
      operation: 'request',
      parameters: {
        method: 'POST',
        url: 'https://example.com/api',
        body: '{"note":"visible request body"}',
      },
      resourceScope: 'https://example.com',
    },
  ];
  for (const action of actions) {
    const response = await submitAction(action);
    expect([201, 202]).toContain(response.status);
  }
  await connectDesktop(page);
  await expect(page.getByText(`Workspace: ${workspace}`)).toBeVisible();

  const fileCard = page.locator('.request-card').filter({ hasText: 'desktop-file-preview' });
  await fileCard.getByText('Full parameters and scope', { exact: true }).click();
  await expect(fileCard).toContainText(target);
  await expect(fileCard).toContainText('first line');

  const commandCard = page.locator('.request-card').filter({ hasText: 'desktop-command-preview' });
  await commandCard.getByText('Full parameters and scope', { exact: true }).click();
  await expect(commandCard).toContainText('/usr/bin/printf');
  await expect(commandCard).toContainText('Arguments (JSON array)');
  await expect(commandCard.locator('.action-preview pre')).toContainText('two words');
  await expect(commandCard.locator('.action-preview pre')).toContainText('; safe text');
  expect(await commandCard.locator('.action-preview pre').first().innerText()).toContain('[');

  const httpCard = page.locator('.request-card').filter({ hasText: 'desktop-http-preview' });
  await httpCard.getByText('Full parameters and scope', { exact: true }).click();
  await expect(httpCard).toContainText('POST');
  await expect(httpCard).toContainText('https://example.com/api');
  await expect(httpCard).toContainText('visible request body');
  expect(existsSync(target)).toBe(false);
});

test('desktop disconnect gives launcher recovery steps without exposing manual token setup', async ({
  page,
}) => {
  await startDesktop('workspace');
  await connectDesktop(page);
  await stopDesktop();
  await expect(page.getByRole('heading', { name: 'Reconnect to gateway' })).toBeVisible({
    timeout: 12000,
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/use the desktop toolbar to reconnect/i)).toBeVisible();
  await expect(page.getByLabel('Human token', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/fetch|connect|network/i);
  await expect(page.getByLabel('Human token', { exact: true })).toHaveCount(0);
});

test('basic policy editing preserves advanced fields and detects concurrent edits', async ({
  page,
}) => {
  await startDesktop('workspace');
  const policyApi = async (body?: unknown) => {
    const response = await fetch(desktop.url + '/v1/policy', {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${desktop.operatorToken}`,
        'content-type': 'application/json',
        'x-aag-intent': 'human',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const original = await policyApi();
  original.policy.rules = [{ id: 'blocked-agent', agentId: 'blocked', effect: 'deny' }];
  await policyApi({ yaml: JSON.stringify(original.policy) });
  await connectDesktop(page);
  await page.getByRole('button', { name: 'Edit basic policy' }).click();
  await expect(page.getByLabel('Default decision', { exact: true })).toBeFocused();
  await page.getByLabel('Approval expires after (seconds)').fill('120');
  await page.getByLabel('Execution timeout (seconds)').fill('16.1');
  await page.getByLabel('Blocked paths').fill(path.join(workspace, 'private'));
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(
    page.getByText('Policy saved. Previous approvals require resubmission.'),
  ).toBeVisible();
  const saved = await policyApi();
  expect(saved.policy.rules).toEqual(original.policy.rules);
  expect(saved.policy.commands).toEqual([]);
  expect(saved.policy.network).toEqual(original.policy.network);
  expect(saved.policy.budgets).toEqual(original.policy.budgets);
  expect(saved.policy.filesystem.allow).toEqual([workspace]);
  expect(saved.policy.filesystem.deny).toEqual([path.join(workspace, 'private')]);
  expect(saved.policy.limits.approvalTtlMs).toBe(120000);
  expect(saved.policy.limits.maxDurationMs).toBe(16100);

  await page.getByRole('button', { name: 'Edit basic policy' }).click();
  await page.getByLabel('Execution timeout (seconds)').fill('5');
  await policyApi({ yaml: JSON.stringify({ ...saved.policy, default: 'deny' }) });
  await expect(
    page.getByText('Policy changed elsewhere. Reload the current policy before saving.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save policy' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload current policy' }).click();
  await expect(page.getByLabel('Default decision', { exact: true })).toHaveValue('deny');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await policyApi()).policy.limits.maxDurationMs).toBe(16100);
});

test('connection UI distinguishes launch from handshake and offers retry and disconnect', async ({
  page,
}) => {
  // UI contract fixture only. The core suite drives the real MCP transport separately.
  await startDesktop('workspace');
  let status = 'idle';
  let starts = 0;
  let rejectStart = false;
  let pollsAfterFailure = 0;
  await page.route('**/v1/desktop/connection**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/start')) {
      if (rejectStart) {
        await route.fulfill({ status: 503, json: { error: 'Terminal launch failed. Try again.' } });
        return;
      }
      starts++;
      status = 'starting';
    }
    if (rejectStart && route.request().method() === 'GET') pollsAfterFailure++;
    if (url.pathname.endsWith('/disconnect')) status = 'disconnected';
    await route.fulfill({ json: { status, agentId: 'guided-codex', sessionId: 'guided-session' } });
  });
  await connectDesktop(page);
  const region = page.getByRole('region', { name: 'Codex', exact: true });
  await expect(region).toContainText('Not connected');
  await region.getByRole('button', { name: 'Start Codex' }).click();
  await expect(region).toContainText('Waiting for Codex');
  expect(starts).toBe(1);
  status = 'connected';
  await expect(region.getByRole('status')).toHaveText('Connected');
  await expect(region).toContainText('Other Codex tools are outside this boundary.');
  status = 'disconnecting';
  await expect(region.getByRole('status')).toHaveText('Disconnecting');
  await expect(region.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  status = 'connected';
  await expect(region.getByRole('status')).toHaveText('Connected');
  await region.getByRole('button', { name: 'Disconnect Codex' }).click();
  await expect(region).toContainText('Disconnected');
  await expect(region.getByRole('button', { name: 'Start Codex' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('workspace-connection-narrow.png'),
    fullPage: true,
  });
  rejectStart = true;
  await region.getByRole('button', { name: 'Start Codex' }).click();
  await expect(region.getByRole('alert')).toContainText('Terminal launch failed');
  await expect.poll(() => pollsAfterFailure).toBeGreaterThanOrEqual(2);
  await expect(region.getByRole('alert')).toContainText('Terminal launch failed');
  rejectStart = false;
  await region.getByRole('button', { name: 'Start Codex' }).click();
  await expect(region.getByRole('alert')).toHaveCount(0);
});

test('policy rehearsal previews saved requests and samples without saving or executing', async ({
  page,
}) => {
  await startDesktop('workspace');
  const target = path.join(workspace, 'rehearsal.txt');
  const response = await submitAction({
    ...baseAction('rehearse-existing'),
    category: 'filesystem',
    operation: 'write',
    parameters: { path: target, content: 'must wait for approval' },
    resourceScope: target,
  });
  expect(response.status).toBe(201);
  const headers = {
    authorization: `Bearer ${desktop.operatorToken}`,
    'content-type': 'application/json',
    'x-aag-intent': 'human',
  };
  const policyBefore = await (await fetch(desktop.url + '/v1/policy', { headers })).json();
  await connectDesktop(page);
  await page.getByRole('button', { name: 'Edit basic policy' }).click();
  await page.getByLabel('Default decision', { exact: true }).selectOption('deny');
  await page.getByLabel('Requests to preview').selectOption('recent');
  await page.getByRole('button', { name: 'Preview decisions' }).click();
  const preview = page.getByRole('region', { name: 'Policy rehearsal results' });
  await expect(preview).toContainText('rehearse-existing');
  await expect(preview).toContainText(
    'Current: approval (Default policy). Draft: deny (Default policy).',
  );
  expect(existsSync(target)).toBe(false);
  expect(await (await fetch(desktop.url + '/v1/policy', { headers })).json()).toEqual(policyBefore);
  const pending = await (
    await fetch(desktop.url + '/v1/requests/rehearse-existing', { headers })
  ).json();
  expect(pending.state).toBe('PENDING_APPROVAL');
  expect(pending.approvalToken).toMatch(/^[a-f0-9]{64}$/);
  await page.getByLabel('Default decision', { exact: true }).selectOption('approval');
  await expect(preview).toHaveCount(0);
  await page.getByLabel('Requests to preview').selectOption('sample');
  await page.getByLabel('Sample absolute path').fill(target);
  await page.getByLabel('Blocked paths').fill(target);
  await page.getByRole('button', { name: 'Preview decisions' }).click();
  await expect(preview).toContainText('Draft: deny (Filesystem scope denied)');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('policy-rehearsal-narrow.png') });
  // An external policy save invalidates the displayed preview and requires an explicit reload.
  await fetch(desktop.url + '/v1/policy', {
    method: 'POST',
    headers,
    body: JSON.stringify({ yaml: JSON.stringify({ ...policyBefore.policy, default: 'deny' }) }),
  });
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview decisions' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit basic policy' })).toBeFocused();
  expect(existsSync(target)).toBe(false);
});
