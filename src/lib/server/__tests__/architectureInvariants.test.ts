import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const files = (path: string): string[] =>
	readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) => {
		const child = `${path}/${entry.name}`;
		return entry.isDirectory() ? files(child) : [child];
	});

describe("architecture invariants", () => {
	it("keeps current authority server-only, Convex-only, and independent of recovery code", () => {
		const forbidden =
			/(?:\$lib\/server\/|\.\.\/)(?:recovery|migration|compatibility)(?:\/|["'])|sanity/i;
		expect('../recovery/example.server"').toMatch(forbidden);
		for (const path of files("src/lib/server/current")) {
			expect(path).toMatch(/\.server\.ts$/);
			expect(source(path)).not.toMatch(forbidden);
		}
		for (const path of files("src/lib/server/recovery")) expect(path).toMatch(/\.server\.ts$/);
	});

	it("keeps browser source independent of private environment modules", () => {
		const browserFiles = files("src").filter(
			(path) =>
				[".ts", ".svelte"].includes(extname(path)) &&
				!path.includes("/__tests__/") &&
				!path.endsWith(".test.ts") &&
				!path.startsWith("src/lib/server/") &&
				!path.endsWith(".server.ts") &&
				!/[+](?:server|page\.server|layout\.server)\.ts$/.test(path),
		);
		for (const path of browserFiles) {
			expect(source(path), path).not.toMatch(/\$env\/(?:dynamic|static)\/private/);
		}
	});

	it("keeps Shop and checkout on their direct Convex authority modules", () => {
		const checkout = source("src/lib/server/current/currentCheckoutCommerce.server.ts");
		expect(checkout).toContain('from "$convex/api"');
		expect(checkout).toContain('provider: "convex"');
		for (const path of [
			"src/lib/server/current/currentCheckoutCommerce.server.ts",
			"src/lib/server/directCheckout.ts",
			"src/lib/server/snapshotFulfillment.ts",
			"src/routes/api/checkout/+server.ts",
			"src/routes/api/cart/checkout/+server.ts",
			"src/routes/api/download/+server.ts",
		]) {
			expect(source(path), path).not.toMatch(
				/sanity|CHECKOUT_CATALOG_PROVIDER|CHECKOUT_SNAPSHOT_MODE/i,
			);
		}

		for (const path of [
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/[slug]/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
		]) {
			expect(source(path)).toContain('from "$lib/server/current/convexShop.server"');
		}
	});

	it("keeps commerce and shipment intake owned by their one hub route", () => {
		const application = files("src")
			.filter(
				(path) =>
					path.endsWith(".ts") && !path.includes("/__tests__/") && !path.endsWith(".test.ts"),
			)
			.sort();
		const importers = (symbol: string) =>
			application.filter((path) => source(path).includes(symbol));
		expect(importers("processStripeWebhookEvent")).toEqual([
			"src/lib/server/orderIntake.ts",
			"src/routes/api/webhooks/stripe/+server.ts",
		]);
		expect(importers("processLumaPrintsShipment")).toEqual([
			"src/lib/server/lumaprintsWebhook.ts",
			"src/routes/api/webhooks/lumaprints/+server.ts",
		]);
	});

	it("keeps document portal reads on the client-safe projection", () => {
		for (const path of [
			"src/routes/portal/[token]/+page.server.ts",
			"src/routes/delivery/[token]/+page.server.ts",
			"src/lib/server/portalToken.ts",
		]) {
			expect(source(path)).toContain("api.portal.getPublicByToken");
			expect(source(path)).not.toContain("api.portal.getByToken");
		}
	});

	it("keeps generated Convex outputs visibly generator-owned", () => {
		for (const path of files("packages/crm-api/convex/_generated").filter(
			(path) => !path.includes("/_generated/ai/"),
		)) {
			expect(source(path), path).toContain("THIS CODE IS AUTOMATICALLY GENERATED");
		}
	});
});
