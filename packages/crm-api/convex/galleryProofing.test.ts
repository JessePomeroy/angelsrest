/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "proofing.example.test";
async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, { siteUrl, name: "Proofing", email: "owner@example.test", adminEmails: ["owner@example.test"], tier: "full", subscriptionStatus: "active", role: "client" });
	const admin = t.withIdentity({ subject: "owner", email: "owner@example.test", emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, { siteUrl, name: "Visitor", category: "photography" });
	const galleryId = await admin.mutation(api.galleries.create, { siteUrl, clientId, name: "Portraits", slug: "portraits", downloadEnabled: true, favoritesEnabled: true });
	const imageId = await admin.mutation(api.galleries.addImage, { siteUrl, galleryId, r2Key: `${siteUrl}/${galleryId}/original/portrait.jpg`, filename: "portrait.jpg", sizeBytes: 100, width: 100, height: 100 });
	await admin.mutation(api.galleries.update, { id: galleryId, siteUrl, status: "published" });
	const token = await admin.mutation(api.portal.createToken, { siteUrl, clientId, type: "gallery", documentId: galleryId });
	return { t, admin, galleryId, imageId, token };
}
test("freezes final selections and editing notes once, notifies the owner and retains history after reopening", async () => {
	const { t, admin, galleryId, imageId, token } = await setup();
	await t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: true, editingNotes: "Keep the grain" });
	const args = { galleryId, token, expectedRound: 0, notes: "These are my final choices" };
	const submissionId = await t.mutation(api.galleries.submitProof, args);
	expect(await t.mutation(api.galleries.submitProof, args)).toBe(submissionId);
	expect(await t.query(api.galleries.getProof, { galleryId, token })).toMatchObject({ selectedCount: 1, notes: args.notes });
	expect((await admin.query(api.notifications.getUnreadFlags, { siteUrl })).galleries).toBe(true);
	await expect(t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: false })).rejects.toThrow("submitted");
	await admin.mutation(api.galleries.reopenProof, { galleryId, submissionId });
	await t.mutation(api.galleries.updateImage, { id: imageId, token, editingNotes: "New request" });
	await expect(t.mutation(api.galleries.submitProof, args)).rejects.toThrow("reopened");
	const snapshot = await admin.query(api.galleries.getProofImages, { submissionId, paginationOpts: { cursor: null, numItems: 25 } });
	expect(snapshot.page).toMatchObject([{ filename: "portrait.jpg", editingNotes: "Keep the grain" }]);
	const second = await t.mutation(api.galleries.submitProof, { ...args, expectedRound: 1, notes: "Revised choices" });
	expect(second).not.toBe(submissionId);
	expect((await admin.query(api.galleries.listProofs, { galleryId, paginationOpts: { numItems: 25, cursor: null } })).page).toHaveLength(2);
});
test("requires at least one selection and honors disabled proofing", async () => {
	const { t, admin, galleryId, imageId, token } = await setup();
	await expect(t.mutation(api.galleries.submitProof, { galleryId, token, notes: "", expectedRound: 0 })).rejects.toThrow("at least one");
	await admin.mutation(api.galleries.update, { id: galleryId, siteUrl, favoritesEnabled: false });
	await expect(t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: true })).rejects.toThrow("disabled");
	await expect(t.mutation(api.galleries.submitProof, { galleryId, token, notes: "", expectedRound: 0 })).rejects.toThrow("disabled");
});
test("requires the current password grant and rejects anonymous or foreign owner access", async () => {
	const { t, admin, galleryId, imageId, token } = await setup();
	await t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: true });
	await admin.mutation(internal.galleryPasswordStore.setVerifier, { galleryId, siteUrl, verifier: { algorithm: "scrypt", salt: "test-salt", hash: "test-hash", cost: 16384, blockSize: 8, parallelization: 1, keyLength: 32, version: "v1" } });
	await expect(t.mutation(api.galleries.submitProof, { galleryId, token, notes: "", expectedRound: 0 })).rejects.toThrow("password required");
	const grant = await t.mutation(internal.galleryPasswordStore.createGrant, { token, grant: "synthetic-proof-grant", verifierVersion: "v1" });
	const submissionId = await t.mutation(api.galleries.submitProof, { galleryId, token, accessGrant: grant.accessGrant, notes: "", expectedRound: 0 });
	await expect(t.query(api.galleries.getProofImages, { submissionId, paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow("Not authenticated");
	const outsider = t.withIdentity({ subject: "outsider", email: "outsider@example.test", emailVerified: true });
	await expect(outsider.query(api.galleries.listProofs, { galleryId, paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow("Not authorized");
	await expect(outsider.mutation(api.galleries.reopenProof, { galleryId, submissionId })).rejects.toThrow("Not authorized");
});
test("gallery deletion removes proof history and selected-file snapshots", async () => {
	const { t, admin, galleryId, imageId, token } = await setup();
	await t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: true });
	await t.mutation(api.galleries.submitProof, { galleryId, token, notes: "", expectedRound: 0 });
	await admin.mutation(api.galleries.remove, { id: galleryId });
	expect(await t.run((ctx) => ctx.db.query("galleryProofSubmissions").take(10))).toEqual([]);
	expect(await t.run((ctx) => ctx.db.query("galleryProofImages").take(10))).toEqual([]);
});


test("owner proof management requires the Full gallery capability", async () => {
 const { t, admin, galleryId } = await setup();
 await t.run(async (ctx) => { const site = await ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique(); if (!site) throw new Error("Missing tenant"); await ctx.db.patch(site._id, { tier: "basic" }); });
 await expect(admin.query(api.galleries.getProof, { galleryId })).rejects.toThrow("Full gallery");
 await expect(admin.query(api.galleries.listProofs, { galleryId, paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow("Full gallery");
});
