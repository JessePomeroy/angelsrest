import adapter from "@sveltejs/adapter-auto";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	kit: {
		adapter: adapter(),
		alias: {
			$convex: "./convex/_generated",
		},
		experimental: {
			// Required for src/instrumentation.server.ts to be loaded
			// at server startup (audit #50a — Sentry init).
			instrumentation: {
				server: true,
			},
		},
	},
};

export default config;
