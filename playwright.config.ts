import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/dashboard/tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "corepack pnpm@10.22.0 --filter dashboard dev",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      testMatch: /dashboard\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /dashboard\.spec\.ts/u,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "confirm-js-disabled",
      testMatch: /confirm-page\.spec\.ts/u,
      use: { ...devices["Pixel 7"], javaScriptEnabled: false },
    },
    {
      name: "confirm-a11y",
      testMatch: /confirm-page\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
