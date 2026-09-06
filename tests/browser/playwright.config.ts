import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	fullyParallel: true,
	workers: 2,
	timeout: 20_000,
	expect: { timeout: 5_000 },
	use: { baseURL: "http://127.0.0.1:5196", trace: "retain-on-failure" },
	webServer: {
		command: "pnpm exec vite --config tests/browser/vite.config.ts",
		cwd: fileURLToPath(new URL("../..", import.meta.url)),
		url: "http://127.0.0.1:5196",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
		{ name: "mobile", use: { ...devices["Pixel 7"] } },
	],
});
