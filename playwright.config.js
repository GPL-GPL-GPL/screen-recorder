const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    browserName: 'chromium',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'python -m http.server 8787 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8787/index-v1.html',
    reuseExistingServer: true,
    timeout: 10000
  }
});
