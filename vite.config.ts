import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Resolve paths against the config file's location, not the cwd. Using
// `path.resolve(".")` here would silently change behavior depending on
// where vite/vitest was invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Audit H46: wire the Sentry plugin so source maps are uploaded at
		// build time. Without this Sentry ingests the minified stack frames
		// and dashboards are unreadable. The plugin no-ops when
		// SENTRY_AUTH_TOKEN isn't set (dev builds, CI without Sentry
		// secrets), so it's safe to leave enabled everywhere.
		sentrySvelteKit({
			sourceMapsUploadOptions: {
				org: process.env.SENTRY_ORG,
				project: process.env.SENTRY_PROJECT,
				authToken: process.env.SENTRY_AUTH_TOKEN,
				// Silence the "SENTRY_AUTH_TOKEN not provided" warning in dev;
				// when the token is missing the upload is a no-op anyway.
				telemetry: false,
			},
		}),
		sveltekit(),
	],
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
			"$env/static/private": path.resolve(__dirname, "./src/__mocks__/env-private.ts"),
			"$env/dynamic/private": path.resolve(__dirname, "./src/__mocks__/env-dynamic.ts"),
			"$env/static/public": path.resolve(__dirname, "./src/__mocks__/env-public.ts"),
		},
	},
});
