import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // Keep the gateway and accessibility suites in independent browser workers.
  // Local branded Chrome can exit during a long shared worker's API-only interval.
  projects: [
    { name: 'gateway', testIgnore: '**/ui-readiness.spec.ts' },
    { name: 'operator-ui', testMatch: '**/ui-readiness.spec.ts' },
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: { timeout: 10000 },
});
