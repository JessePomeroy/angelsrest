import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
	root: path("./fixtures"),
	// Keep real component styles while avoiding dev virtual-CSS cache misses for packed packages.
	plugins: [svelte({ configFile: false, compilerOptions: { css: "injected" } }), tailwindcss()],
	optimizeDeps: { exclude: ["@jessepomeroy/admin", "@jessepomeroy/admin/theme"] },
	resolve: {
		dedupe: ["svelte"],
		alias: {
			$lib: path("../../src/lib"),
			"$app/stores": path("./fixtures/stores.ts"),
			"$app/environment": path("./fixtures/environment.ts"),
			"$app/state": path("./fixtures/state.svelte.ts"),
			"$app/navigation": path("./fixtures/navigation.ts"),
			"$env/static/public": path("./fixtures/environment.ts"),
			"convex-svelte": path("./fixtures/convex.ts"),
			"$convex/api": path("./fixtures/convex.ts"),
		},
	},
	server: { host: "127.0.0.1", port: 5196, strictPort: true, fs: { allow: [path("../..")] } },
});
