import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createCatalogPrivateEditorUploadCompleteHandler,
	createCatalogPrivateEditorUploadPrepareHandler,
} from "@jessepomeroy/admin/server";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("catalog private Editor upload host boundaries", () => {
	it("pins the published package and lock contract to exactly 3.30.0", () => {
		const packageJson = JSON.parse(source("package.json")) as {
			dependencies: Record<string, string>;
		};
		const installedPackage = JSON.parse(
			source("node_modules/@jessepomeroy/admin/package.json"),
		) as { version: string; engines: { node: string } };
		const lockfile = source("pnpm-lock.yaml");

		expect(packageJson.dependencies["@jessepomeroy/admin"]).toBe("3.30.0");
		expect(installedPackage).toMatchObject({ version: "3.30.0", engines: { node: "24.x" } });
		expect(lockfile).toContain("'@jessepomeroy/admin@3.30.0':");
		expect(lockfile).toContain("specifier: 3.30.0");
		expect(lockfile).not.toContain("'@jessepomeroy/admin@3.29.0':");
	});

	it("pins the adapter default to the Node 24 package and CI runtime", () => {
		const config = source("svelte.config.js");
		expect(config).toContain('runtime: "nodejs24.x"');
		expect(config).not.toContain('runtime: "nodejs22.x"');
	});

	it("consumes the two documented shared server factories", () => {
		expect(createCatalogPrivateEditorUploadPrepareHandler).toBeTypeOf("function");
		expect(createCatalogPrivateEditorUploadCompleteHandler).toBeTypeOf("function");

		const declarations = source("node_modules/@jessepomeroy/admin/dist/config.d.ts");
		const contract = declarations.slice(
			declarations.indexOf("export interface CatalogPrivateEditorUploadConfig"),
			declarations.indexOf("export interface AdminServerConfig"),
		);
		expect(contract).toContain("convexJournalOrigin: string");
		expect(contract).toContain("hostJournalSecret: string");
		expect(contract).toContain(
			'workerOrigin: "https://cms-media-worker.thinkingofview.workers.dev"',
		);
		expect(contract).toContain("storageCallerSecret: string");
		expect(contract).toContain("browserOrigin: string");
		expect(contract).not.toMatch(/control|inspect|receipt|seal|tenant/i);
	});

	it("documents only empty, purpose-specific host credentials", () => {
		const example = source(".env.example");
		expect(example).toMatch(/^CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET=$/m);
		expect(example).toMatch(/^CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET=$/m);
		expect(example).toContain(
			"Do not give this host inspector, receipt, sealing, broad tenant, or",
		);
	});

	it("keeps the client Editor config and UI unaware of the new server routes", () => {
		const clientConfig = source("src/lib/config/admin.ts");
		expect(clientConfig).not.toContain("catalogPrivateEditorUpload");
		expect(clientConfig).not.toContain("editor-uploads/prepare");
		expect(clientConfig).not.toContain("editor-uploads/complete");

		for (const path of [
			"src/routes/admin/editor/products/+page.svelte",
			"src/routes/admin/editor/products/[productId]/+page.svelte",
		]) {
			expect(source(path)).not.toContain("editor-uploads");
		}
	});

	it("leaves public Shop, Sanity, provider, product, and checkout sources disconnected", () => {
		const boundaries = [
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/lib/server/checkoutCatalog.ts",
			"src/routes/api/checkout/+server.ts",
			"src/routes/api/cart/checkout/+server.ts",
			"src/lib/server/lumaprints.ts",
			"src/lib/server/printFulfillment.ts",
		];

		for (const path of boundaries) {
			const file = source(path);
			expect(file).not.toContain("catalogPrivateEditorUpload");
			expect(file).not.toContain("catalog-private-assets/editor-uploads");
			expect(file).not.toContain("createCatalogPrivateEditorUpload");
		}

		expect(source("src/routes/shop/+page.server.ts")).toContain('from "$lib/sanity/client.server"');
		expect(source("src/routes/shop/[slug]/+page.server.ts")).toContain(
			'from "$lib/sanity/client.server"',
		);
		expect(source("src/lib/server/checkoutCatalog.ts")).toContain('_type == "lumaProductV2"');
		expect(source("src/routes/api/checkout/+server.ts")).toContain('from "$lib/sanity/client"');
		expect(source("src/lib/server/lumaprints.ts")).toContain("LUMAPRINTS_API_KEY");
	});
});
