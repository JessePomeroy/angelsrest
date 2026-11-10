// Use adapter-vercel explicitly: SvelteKit only enables
// experimental.instrumentation.server (audit #50a — Sentry init) with an
// adapter that guarantees the target runtime supports it.
import adapter from "@sveltejs/adapter-vercel";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	kit: {
		// Audit H47: pin runtime + maxDuration explicitly. Without these,
		// Vercel uses its evolving defaults — which have bitten the Stripe
		// webhook before when the implicit function timeout shortened.
		// nodejs24.x matches the package engines and pinned CI runtime; 30s is
		// generous for the webhook + LumaPrints round trip. Longer routes override it.
		adapter: adapter({
			runtime: "nodejs24.x",
			maxDuration: 30,
		}),
		alias: {
			$convex: "./packages/crm-api/convex/_generated",
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
