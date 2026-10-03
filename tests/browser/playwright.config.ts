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
		command: "node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts",
		cwd: fileURLToPath(new URL("../..", import.meta.url)),
		url: "http://127.0.0.1:5196",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
		{
			name: "firefox-desktop",
			testMatch: ["magnetic-images.spec.ts", "delivery-modality.spec.ts"],
			use: {
				...devices["Desktop Firefox"],
				launchOptions: {
					// Headless Linux can report no mouse; exercise the desktop hover path.
					firefoxUserPrefs: { "ui.primaryPointerCapabilities": 6, "ui.allPointerCapabilities": 6 },
				},
			},
		},
		{ name: "mobile", use: { ...devices["Pixel 7"] } },
		{ name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
	],
});
