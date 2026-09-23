import { defineConfig, devices } from '@playwright/test';

// Runs the built app against a fresh demo database. `npm run build` first.
const port = 3100;
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['Pixel 5'],
    locale: 'fr-FR',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `node scripts/e2e-server.mjs ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
