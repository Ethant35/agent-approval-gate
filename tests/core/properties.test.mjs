// Author: Ethan. Deterministic generated invariants for budgets and filesystem policy.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../dist/store.js';
import { evaluate, parsePolicy } from '../../dist/policy.js';

const generatedRoot = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), 'aag-properties-')),
);
const workspace = path.join(generatedRoot, 'workspace');
fs.mkdirSync(workspace);

after(() => fs.rmSync(generatedRoot, { recursive: true, force: true }));

function policy(maximum = 100) {
  return {
    version: 1,
    default: 'approval',
    workspace,
    filesystem: { allow: [workspace], deny: [] },
    commands: [],
    network: { allow: [], deny: [], allowPrivate: false },
    limits: { maxDurationMs: 1000, approvalTtlMs: 60000, subagentConcurrency: 1 },
    budgets: [{ sessionId: 'session', currency: 'USD', maximum }],
    rules: [],
  };
}

function request(id, amount, target = path.join(workspace, 'target')) {
  return {
    id,
    agentId: 'agent',
    sessionId: 'session',
    category: 'filesystem',
    operation: 'write',
    parameters: { path: target, content: 'generated payload' },
    resourceScope: target,
    timestamp: new Date().toISOString(),
    requestedPermissions: ['filesystem:write'],
    maxCost: { currency: 'USD', amount },
    expectedResultFormat: 'json',
  };
}

function safeSegmentArb() {
  const alphabet = [...'abcXYZ012_-'];
  return fc
    .array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 8 })
    .map((chars) => chars.join(''));
}

function pathVariant(root, segments, mode = 'dot') {
  const middle = segments.join('/');
  if (mode === 'double-separator') return `${root}//${middle}`;
  if (mode === 'dot') return `${root}/${segments[0]}/./${segments.slice(1).join('/')}`;
  throw new Error(`Unsupported path variant: ${mode}`);
}

test('generated reservation, release, and settlement sequences match an independent ledger', () => {
  const reserveArb = fc
    .integer({ min: 1, max: 100 })
    .map((amount) => ({ kind: 'reserve', amount }));
  const releaseArb = fc.nat().map((choice) => ({ kind: 'release', choice }));
  const settleArb = fc
    .record({ choice: fc.nat(), actual: fc.integer({ min: 0, max: 150 }) })
    .map(({ choice, actual }) => ({ kind: 'settle', choice, actual }));
  const operationArb = fc.oneof(
    reserveArb,
    reserveArb,
    reserveArb,
    reserveArb,
    reserveArb,
    releaseArb,
    releaseArb,
    settleArb,
    settleArb,
  );

  fc.assert(
    fc.property(fc.array(operationArb, { minLength: 1, maxLength: 35 }), (operations) => {
      const store = new Store(':memory:');
      const configuredPolicy = policy();
      const model = {
        maximum: 100,
        reserved: 0,
        settled: 0,
        reservations: new Map(),
        requests: new Map(),
      };
      try {
        store.apply(configuredPolicy);
        for (let index = 0; index < operations.length; index++) {
          const operation = operations[index];
          if (operation.kind === 'reserve') {
            const id = `pbt-${index}`;
            const record = store.insert(request(id, operation.amount), 1, 60000, 'agent');
            const fits = model.maximum - model.reserved - model.settled >= operation.amount;
            if (fits) {
              store.transaction(() => store.reserve(record, configuredPolicy));
              model.reserved += operation.amount;
              model.reservations.set(id, {
                requestId: id,
                amount: operation.amount,
                status: 'reserved',
              });
              model.requests.set(id, record);
            } else {
              assert.throws(
                () => store.transaction(() => store.reserve(record, configuredPolicy)),
                /Budget exhausted/,
              );
            }
          } else {
            const available = [...model.reservations.values()].filter(
              (reservation) => reservation.status === 'reserved',
            );
            if (available.length) {
              const reservation = available[operation.choice % available.length];
              const record = model.requests.get(reservation.requestId);
              if (operation.kind === 'release') {
                store.transaction(() => store.release(record));
                model.reserved -= reservation.amount;
                reservation.status = 'released';
              } else {
                store.transition(record, 'COMPLETED', 'Generated execution completed');
                store.settle(
                  reservation.requestId,
                  operation.actual,
                  'generated authoritative usage',
                );
                model.reserved -= reservation.amount;
                model.settled += operation.actual;
                reservation.status = 'settled';
                reservation.actual = operation.actual;
              }
            }
          }

          const actualBudget = store.budgets()[0];
          assert.equal(actualBudget.maximum, model.maximum);
          assert.equal(actualBudget.reserved, model.reserved);
          assert.equal(actualBudget.settled, model.settled);
          assert.equal(actualBudget.remaining, model.maximum - model.reserved - model.settled);

          const actualReservations = store.db
            .prepare('SELECT requestId,amount,status,actual FROM reservations ORDER BY requestId')
            .all()
            .map((row) => ({ ...row }));
          const expectedReservations = [...model.reservations.values()]
            .sort((a, b) => a.requestId.localeCompare(b.requestId))
            .map(({ requestId, amount, status, actual }) => ({
              requestId,
              amount,
              status,
              actual: actual ?? null,
            }));
          assert.deepEqual(actualReservations, expectedReservations);
        }
      } finally {
        store.close();
      }
    }),
    { seed: 0x5eedc0de, numRuns: 120, endOnFailure: true },
  );
});

