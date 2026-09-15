import { fileURLToPath } from "node:url";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
// The optional sibling source checkout is preview-only; production imports stay pinned.
const adminSource = process.env.ADMIN_EDITOR_SOURCE;
export default defineConfig({
	root: path("."),
	envDir: path("."),
	plugins: [
		svelte({
			configFile: false,
			preprocess: vitePreprocess(),
			compilerOptions: { css: "injected" },
		}),
	],
	optimizeDeps: { exclude: ["@jessepomeroy/admin", "@jessepomeroy/admin/theme"] },
	resolve: {
		dedupe: ["svelte"],
		alias: {
			...(adminSource
				? {
						"@jessepomeroy/admin/theme": `${adminSource}/src/lib/theme.ts`,
						"@jessepomeroy/admin": `${adminSource}/src/lib/index.ts`,
					}
				: {}),
			$lib: path("../../../src/lib"),
			"$app/environment": path("./environment.ts"),
			"$app/stores": path("./navigation.svelte.ts"),
			"$app/state": path("./state.svelte.ts"),
			"$app/navigation": path("./navigation.svelte.ts"),
			"convex-svelte": path("./convex.svelte.ts"),
			"$convex/api": path("./api.ts"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5208,
		strictPort: true,
		fs: { allow: [path("../../.."), ...(adminSource ? [adminSource] : [])] },
	},
});
