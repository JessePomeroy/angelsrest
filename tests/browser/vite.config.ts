import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
	root: path("./fixtures"),
	plugins: [svelte({ configFile: false }), tailwindcss()],
	resolve: {
		alias: {
			$lib: path("../../src/lib"),
			"$app/environment": path("./fixtures/environment.ts"),
			"$app/navigation": path("./fixtures/navigation.ts"),
			"$env/static/public": path("./fixtures/environment.ts"),
			"convex-svelte": path("./fixtures/convex.ts"),
			"$convex/api": path("./fixtures/convex.ts"),
		},
	},
	server: { host: "127.0.0.1", port: 5196, strictPort: true, fs: { allow: [path("../..")] } },
});
