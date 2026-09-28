/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
async function setup() {
	const t = convexTest(schema, modules);
	const ownerId = await t.mutation(internal.platform.seedClient, {
		name: "Owner",
		email: "owner@example.com",
		siteUrl: "angelsrest.online",
		tier: "full",
		adminEmails: ["owner@example.com"],
		role: "creator",
	});
	const clientId = await t.mutation(internal.platform.seedClient, {
		name: "Client",
		email: "admin@example.com",
		siteUrl: "a.example",
		tier: "basic",
		adminEmails: ["admin@example.com"],
		role: "client",
	});
	return {
		t,
		ownerId: ownerId.id,
		clientId: clientId.id,
		admin: t.withIdentity({ subject: "admin", email: "admin@example.com", emailVerified: true }),
		owner: t.withIdentity({ subject: "owner", email: "owner@example.com", emailVerified: true }),
	};
}
test("offboarding revokes existing tenant access, preserves records, and requires explicit early erasure", async () => {
	const { t, owner, admin, clientId, ownerId } = await setup();
	await expect(
		admin.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: "a.example" }),
	).rejects.toThrow();
	await expect(
		owner.mutation(api.platformOffboarding.disable, {
			clientId: ownerId,
			confirmSiteUrl: "angelsrest.online",
		}),
	).rejects.toThrow();
	const result = await owner.mutation(api.platformOffboarding.disable, {
		clientId,
		confirmSiteUrl: "a.example",
	});
	expect(result.retainUntil - result.disabledAt).toBe(90 * 86400000);
	await expect(admin.query(api.inquiries.list, { siteUrl: "a.example" })).rejects.toThrow();
	await expect(
		admin.mutation(api.adminAuth.claimAdminAccess, { siteUrl: "a.example" }),
	).rejects.toThrow();
	expect(await t.query(api.platformOffboarding.isActive, { siteUrl: "a.example" })).toEqual({
		active: false,
	});
	expect(await owner.query(api.inquiries.list, { siteUrl: "a.example" })).toEqual([]);
	await expect(owner.mutation(api.adminAuth.claimAdminAccess, { siteUrl: "a.example" })).resolves.toMatchObject({ authorized: true, claimed: false });
	await expect(owner.query(api.adminAuth.checkAdminAccess, { siteUrl: "a.example", email: "owner@example.com" })).resolves.toMatchObject({ authorized: true });
	await expect(admin.query(api.adminAuth.checkAdminAccess, { siteUrl: "a.example", email: "admin@example.com" })).resolves.toMatchObject({ authorized: false });
	await expect(
		owner.mutation(api.platformOffboarding.requestErasure, {
			clientId,
			confirmSiteUrl: "a.example",
			eraseImmediately: false,
		}),
	).rejects.toThrow("90-day");
	await owner.mutation(api.platformOffboarding.restoreAccess, {
		clientId,
		confirmSiteUrl: "a.example",
	});
	expect(await admin.query(api.inquiries.list, { siteUrl: "a.example" })).toEqual([]);
	await owner.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: "a.example" });
	await owner.mutation(api.platformOffboarding.requestErasure, {
		clientId,
		confirmSiteUrl: "a.example",
		eraseImmediately: true,
	});
	await expect(
		owner.mutation(api.platformOffboarding.restoreAccess, {
			clientId,
			confirmSiteUrl: "a.example",
		}),
	).rejects.toThrow();
	expect((await t.run((ctx) => ctx.db.get(clientId)))?.email).toBe("admin@example.com");
});
test("90 days permits owner-requested erasure without automatically erasing anything", async () => {
	vi.useFakeTimers();
	const { owner, clientId, t } = await setup();
	await owner.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: "a.example" });
	vi.setSystemTime(Date.now() + 90 * 86400000);
	expect(
		(await t.run((ctx) => ctx.db.get(clientId)))?.offboarding?.erasureRequestedAt,
	).toBeUndefined();
	expect(
		(
			await owner.mutation(api.platformOffboarding.requestErasure, {
				clientId,
				confirmSiteUrl: "a.example",
				eraseImmediately: false,
			})
		).immediateErasure,
	).toBe(false);
});
test("archived content purge erases revisions, preserves identity, and cannot be restored", async () => {
	const { t, admin } = await setup();
	const created = await admin.mutation(api.blogContent.createDraft, {
		siteUrl: "a.example",
		documentKey: "author-a",
		draft: { kind: "author", name: "Author", slug: "author-a" },
	});
	let doc = await t.run((ctx) => ctx.db.get(created.documentId));
	await expect(
		admin.mutation(api.contentCleanup.purgeArchived, {
			documentId: created.documentId,
			expectedUpdatedAt: doc!.updatedAt,
		}),
	).rejects.toThrow("Archive");
	await admin.mutation(api.blogContent.archive, { documentId: created.documentId });
	doc = await t.run((ctx) => ctx.db.get(created.documentId));
	await expect(
		t
			.withIdentity({ subject: "other" })
			.mutation(api.contentCleanup.purgeArchived, {
				documentId: created.documentId,
				expectedUpdatedAt: doc!.updatedAt,
			}),
	).rejects.toThrow();
	await expect(
		admin.mutation(api.contentCleanup.purgeArchived, {
			documentId: created.documentId,
			expectedUpdatedAt: -1,
		}),
	).rejects.toThrow("changed");
	await admin.mutation(api.contentCleanup.purgeArchived, {
		documentId: created.documentId,
		expectedUpdatedAt: doc!.updatedAt,
	});
	expect(await t.run((ctx) => ctx.db.get(created.revisionId))).toBeNull();
	expect((await t.run((ctx) => ctx.db.get(created.documentId)))?.purgedAt).toBeTypeOf("number");
	await expect(
		admin.mutation(api.blogContent.restore, { documentId: created.documentId }),
	).rejects.toThrow("permanently deleted");
	await expect(
		admin.mutation(api.blogContent.createDraft, {
			siteUrl: "a.example",
			documentKey: "author-a",
			draft: { kind: "author", name: "Replacement", slug: "author-a" },
		}),
	).rejects.toThrow();
});
test("pruning protects active revisions and incoming history prevents supporting-content purge", async () => {
	const { t, admin } = await setup();
	const created = await admin.mutation(api.blogContent.createDraft, {
		siteUrl: "a.example",
		documentKey: "author-b",
		draft: { kind: "author", name: "Author", slug: "author-b" },
	});
	const doc = await t.run((ctx) => ctx.db.get(created.documentId));
	await expect(
		admin.mutation(api.contentCleanup.pruneRevision, {
			documentId: created.documentId,
			revisionId: created.revisionId,
			expectedUpdatedAt: doc!.updatedAt,
		}),
	).rejects.toThrow("Active");
	const next = await admin.mutation(api.blogContent.saveDraft, {
		documentId: created.documentId,
		expectedDraftRevisionId: created.revisionId,
		draft: { kind: "author", name: "Updated", slug: "author-b" },
	});
	const changed = await t.run((ctx) => ctx.db.get(created.documentId));
	await t.run((ctx) =>
		ctx.db.patch(next.revisionId, { restoredFromRevisionId: created.revisionId }),
	);
	await expect(
		admin.mutation(api.contentCleanup.pruneRevision, {
			documentId: created.documentId,
			revisionId: created.revisionId,
			expectedUpdatedAt: changed!.updatedAt,
		}),
	).rejects.toThrow("provenance");
	await t.run((ctx) => ctx.db.patch(next.revisionId, { restoredFromRevisionId: undefined }));
	await admin.mutation(api.contentCleanup.pruneRevision, {
		documentId: created.documentId,
		revisionId: created.revisionId,
		expectedUpdatedAt: changed!.updatedAt,
	});
	expect(await t.run((ctx) => ctx.db.get(created.revisionId))).toBeNull();
	await admin.mutation(api.blogContent.archive, { documentId: created.documentId });
	await t.run((ctx) =>
		ctx.db.insert("contentReferences", {
			siteUrl: "a.example",
			fromDocumentId: created.documentId,
			fromRevisionId: next.revisionId,
			toDocumentId: created.documentId,
			field: "author",
			referenceKey: "test-history",
			order: 0,
		}),
	);
	const archived = await t.run((ctx) => ctx.db.get(created.documentId));
	await expect(
		admin.mutation(api.contentCleanup.purgeArchived, {
			documentId: created.documentId,
			expectedUpdatedAt: archived!.updatedAt,
		}),
	).rejects.toThrow("retained");
});

