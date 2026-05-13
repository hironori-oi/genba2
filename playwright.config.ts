import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function detectDevPort(): number | null {
  const portFile = join(process.cwd(), ".kobo", "dev-port.json");
  if (!existsSync(portFile)) return null;
  try {
    const json = JSON.parse(readFileSync(portFile, "utf8")) as { port?: number };
    return typeof json.port === "number" ? json.port : null;
  } catch {
    return null;
  }
}

const PORT = Number(process.env.PORT ?? detectDevPort() ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // The dev server is started externally via scripts/run-dev.sh (tmux session
  // kobo-dev-genba). Set PLAYWRIGHT_START_SERVER=1 to opt back into the
  // managed webServer for local one-off runs.
  webServer: process.env.PLAYWRIGHT_START_SERVER
    ? {
        command: `npm run build && PORT=${PORT} npm run start -- -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
