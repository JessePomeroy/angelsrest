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
const canUploadSentrySourceMaps = Boolean(
	process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Audit H46: wire the Sentry plugin so source maps are uploaded at
		// build time. Without this Sentry ingests the minified stack frames
		// and dashboards are unreadable. Uploads are enabled only when the
		// required Sentry env vars exist, so local builds stay quiet.
		sentrySvelteKit({
			// This site uses Sentry for error capture only right now
			// (`tracesSampleRate: 0`). Leaving auto-instrumentation on injects
			// @sentry/sveltekit runtime imports into every server load and makes
			// Vercel trace Sentry's build-time plugin code into the serverless
			// bundle. Re-enable only when we intentionally turn tracing on.
			autoInstrument: false,
			autoUploadSourceMaps: canUploadSentrySourceMaps,
			sourceMapsUploadOptions: canUploadSentrySourceMaps
				? {
						org: process.env.SENTRY_ORG,
						project: process.env.SENTRY_PROJECT,
						authToken: process.env.SENTRY_AUTH_TOKEN,
						telemetry: false,
					}
				: undefined,
		}),
		sveltekit(),
	],
	build: {
		// Sanity visual editing is preview-only but still emitted as a large
		// dynamic chunk. Keep the warning useful for genuinely oversized chunks.
		chunkSizeWarningLimit: 900,
		rollupOptions: {
			onLog(level, log, handler) {
				if (
					level === "warn" &&
					typeof log.message === "string" &&
					log.message.includes("Module level directives cause errors when bundled") &&
					log.message.includes("framer-motion")
				) {
					return;
				}
				handler(level, log);
			},
		},
	},
	server: {
		fs: {
			allow: ["packages/crm-api/convex/_generated"],
		},
	},
	test: {
		include: [
			"src/**/*.test.ts",
			"packages/crm-api/convex/**/*.test.ts",
			"scripts/cms/**/*.test.ts",
		],
		environment: "node",
		globals: true,
		alias: {
			"$env/static/private": path.resolve(__dirname, "./src/__mocks__/env-private.ts"),
			"$env/dynamic/private": path.resolve(__dirname, "./src/__mocks__/env-dynamic.ts"),
			"$env/static/public": path.resolve(__dirname, "./src/__mocks__/env-public.ts"),
		},
	},
});
