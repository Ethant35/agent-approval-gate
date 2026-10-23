import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { stringify } from 'yaml';
import type { Action, Policy } from '../src/contracts.js';

const repo = path.resolve('.');
const cli = path.join(repo, 'dist/cli.js');
let root: string;
let workspace: string;
let data: string;
let url: string;
let human: string;
let agent: string;
let server: ChildProcess;
let policy: Policy;

async function freePort() {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

async function startServer(first = true) {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  if (first) writeFileSync(path.join(root, 'policy.yaml'), stringify(policy));
  server = spawn(
    process.execPath,
    [
      cli,
      'serve',
      '--data',
      data,
      '--port',
      String(port),
      ...(first ? ['--policy', path.join(root, 'policy.yaml')] : []),
    ],
    { cwd: workspace, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  await expect
    .poll(async () => {
      if (server.exitCode !== null) return false;
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
  human = readFileSync(path.join(data, 'human.token'), 'utf8').trim();
  agent = readFileSync(path.join(data, 'agent.token'), 'utf8').trim();
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => server.once('exit', () => resolve()));
}

async function api(endpoint: string, body?: unknown, token = human) {
  return fetch(`${url}/v1${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-AAG-Intent': token === human ? 'human' : 'agent',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function connect(page: Page) {
  await page.goto(url);
  await page.getByLabel('Human token', { exact: true }).fill(human);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Action overview' })).toBeVisible();
}

function writeAction(id: string): Action {
  const file = path.join(workspace, 'result.txt');
  return {
    id,
    agentId: 'agent',
    sessionId: 'ui-readiness',
    category: 'filesystem',
    operation: 'write',
    parameters: { path: file, content: 'approved result' },
    resourceScope: file,
    timestamp: new Date().toISOString(),
    requestedPermissions: ['filesystem:write'],
    expectedResultFormat: 'json',
  };
}

test.beforeEach(async () => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'aag-ui-')));
  workspace = path.join(root, 'workspace');
  data = path.join(root, 'data');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'result.txt'), 'unchanged');
  policy = {
    version: 1,
    default: 'approval',
    workspace,
    filesystem: { allow: [workspace], deny: [] },
    commands: [],
    network: { allow: [], deny: [], allowPrivate: false },
    limits: { maxDurationMs: 10000, approvalTtlMs: 60000, subagentConcurrency: 1 },
    budgets: [{ sessionId: 'ui-readiness', currency: 'USD', maximum: 100 }],
    rules: [],
  };
  await startServer();
});

test.afterEach(async () => {
  await stopServer();
  rmSync(root, { recursive: true, force: true });
});

test('fresh users can skip, reconnect later, and replay the setup guide', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Connect to gateway' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'First-time setup' })).toBeVisible();
  await expect(page.getByText(/Run aag serve in a trusted terminal/)).toBeVisible();
  await expect(page.getByText(/Read human.token from the private data directory/)).toBeVisible();

  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('region', { name: 'First-time setup' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'First-time setup' })).toBeHidden();

  await page.getByRole('button', { name: 'Setup guide' }).click();
  await expect(page.getByRole('region', { name: 'First-time setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Close setup guide' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'First-time setup' })).toBeHidden();
});

test('bad credentials show a recoverable error and never persist the token', async ({ page }) => {
  await page.goto(url);
  await page.getByLabel('Human token', { exact: true }).fill('not-a-valid-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/token was not accepted/i);
  await expect(page.getByRole('heading', { name: 'Connect to gateway' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('aag-human-token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('aag-human-token'))).toBeNull();

  await page.getByLabel('Human token', { exact: true }).fill(human);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Action overview' })).toBeVisible();
  expect(
    await page.evaluate(
      (expected) => sessionStorage.getItem('aag-human-token') === expected,
      human,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('aag-human-token'))).toBeNull();
});

test('connected dashboard is usable at narrow width and 200 percent zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await connect(page);
  await expect(page.getByText('No actions yet')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit history' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  // A 160 CSS-pixel viewport is the layout width available at 200% browser zoom
  // on a 320 CSS-pixel display. Viewport emulation is used; browser chrome zoom is not.
  await page.setViewportSize({ width: 160, height: 400 });
  await expect(page.getByRole('heading', { name: 'Action overview' })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('*')]
      .map((element) => ({
        name: `${element.tagName.toLowerCase()}.${typeof element.className === 'string' ? element.className : ''}`,
        right: Math.round(element.getBoundingClientRect().right),
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }))
      .filter((item) => item.right > innerWidth + 1)
      .slice(0, 8),
  }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(160);

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('approval dialog contains keyboard focus, confirms exact action, and restores trigger focus', async ({
  page,
}) => {
  const action = writeAction('ui-approval');
  const submitted = await api('/requests', action, agent);
  expect(submitted.status).toBe(201);
  await connect(page);

  const trigger = page.getByRole('button', { name: 'Approve', exact: true });
  const card = page.locator('.request-card').filter({ hasText: 'ui-approval' });
  const parameters = card.getByText('Full parameters and scope', { exact: true });
  await parameters.click();
  await expect(card.locator('pre')).toContainText('approved result');
  await expect(card).toContainText(action.parameters.path!);
  const delayedDetail = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  };
  await page.route(`${url}/v1/requests/ui-approval`, delayedDetail);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Confirm approval' });
  await expect(card.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  await expect(dialog).toBeVisible();
  await page.unroute(`${url}/v1/requests/ui-approval`, delayedDetail);
  await expect(page.getByRole('button', { name: 'Go back' })).toBeFocused();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toBeVisible();
  }
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator(':focus')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(readFileSync(action.parameters.path!, 'utf8')).toBe('unchanged');

  await trigger.click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(
    page
      .locator('.request-card')
      .filter({ hasText: 'ui-approval' })
      .getByText('COMPLETED', { exact: true }),
  ).toBeVisible();
  expect(readFileSync(action.parameters.path!, 'utf8')).toBe('approved result');
});

test('human approval creates a new file only after confirmation', async ({ page }) => {
  const action = writeAction('ui-new-file');
  const absentPath = path.join(workspace, 'new-result.txt');
  action.parameters.path = absentPath;
  action.resourceScope = absentPath;
  const submitted = await api('/requests', action, agent);
  expect(submitted.status).toBe(201);
  await connect(page);
  expect(existsSync(absentPath)).toBe(false);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.locator('.request-card').filter({ hasText: 'ui-new-file' })).toContainText(
    'COMPLETED',
  );
  expect(readFileSync(absentPath, 'utf8')).toBe('approved result');
});

test('audit summary rows load the full record only when opened', async ({ page }) => {
  const submitted = await api('/requests', writeAction('ui-audit-details'), agent);
  expect(submitted.status).toBe(201);
  await connect(page);

  const auditRow = page.getByRole('row').filter({ hasText: 'ui-audit-details' }).first();
  const fullRecord = auditRow.locator('xpath=following-sibling::tr[1]');
  await fullRecord.getByText('View full audit record', { exact: true }).click();
  await expect(fullRecord.locator('pre')).toContainText('ui-audit-details');
});

test('operator screens pass axe checks in light, dark, and approval states', async ({ page }) => {
  await connect(page);
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  };

  await check();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await check();

  const submitted = await api('/requests', writeAction('ui-axe'), agent);
  expect(submitted.status).toBe(201);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm approval' })).toBeVisible();
  await check();
});
