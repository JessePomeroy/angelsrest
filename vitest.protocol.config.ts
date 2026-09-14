import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Compile admin lifecycle regressions with Svelte's client runtime in jsdom.
// This exercises installed components and clients without a browser runner.
export default defineConfig({
	plugins: [
		svelte({
			dynamicCompileOptions: () => ({ generate: "client" }),
		}),
	],
	resolve: {
		conditions: ["browser"],
		alias: {
			"$app/environment": path.resolve(root, "src/__mocks__/app-environment.client.ts"),
			"$app/navigation": path.resolve(root, "src/__mocks__/app-navigation.client.ts"),
			"$env/static/public": path.resolve(root, "src/__mocks__/env-public.ts"),
			"$lib": path.resolve(root, "src/lib"),
		},
	},
	test: {
		include: ["src/routes/admin/__tests__/*.client.ts"],
		environment: "jsdom",
		globals: true,
	},
});