test("owner erasure deletes disposable records but retains signed evidence", async () => {
	const { t, owner, admin, clientId } = await setup();
	const photographyClient = await admin.mutation(api.crm.createClient, {
		siteUrl: "a.example",
		name: "Customer",
		email: "customer@example.com",
		category: "photography",
		type: "portrait",
	});
	const signed = await admin.mutation(api.contracts.create, {
		siteUrl: "a.example",
		clientId: photographyClient,
		title: "Agreement",
		body: "Signed terms",
	});
	await admin.mutation(api.contracts.markSigned, { siteUrl: "a.example", contractId: signed });
	const draft = await admin.mutation(api.contracts.create, {
		siteUrl: "a.example",
		clientId: photographyClient,
		title: "Draft",
		body: "Draft terms",
	});
	await expect(
		owner.mutation(api.platformOffboarding.eraseRecords, {
			clientId,
			confirmSiteUrl: "a.example",
			collection: "contracts",
			cursor: null,
		}),
	).rejects.toThrow("approved");
	await owner.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: "a.example" });
	await owner.mutation(api.platformOffboarding.requestErasure, {
		clientId,
		confirmSiteUrl: "a.example",
		eraseImmediately: true,
	});
	await expect(
		admin.mutation(api.platformOffboarding.eraseRecords, {
			clientId,
			confirmSiteUrl: "a.example",
			collection: "contracts",
			cursor: null,
		}),
	).rejects.toThrow();
	expect(
		await owner.mutation(api.platformOffboarding.eraseRecords, {
			clientId,
			confirmSiteUrl: "a.example",
			collection: "contracts",
			cursor: null,
		}),
	).toMatchObject({ deleted: 1, retained: 1, isDone: true });
	expect(await t.run((ctx) => ctx.db.get(draft))).toBeNull();
	expect(await t.run((ctx) => ctx.db.get(signed))).not.toBeNull();
	expect(
		await owner.mutation(api.platformOffboarding.eraseRecords, {
			clientId,
			confirmSiteUrl: "a.example",
			collection: "contracts",
			cursor: null,
		}),
	).toMatchObject({ deleted: 0, retained: 1 });
});

