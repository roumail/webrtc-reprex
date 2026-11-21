// Two browser windows on one machine play two devices on the same Wi-Fi.
// Chromium's fake microphone sends a beep, so audio really flows.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  retries: 0,
  // The first call after a cold browser start takes longer to connect
  // (seen once: >5 s). Still waits on state, never sleeps.
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'node tests/serve.mjs',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
  },
});
