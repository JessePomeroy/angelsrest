import path from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		fs: {
			allow: ["convex/_generated"],
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		globals: true,
		alias: {
			"$env/static/private": path.resolve("./src/__mocks__/env-private.ts"),
			"$env/dynamic/private": path.resolve("./src/__mocks__/env-dynamic.ts"),
			"$env/static/public": path.resolve("./src/__mocks__/env-public.ts"),
		},
	},
});