test("offboarding hides public content immediately, including aliases, without deleting it", async () => {
 const { t, owner, admin, clientId } = await setup();
 const author = await admin.mutation(api.blogContent.createDraft, { siteUrl: "a.example", documentKey: "public-author", draft: { kind: "author", name: "Public Author", slug: "public-author" } });
 await admin.mutation(api.blogContent.publish, { documentId: author.documentId, draftRevisionId: author.revisionId });
 expect(await t.query(api.blogContent.getPublishedBySlug, { siteUrl: "a.example", kind: "author", slug: "public-author" })).not.toBeNull();
 await owner.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: "a.example" });
 expect(await t.query(api.platformOffboarding.isActive, { siteUrl: "https://a.example/" })).toEqual({ active: false });
 expect(await t.query(api.blogContent.getPublishedBySlug, { siteUrl: "a.example", kind: "author", slug: "public-author" })).toBeNull();
 expect(await t.query(api.blogContent.resolvePublishedSlug, { siteUrl: "a.example", kind: "author", slug: "public-author" })).toBeNull();
 expect(await t.query(api.blogContent.listPublished, { siteUrl: "a.example", kind: "author" })).toEqual([]);
 expect(await t.query(api.postContent.listPublished, { siteUrl: "a.example", limit: 10 })).toEqual([]);
 expect(await t.query(api.portfolioGalleries.listPublished, { siteUrl: "a.example" })).toEqual([]);
 expect(await t.query(api.portfolioGalleries.listPublishedWithPlacements, { siteUrl: "a.example" })).toEqual([]);
 expect(await t.query(api.catalogProductGraphs.listPublished, { siteUrl: "a.example" })).toEqual([]);
 expect(await t.query(api.content.getPublishedSiteSettings, { siteUrl: "a.example" })).toBeNull();
 expect(await t.run(ctx => ctx.db.get(author.revisionId))).not.toBeNull();
 expect((await t.run(ctx => ctx.db.get(clientId)))?.offboarding?.retainUntil).toBeGreaterThan(Date.now());
 await owner.mutation(api.platformOffboarding.restoreAccess, { clientId, confirmSiteUrl: "a.example" });
 expect(await t.query(api.blogContent.getPublishedBySlug, { siteUrl: "a.example", kind: "author", slug: "public-author" })).not.toBeNull();
});
