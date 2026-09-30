import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real Nuxt SSR app and an organization seeded from
 * cms/content-model.eldra.json, with a few published products. Read-only towards the catalog:
 * the specs create carts, which expire and reserve no stock, and touch nothing else.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the variables come from the environment.
}
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