test('generated over-budget transactions roll back earlier reservations completely', () => {
  const overspendArb = fc
    .integer({ min: 1, max: 99 })
    .chain((first) => fc.integer({ min: 101 - first, max: 100 }).map((second) => [first, second]));
  fc.assert(
    fc.property(overspendArb, ([first, second]) => {
      const store = new Store(':memory:');
      const configuredPolicy = policy();
      try {
        store.apply(configuredPolicy);
        const firstRequest = store.insert(request('rollback-first', first), 1, 60000, 'agent');
        const secondRequest = store.insert(request('rollback-second', second), 1, 60000, 'agent');
        assert.ok(first <= 100 && second <= 100 && first + second > 100);

        assert.throws(
          () =>
            store.transaction(() => {
              store.reserve(firstRequest, configuredPolicy);
              store.reserve(secondRequest, configuredPolicy);
            }),
          /Budget exhausted/,
        );

        assert.deepEqual(
          { ...store.budgets()[0] },
          {
            sessionId: 'session',
            currency: 'USD',
            maximum: 100,
            reserved: 0,
            settled: 0,
            remaining: 100,
          },
        );
        assert.deepEqual(store.db.prepare('SELECT * FROM reservations').all(), []);
        assert.ok(store.get('rollback-first'));
        assert.ok(store.get('rollback-second'));
      } finally {
        store.close();
      }
    }),
    { seed: 0x70ba11, numRuns: 80, endOnFailure: true },
  );
});

test('generated filesystem path spellings canonicalize idempotently in parsed policies', () => {
  const segmentsArb = fc.array(safeSegmentArb(), { minLength: 1, maxLength: 3 });
  fc.assert(
    fc.property(segmentsArb, (segments) => {
      const normalized = path.join(workspace, ...segments, 'item.txt');
      const variant = pathVariant(workspace, [...segments, 'item.txt']);
      const input = policy();
      input.filesystem.allow = [variant];
      input.filesystem.deny = [
        pathVariant(workspace, [...segments, 'blocked.txt'], 'double-separator'),
      ];

      const parsed = parsePolicy(JSON.stringify(input));
      assert.equal(parsed.filesystem.allow[0], normalized);
      assert.equal(parsed.filesystem.deny[0], path.join(workspace, ...segments, 'blocked.txt'));
      assert.deepEqual(parsePolicy(JSON.stringify(parsed)), parsed);
    }),
    { seed: 0x4a7a11, numRuns: 100, endOnFailure: true },
  );
});

test('generated equivalent filesystem paths cannot bypass a matching deny entry', () => {
  const segmentsArb = fc.array(safeSegmentArb(), { minLength: 1, maxLength: 2 });
  const modes =
    process.platform === 'darwin'
      ? ['dot', 'double-separator', 'case', 'unicode']
      : ['dot', 'double-separator'];
  fc.assert(
    fc.property(segmentsArb, fc.constantFrom(...modes), (segments, mode) => {
      let deniedPart = segments[0];
      let requestPart = deniedPart;
      if (mode === 'case') {
        deniedPart = `Blocked-${deniedPart}`;
        requestPart = deniedPart.toLowerCase();
      } else if (mode === 'unicode') {
        deniedPart = `Café-${deniedPart}`;
        requestPart = deniedPart.normalize('NFD');
      }

      const remainder = [...segments.slice(1), 'item.txt'];
      const deniedPath = path.join(workspace, deniedPart, ...remainder);
      let targetVariant;
      if (mode === 'dot') {
        targetVariant = `${workspace}/${requestPart}/./${remainder.join('/')}`;
      } else if (mode === 'double-separator') {
        targetVariant = `${workspace}//${requestPart}//${remainder.join('/')}`;
      } else {
        targetVariant = `${workspace}/${requestPart}/./${remainder.join('/')}`;
      }

      const configuredPolicy = policy();
      configuredPolicy.filesystem.deny = [deniedPath];
      const canonicalActionPath = path.resolve(targetVariant);
      const action = request(`deny-${mode}`, 1, canonicalActionPath);
      action.parameters.path = targetVariant;
      action.resourceScope = canonicalActionPath;
      assert.throws(() => evaluate(configuredPolicy, action), /Filesystem scope denied/);
    }),
    { seed: 0xd3e1e, numRuns: 120, endOnFailure: true },
  );
});
