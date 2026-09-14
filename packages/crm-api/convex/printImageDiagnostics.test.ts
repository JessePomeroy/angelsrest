/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const siteUrl = "angelsrest.online";
const descriptor = {
	key: `sites/${siteUrl}/catalog/print-sources/render/original`, hash: "a".repeat(64),
	bytes: 1000, mime: "image/jpeg" as const, dimensions: { width: 1800, height: 1200 },
};
const product = { subcategoryId: 103007, orderItemOptions: [39] };
const item = { paperSubcategoryId: 103007, width: 6, height: 4, quantity: 1, product };

async function setup() {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			name: "Owner", email: "owner@example.test", siteUrl, tier: "full", subscriptionStatus: "active",
			adminEmails: ["owner@example.test"], adminIdentityIds: ["https://auth.example.test|owner"],
		});
		const orderId = await ctx.db.insert("orders", {
			siteUrl, orderNumber: "ORD-DIAGNOSTIC", stripeSessionId: "cs_live_syntheticdiagnostic",
			customerEmail: "private@example.test", total: 1000, status: "new", fulfillmentType: "lumaprints",
			items: [{ productName: "Print", quantity: 1, price: 1000 }],
			printInput: { version: 1, lines: [{ amountCents: 1000, sources: [{ descriptor,
				item: { paperSubcategoryId: 103007, width: 6, height: 4 }, product }] }] },
			printFulfillmentPhase: "submitting", printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentClaim: true, printFulfillmentClaimToken: "durable-private-claim",
			lumaprintsSubmissionOrderNumber: "12345",
		});
		const jobId = await ctx.db.insert("printFulfillmentJobs", {
			orderId, stage: "done", cursor: 1, ordinalCount: 1, sourceCount: 1, attempts: 0, startedAt: 1, nextAt: 1,
		});
		await ctx.db.patch(orderId, { printJobId: jobId });
		const sourceId = await ctx.db.insert("printFulfillmentSources", {
			jobId, index: 0, descriptor, item, artifact: { recipeVersion: 1, descriptor },
			url: "https://private.example.test/expired-token.jpg", expiresAt: 1,
		});
		return { orderId, jobId, sourceId };
	});
	const admin = t.withIdentity({ subject: "owner", issuer: "https://auth.example.test",
		tokenIdentifier: "https://auth.example.test|owner", email: "owner@example.test", emailVerified: true });
	return { t, admin, ...ids };
}

test("only the stored site admin can read the prepared diagnostic source", async () => {
	const { t, admin, orderId } = await setup();
	await expect(t.query(api.printImageDiagnostics.source, { orderId })).rejects.toThrow();
	await expect(t.withIdentity({ email: "owner@example.test", emailVerified: true,
		tokenIdentifier: "https://auth.example.test|stranger" }).query(api.printImageDiagnostics.source, { orderId })).rejects.toThrow();
	expect(await admin.query(api.printImageDiagnostics.source, { orderId })).toEqual({
		descriptor, product, printWidth: 6, printHeight: 4,
	});
});

test("diagnostic reads leave order, job, source, URL and durable claim unchanged", async () => {
	const { t, admin, orderId, jobId, sourceId } = await setup();
	const snapshot = () => t.run(async (ctx) => [await ctx.db.get(orderId), await ctx.db.get(jobId), await ctx.db.get(sourceId)]);
	const before = await snapshot();
	const result = await admin.query(api.printImageDiagnostics.source, { orderId });
	expect(await snapshot()).toEqual(before);
	expect(JSON.stringify(result)).not.toMatch(/private@example|durable-private|expired-token|customerEmail|orderId/);
});

test("rejects another tenant's order even for the hub admin", async () => {
	const { t, admin, orderId } = await setup();
	await t.run((ctx) => ctx.db.patch(orderId, { siteUrl: "other.example" }));
	expect(await admin.query(api.printImageDiagnostics.source, { orderId })).toBeNull();
});

test("will not substitute an original for missing prepared artwork", async () => {
	const { t, admin, orderId, sourceId } = await setup();
	await t.run((ctx) => ctx.db.patch(sourceId, { artifact: undefined }));
	expect(await admin.query(api.printImageDiagnostics.source, { orderId })).toBeNull();
});

test("rejects active jobs and already-confirmed orders", async () => {
	const { t, admin, orderId, jobId } = await setup();
	await t.run((ctx) => ctx.db.patch(jobId, { stage: "prepare" }));
	expect(await admin.query(api.printImageDiagnostics.source, { orderId })).toBeNull();
	await t.run(async (ctx) => {
		await ctx.db.patch(jobId, { stage: "done" });
		await ctx.db.patch(orderId, { lumaprintsOrderNumber: "12345" });
	});
	expect(await admin.query(api.printImageDiagnostics.source, { orderId })).toBeNull();
});
