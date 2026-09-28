/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { SITE_A, createGraph, graphDraft, setup } from "../test/catalogProductGraphFixtures";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	vi.stubEnv("SITE_URL", "https://site-a.example");
	vi.stubEnv("BETTER_AUTH_SECRET", "test-cleanup-better-auth-0123456789abcdef");
});
afterEach(() => vi.unstubAllEnvs());

describe("catalog cleanup retention boundary", () => {
	test.each(["print_source", "paid_digital_file"] as const)("deletes unreferenced %s bytes through a retryable fence and preserves audit metadata", async (kind) => {
		const f = await setup(modules);
		const id = kind === "print_source" ? f.printA : f.paidA;
		const args = { siteUrl: SITE_A.siteUrl, kind, id };
		await expect(f.adminB.mutation(api.catalogPrivateAssets.requestDeletion, args)).rejects.toThrow();
		const result = await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args);
		expect(result.status).toBe("deleting");
		expect(Object.keys(result).sort()).toEqual(["deletionId", "status"]);
		const manifest = await f.t.query(internal.catalogPrivateAssets.getDeletionManifest, { ...args, deletionId: result.deletionId });
		expect(await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args)).toEqual(result);
		await expect(createGraph(f.adminA, SITE_A.siteUrl, "reuse-deleted", graphDraft(kind === "print_source" ? "print" : "digital_download", f))).rejects.toThrow(/permanent deletion/);
		await expect(f.t.mutation(internal.catalogPrivateAssets.completeDeletion, { ...args, assetKey: manifest.assetKey, sha256: "f".repeat(64) })).rejects.toThrow(/identity conflict/);
		await f.t.mutation(internal.catalogPrivateAssets.completeDeletion, { ...args, assetKey: manifest.assetKey, sha256: manifest.sha256 });
		await f.t.mutation(internal.catalogPrivateAssets.completeDeletion, { ...args, assetKey: manifest.assetKey, sha256: manifest.sha256 });
		expect((await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args)).status).toBe("deleted");
		expect(await f.t.run((ctx) => ctx.db.get(id))).not.toBeNull();
		const listed = await f.adminA.query(api.catalogPrivateAssets.listForCleanup, { siteUrl: SITE_A.siteUrl, kind, paginationOpts: { cursor: null, numItems: 25 } });
		expect(listed.page.some((row) => row.id === id)).toBe(false);
	});

	test("retained revisions block private and web cleanup until unused product removal", async () => {
		const f = await setup(modules);
		const product = await createGraph(f.adminA, SITE_A.siteUrl, "cleanup-product", graphDraft("print", f));
		await f.adminA.mutation(api.catalogProductGraphs.discardDraft, { productId: product.productId, draftRevisionId: product.revisionId });
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA })).rejects.toThrow(/retained/);
		await expect(f.adminA.mutation(api.mediaAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, id: f.webA })).rejects.toThrow(/retained/);
		const state = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: product.productId });
		await expect(f.adminB.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt })).rejects.toThrow();
		await expect(f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt - 1 })).rejects.toThrow(/changed/);
		await f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt });
		expect(await f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt })).toEqual({ deleted: true, productId: product.productId });
		await expect(f.adminB.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt })).rejects.toThrow();
		expect(await f.t.run((ctx) => ctx.db.get(product.revisionId))).toBeNull();
		expect(await f.t.run((ctx) => ctx.db.get(f.printA))).not.toBeNull();
		expect((await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA })).status).toBe("deleting");
		await expect(f.t.mutation(internal.orders.reserveCheckoutSnapshot, { siteUrl: SITE_A.siteUrl, handleHash: "late-handle", snapshotDigest: "late-digest", snapshot: {
			schemaVersion: 1, catalogProvider: "convex", items: [{ productKey: product.productId, revisionId: product.revisionId, productKind: "print", variantKey: "default", materialOptionKey: null, sizeOptionKey: null, borderOptionKey: null, frameOptionKey: null }],
		} })).rejects.toThrow(/permanently deleted/);
	});

	test("removing one unused product does not free an asset shared with another", async () => {
		const f = await setup(modules);
		const one = await createGraph(f.adminA, SITE_A.siteUrl, "one", graphDraft("print", f, "one"));
		await createGraph(f.adminA, SITE_A.siteUrl, "two", graphDraft("print", f, "two"));
		const state = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: one.productId });
		await f.adminA.mutation(api.catalogProductGraphs.remove, { productId: one.productId, expectedUpdatedAt: state.updatedAt });
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA })).rejects.toThrow(/retained/);
	});

	test.each(["order", "checkout"] as const)("retains unpublished product history referenced by an %s", async (retainer) => {
		const f = await setup(modules);
		const product = await createGraph(f.adminA, SITE_A.siteUrl, "retained", graphDraft("digital_download", f));
		const snapshot = { schemaVersion: 1 as const, catalogProvider: "convex" as const, items: [{ productKey: product.productId, revisionId: product.revisionId, productKind: "digital_download" as const, variantKey: "default", materialOptionKey: null, sizeOptionKey: null, borderOptionKey: null, frameOptionKey: null }] };
		await f.t.run(async (ctx) => {
			if (retainer === "order") await ctx.db.insert("orders", { siteUrl: SITE_A.siteUrl, orderNumber: "test", stripeSessionId: "test", checkoutSnapshot: snapshot, customerEmail: "test@example.com", items: [], total: 0, fulfillmentType: "digital", status: "refunded" });
			else await ctx.db.insert("checkoutSnapshotReservations", { siteUrl: SITE_A.siteUrl, state: "reserved", handleHash: "test", snapshotDigest: "test", snapshot, accountScope: "platform", unboundPurgeAt: Date.now() + 60000, createdAt: Date.now(), updatedAt: Date.now() });
		});
		const state = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: product.productId });
		await expect(f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt })).rejects.toThrow(/retained by an order or checkout/);
		expect(await f.t.run((ctx) => ctx.db.get(product.revisionId))).not.toBeNull();
	});

	test("refuses published products and invalid asset kinds", async () => {
		const f = await setup(modules);
		const product = await createGraph(f.adminA, SITE_A.siteUrl, "published", graphDraft("print", f));
		const state = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: product.productId });
		await f.adminA.mutation(api.catalogProductGraphs.publishDraft, { productId: product.productId, expectedDraftRevisionId: product.revisionId, expectedPublishedRevisionId: null, expectedUpdatedAt: state.updatedAt });
		const current = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: product.productId });
		await expect(f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: current.updatedAt })).rejects.toThrow(/Unpublish/);
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "paid_digital_file", id: f.printA })).rejects.toThrow(/not found/);
	});

	test("expired unregistered uploads are cleanable while fresh uploads and live leases are protected", async () => {
		const f = await setup(modules);
		const createdAt = Date.now() - 48 * 60 * 60 * 1000;
		const operation = { siteUrl: SITE_A.siteUrl, kind: "print_source" as const, operationId: "e".repeat(40), sourceId: "test-expired", assetKey: "expired-upload", privateObjectKey: `sites/${SITE_A.siteUrl}/catalog/print-sources/expired-upload/original`, createdAt, sha256: "a".repeat(64), originalFilename: "expired.jpg", sizeBytes: 100, lifecycle: "expired" as const };
		const id = await f.t.run((ctx) => ctx.db.insert("catalogPrivateAssetEditorOperations", operation));
		const args = { siteUrl: SITE_A.siteUrl, kind: "print_source" as const, id };
		await f.t.run((ctx) => ctx.db.patch(id, { createdAt: Date.now() }));
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args)).rejects.toThrow(/not eligible/);
		await f.t.run((ctx) => ctx.db.patch(id, { createdAt }));
		const leaseId = await f.t.run((ctx) => ctx.db.insert("catalogPrivateAssetEditorEffects", { siteUrl: SITE_A.siteUrl, operationId: operation.operationId, kind: "inspection_dispatch", generation: 1, state: "leased", attempts: 1, nextAttemptAt: createdAt, leaseExpiresAt: Date.now() + 60000, createdAt, updatedAt: createdAt }));
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args)).rejects.toThrow(/still be active/);
		await f.t.run((ctx) => ctx.db.patch(leaseId, { state: "failed" }));
		const result = await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, args);
		expect(result.status).toBe("deleting");
		expect(Object.keys(result).sort()).toEqual(["deletionId", "status"]);
		const manifest = await f.t.query(internal.catalogPrivateAssets.getDeletionManifest, { ...args, deletionId: result.deletionId });
		await f.t.mutation(internal.catalogPrivateAssets.completeDeletion, { ...args, assetKey: manifest.assetKey, sha256: manifest.sha256 });
		expect(await f.t.run((ctx) => ctx.db.get(id))).not.toBeNull();
		const page = await f.adminA.query(api.catalogPrivateAssets.listExpiredUploadsForCleanup, { siteUrl: SITE_A.siteUrl, kind: "print_source", paginationOpts: { numItems: 25, cursor: null } });
		expect(page.page).toEqual([]);
	});

	test("completion HTTP requires the exact tenant credential and a prior deletion request", async () => {
		const f = await setup(modules);
		const secret = "deletion-completion-test-0123456789abcdef";
		const body = { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA, assetKey: "print-a", sha256: "1".repeat(64) };
		const send = (payload: object, bearer: string) => f.t.fetch("/cms-media/catalog-private-assets/complete-deletion", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` }, body: JSON.stringify(payload) });
		vi.stubEnv("CMS_MEDIA_DELETION_COMPLETION_SECRETS", JSON.stringify({ [SITE_A.siteUrl]: [secret] }));
		try {
			expect((await send(body, "wrong-deletion-secret-0123456789abcdef")).status).toBe(401);
			expect((await send({ ...body, siteUrl: "other.example" }, secret)).status).toBe(401);
			expect((await send(body, secret)).status).toBe(409);
			const deletion = await f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA });
			const manifestResponse = await f.t.fetch("/cms-media/catalog-private-assets/deletion-manifest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA, deletionId: deletion.deletionId }) });
			expect(manifestResponse.status).toBe(200);
			const manifest = await manifestResponse.json();
			expect((await send({ ...body, assetKey: manifest.assetKey, sha256: manifest.sha256 }, secret)).status).toBe(200);
		} finally { vi.unstubAllEnvs(); }
	});

	test("fails closed when retention history cannot be checked within the bound", async () => {
		const f = await setup(modules);
		const product = await createGraph(f.adminA, SITE_A.siteUrl, "bounded", graphDraft("print", f));
		await f.t.run(async (ctx) => {
			for (let i = 0; i < 501; i++) await ctx.db.insert("orders", { siteUrl: SITE_A.siteUrl, orderNumber: String(i), stripeSessionId: String(i), customerEmail: "test@example.com", items: [], total: 0, fulfillmentType: "self", status: "new" });
		});
		const state = await f.adminA.query(api.catalogProductGraphs.getEditorState, { productId: product.productId });
		await expect(f.adminA.mutation(api.catalogProductGraphs.remove, { productId: product.productId, expectedUpdatedAt: state.updatedAt })).rejects.toThrow(/safe cleanup limit/);
		expect(await f.t.run((ctx) => ctx.db.get(product.productId))).not.toBeNull();
	});

	test("retains a private object captured directly in frozen order production data", async () => {
		const f = await setup(modules);
		const asset = await f.t.run((ctx) => ctx.db.get(f.printA));
		if (!asset) throw new Error("Missing synthetic asset");
		await f.t.run((ctx) => ctx.db.insert("orders", {
			siteUrl: SITE_A.siteUrl, orderNumber: "frozen-test", stripeSessionId: "frozen-test", customerEmail: "test@example.com", items: [], total: 0, fulfillmentType: "self", status: "new",
			printInput: { version: 1, lines: [{ amountCents: 0, sources: [{
				descriptor: { key: asset.privateObjectKey, hash: asset.sha256, bytes: asset.sizeBytes, mime: "image/jpeg", dimensions: { width: 8000, height: 6000 } },
				item: { paperSubcategoryId: 1, width: 8, height: 10 }, product: { subcategoryId: 1, orderItemOptions: [] },
			}] }] },
		}));
		await expect(f.adminA.mutation(api.catalogPrivateAssets.requestDeletion, { siteUrl: SITE_A.siteUrl, kind: "print_source", id: f.printA })).rejects.toThrow(/production data/);
		expect(await f.t.run((ctx) => ctx.db.query("catalogPrivateAssetDeletions").take(1))).toEqual([]);
	});

	test("only the inquiry's site admin can remove it", async () => {
		const f = await setup(modules);
		const id = await f.t.run((ctx) => ctx.db.insert("inquiries", { siteUrl: SITE_A.siteUrl, name: "Test", email: "test@example.com", message: "synthetic", status: "new" }));
		await expect(f.adminB.mutation(api.inquiries.remove, { id })).rejects.toThrow();
		await expect(f.t.mutation(api.inquiries.remove, { id })).rejects.toThrow();
		await f.adminA.mutation(api.inquiries.remove, { id });
		expect(await f.t.run((ctx) => ctx.db.get(id))).toBeNull();
	});
});
