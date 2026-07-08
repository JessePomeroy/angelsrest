import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: "http://127.0.0.1:5173",
		trace: "on-first-retry",
	},
	webServer: {
		command: "pnpm dev --host 127.0.0.1",
		// Probe an API route so CI placeholder Sanity config does not block
		// readiness through the site-wide layout data fetch.
		url: "http://127.0.0.1:5173/api/download",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
