import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
	root: path("."),
	envDir: path("."),
	plugins: [svelte({ configFile: false, compilerOptions: { css: "injected" } })],
	optimizeDeps: { exclude: ["@jessepomeroy/admin", "@jessepomeroy/admin/theme"] },
	resolve: {
		dedupe: ["svelte"],
		alias: {
			"$lib/components/TurnstileWidget.svelte": path("./VerificationFixture.svelte"),
			"$lib/auth/client": path("./auth.ts"),
			"$lib/adminFullPageReload": path("./auth.ts"),
			$lib: path("../../../src/lib"),
			"@vercel/analytics/sveltekit": path("../fixtures/analytics.ts"),
			"$app/environment": path("../fixtures/environment.ts"),
			"$app/stores": path("./navigation.svelte.ts"),
			"$app/state": path("./state.svelte.ts"),
			"$app/navigation": path("./navigation.svelte.ts"),
			"$env/static/public": path("../fixtures/environment.ts"),
			"convex-svelte": path("./convex.svelte.ts"),
			"$convex/api": path("../fixtures/convex.ts"),
		},
	},
	server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [path("../../..")] } },
});
