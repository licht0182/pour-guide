import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT || 4173);
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.pw.mjs', timeout: 30000, workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: { command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}/pour-guide/`, reuseExistingServer: false },
});
