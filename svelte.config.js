// Switched from @sveltejs/adapter-auto to adapter-vercel directly so the
// experimental.instrumentation.server flag (audit #50a — Sentry init)
// passes SvelteKit's safety check, which refuses to enable instrumentation
// under adapter-auto because it can't promise the target runtime supports it.
// Vercel was the auto-detected target anyway, so behavior is unchanged.
import adapter from "@sveltejs/adapter-vercel";

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
