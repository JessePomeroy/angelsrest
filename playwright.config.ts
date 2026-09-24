import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: "http://127.0.0.1:5173",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm dev --host 127.0.0.1",
		// Probe a static asset so remote content availability and the closed
		// commerce gate cannot block server readiness.
		url: "http://127.0.0.1:5173/robots.txt",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "webkit-footprint",
			testMatch: ["footprint.spec.ts", "fonts.spec.ts"],
			// Exercise public image/font delivery in mobile WebKit without profiling
			// optional GPU effects on the CI software renderer.
			use: { ...devices["iPhone 13"], contextOptions: { reducedMotion: "reduce" } },
		},
	],
});
