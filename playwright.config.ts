import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
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
