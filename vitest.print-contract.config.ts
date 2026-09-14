import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@print-worker": path.resolve(root, ".contract/gallery-worker/src/cms-media"),
			"$lib": path.resolve(root, "src/lib"),
			"$env/dynamic/private": path.resolve(root, "scripts/print-contract/env.mjs"),
			"$env/dynamic/public": path.resolve(root, "scripts/print-contract/env.mjs"),
		},
	},
	test: {
		include: ["scripts/print-contract/*.contract.mjs"],
		environment: "node",
	},
});
