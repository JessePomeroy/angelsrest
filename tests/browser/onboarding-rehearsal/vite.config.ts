import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
// Compile-time fixtures only. The SvelteKit/Vercel production build never reads these aliases.
export default defineConfig({
	root: path("."), envDir: path("."),
	plugins: [svelte({ configFile: false, compilerOptions: { css: "injected" } })],
	optimizeDeps: { exclude: ["@jessepomeroy/admin", "@jessepomeroy/admin/theme"] },
	resolve: { dedupe: ["svelte"], alias: {
		"$lib/config/admin": path("./config.ts"),
		$lib: path("../../../src/lib"),
		"$app/environment": path("../fixtures/environment.ts"),
		"$app/stores": path("./navigation.ts"),
		"$app/state": path("./state.svelte.ts"),
		"$app/navigation": path("./navigation.ts"),
		"$env/static/public": path("../fixtures/environment.ts"),
		"convex-svelte": path("./convex.svelte.ts"),
		"$convex/api": path("../fixtures/convex.ts"),
	} },
	build: { outDir: path("../../../build/onboarding-rehearsal"), emptyOutDir: true },
	server: { host: "127.0.0.1", port: 5201, strictPort: true, fs: { allow: [path("../../..")] } },
});
