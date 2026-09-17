import path from "node:path";
import { defineConfig } from "vitest/config";

const workerRoot = path.resolve(process.env.GALLERY_WORKER_CONTRACT_ROOT ?? ".contract/gallery-worker");

export default defineConfig({
	resolve: {
		alias: {
			...(process.env.GALLERY_ADMIN_CONTRACT_SERVER
				? { "@jessepomeroy/admin/server": path.resolve(process.env.GALLERY_ADMIN_CONTRACT_SERVER) }
				: {}),
			"@gallery-worker": path.join(workerRoot, "src"),
			"@gallery-worker-tests": path.join(workerRoot, "tests"),
			"cloudflare:workers": path.join(workerRoot, "tests/support/cloudflareWorkers.ts"),
			"cloudflare:workflows": path.join(workerRoot, "tests/support/cloudflareWorkflows.ts"),
		},
	},
	test: { include: ["scripts/gallery-upload-contract/*.contract.mjs"], environment: "node" },
});
