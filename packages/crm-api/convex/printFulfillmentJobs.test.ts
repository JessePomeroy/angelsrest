/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "test-print-job-webhook-secret";
const siteUrl = "angelsrest.online";
const source = {
	descriptor: { key: `sites/${siteUrl}/catalog/source/original`, hash: "a".repeat(64), bytes: 1000,
		mime: "image/jpeg" as const, dimensions: { width: 1200, height: 1800 } },
	item: { paperSubcategoryId: 103007, width: 4, height: 6, quantity: 1 },
};
const args = {
	siteUrl, webhookSecret: secret, stripeSessionId: "cs_test_printjob1234567890", customerEmail: "buyer@example.com",
	items: [{ productName: "Print", quantity: 1, price: 1000 }], total: 1000,
	fulfillmentType: "lumaprints" as const,
	checkoutSnapshot: { schemaVersion: 1 as const, catalogProvider: "convex" as const,
		items: [{ productKey: "print", revisionId: "revision", productKind: "print" as const, variantKey: "glossy" }] },
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
	const t = convexTest(schema, modules);
	const order = await t.mutation(api.orders.create, { ...args, runPrintJob: true });
	if (!order.printJobId) throw new Error("Expected print job");
	const jobId = order.printJobId;
	async function claim() {
		await t.run((ctx) => ctx.db.patch(jobId, { nextAt: Date.now() }));
		const lease = await t.mutation(internal.printFulfillmentJobs.begin, { jobId, nextAt: Date.now() });
		if (!lease) throw new Error("Expected lease");
		return { jobId, leaseToken: lease.leaseToken, webhookSecret: secret };
	}
	async function step(result: FunctionArgs<typeof api.printFulfillmentJobs.advance>["result"]) {
		return t.mutation(api.printFulfillmentJobs.advance, { ...await claim(), result });
	}
	return { t, jobId, orderId: order._id, claim, step };
}

test("new webhook orders enqueue once; historical orders never acquire jobs on replay", async () => {
	const { t, jobId } = await setup();
	expect((await t.mutation(api.orders.create, { ...args, runPrintJob: true })).printJobId).toBe(jobId);
	const historical = { ...args, stripeSessionId: "cs_test_printjobhistory12345" };
	await t.mutation(api.orders.create, historical);
	expect((await t.mutation(api.orders.create, { ...historical, runPrintJob: true })).printJobId).toBeUndefined();
	expect(await t.run((ctx) => ctx.db.query("printFulfillmentJobs").take(3))).toHaveLength(1);
});

test("source checkpoints survive retry and reject stale workers and unauthenticated reads", async () => {
	const { t, jobId, claim, step } = await setup();
	await step({ kind: "resolved", sources: [source, source] });
	await step({ kind: "prepared", ...source });
	const stale = await claim();
	await expect(t.query(api.printFulfillmentJobs.read, { ...stale, webhookSecret: "wrong" })).rejects.toThrow();
	await t.mutation(api.printFulfillmentJobs.advance, { ...stale, result: { kind: "retry", code: "step_failed" } });
	await expect(t.mutation(api.printFulfillmentJobs.advance, { ...stale, result: { kind: "prepared", ...source } })).rejects.toThrow("lease");
	const state = await t.query(api.printFulfillmentJobs.read, await claim());
	expect(state.job).toMatchObject({ stage: "prepare", cursor: 1, sourceCount: 2 });
	expect(state.sources.map((row) => row.index)).toEqual([1]);
	expect(await t.run((ctx) => ctx.db.query("printFulfillmentSources").withIndex("by_jobId_and_index", (q) => q.eq("jobId", jobId)).take(3))).toHaveLength(2);
});

test("expired attempts reschedule durably without repeating checkpointed sources", async () => {
	const { t, jobId, claim, step } = await setup();
	await step({ kind: "resolved", sources: [source] });
	const stale = await claim();
	const job = await t.run((ctx) => ctx.db.get(jobId));
	vi.setSystemTime(job!.leaseExpiresAt!);
	expect(await t.mutation(internal.printFulfillmentJobs.begin, { jobId, nextAt: job!.nextAt })).toBeNull();
	const resumed = await t.run((ctx) => ctx.db.get(jobId));
	expect(resumed).toMatchObject({ stage: "prepare", cursor: 0, sourceCount: 1, attempts: 1 });
	expect(resumed?.leaseToken).toBeUndefined();
	await expect(t.query(api.printFulfillmentJobs.read, stale)).rejects.toThrow("lease");
});

test("capabilities refresh without rendering again, but never after the POST fence", async () => {
	const { t, orderId, claim, step } = await setup();
	await step({ kind: "resolved", sources: [source] });
	await step({ kind: "prepared", ...source });
	await step({ kind: "issued", urls: [{ url: "https://cms-media-worker.thinkingofview.workers.dev/v1/catalog-assets/fulfillment/print-source/token", expiresAt: Date.now() + 86_400_000 }] });
	await step({ kind: "refresh" });
	const active = await claim();
	expect((await t.query(api.printFulfillmentJobs.read, active)).job.stage).toBe("issue");
	await t.mutation(api.printFulfillmentJobs.advance, { ...active, result: { kind: "issued", urls: [{ url: "https://cms-media-worker.thinkingofview.workers.dev/v1/catalog-assets/fulfillment/print-source/token2", expiresAt: Date.now() + 86_400_000 }] } });
	await t.run((ctx) => ctx.db.patch(orderId, { printFulfillmentClaim: true, printFulfillmentPhase: "submitting", printFulfillmentResolution: "submission_uncertain" }));
	await expect(step({ kind: "refresh" })).rejects.toThrow("cannot be refreshed");
});

test("confirmed orders can finish notifications; exhausted preparation becomes visible without refunding", async () => {
	const { t, jobId, orderId, claim } = await setup();
	await t.run(async (ctx) => {
		await ctx.db.patch(jobId, { stage: "finish" });
		await ctx.db.patch(orderId, { lumaprintsOrderNumber: "123456", printFulfillmentResolution: "resolved" });
	});
	const active = await claim();
	await t.mutation(api.printFulfillmentJobs.advance, { ...active, result: { kind: "finished" } });
	expect((await t.run((ctx) => ctx.db.get(jobId)))?.stage).toBe("done");
	const second = await t.mutation(api.orders.create, { ...args, stripeSessionId: "cs_test_printjobfail123456", runPrintJob: true });
	const failedId = second.printJobId as Id<"printFulfillmentJobs">;
	await t.run((ctx) => ctx.db.patch(failedId, { attempts: 11, nextAt: Date.now() }));
	const lease = await t.mutation(internal.printFulfillmentJobs.begin, { jobId: failedId, nextAt: Date.now() });
	await t.mutation(internal.printFulfillmentJobs.failAttempt, { jobId: failedId, leaseToken: lease!.leaseToken });
	expect(await t.run((ctx) => ctx.db.get(second._id))).toMatchObject({ status: "new", fulfillmentError: expect.stringContaining("operator review") });
	expect((await t.run((ctx) => ctx.db.get(second._id)))?.stripeRefundId).toBeUndefined();
});

test("job reconciliation waits after receipt and remains pending beyond five GET attempts", async () => {
	const { t, jobId, orderId, step } = await setup();
	await t.run(async (ctx) => {
		await ctx.db.patch(jobId, { stage: "finish" });
		await ctx.db.patch(orderId, { printFulfillmentCoordinatorVersion: 5, printFulfillmentClaim: true,
			printFulfillmentClaimToken: "123e4567-e89b-42d3-a456-426614174000", printFulfillmentPhase: "submitting", printFulfillmentResolution: "submission_uncertain" });
	});
	await t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, { orderId, claimToken: "123e4567-e89b-42d3-a456-426614174000", externalId: args.stripeSessionId, lumaprintsSubmissionOrderNumber: "123456", webhookSecret: secret });
	expect(await t.mutation(api.orders.claimPrintFulfillmentV5, { orderId, claimToken: "123e4567-e89b-42d3-a456-426614174001", webhookSecret: secret })).toMatchObject({ kind: "waiting", retryAt: Date.now() + 60_000 });
	for (let attempt = 0; attempt < 6; attempt++) {
		vi.setSystemTime(Date.now() + 3_600_000);
		expect(await t.mutation(api.orders.recordPrintFulfillmentReconciliationPending, { orderId, externalId: args.stripeSessionId, reason: "result_not_observed", webhookSecret: secret })).toMatchObject({ kind: "pending" });
	}
	await step({ kind: "finished" });
	expect((await t.run((ctx) => ctx.db.get(jobId)))?.stage).toBe("finish");
	expect((await t.run((ctx) => ctx.db.get(orderId)))?.printFulfillmentResolution).toBe("submission_uncertain");
});

test("old hosts cannot claim job orders and an expired job lease cannot cross the POST fence", async () => {
	const { t, jobId, orderId, claim } = await setup();
	const claimArgs = { orderId, claimToken: "123e4567-e89b-42d3-a456-426614174000", webhookSecret: secret };
	expect(await t.mutation(api.orders.claimPrintFulfillmentV5, claimArgs)).toEqual({ kind: "busy" });
	for (const method of [api.orders.claimPrintFulfillmentV2, api.orders.claimPrintFulfillmentV3]) {
		expect(await t.mutation(method, claimArgs)).toEqual({ kind: "busy" });
	}
	expect(await t.mutation(api.orders.claimPrintFulfillment, { orderId, webhookSecret: secret })).toEqual({ kind: "busy" });
	await t.run(async (ctx) => {
		await ctx.db.patch(jobId, { stage: "finish" });
		await ctx.db.insert("commercePurposeControls", { siteUrl, purpose: "new_provider_submission", state: "open", generation: 1, createdAt: Date.now(), updatedAt: Date.now() });
	});
	const jobLease = await claim();
	const ownedArgs = { ...claimArgs, printJobLeaseToken: jobLease.leaseToken };
	expect(await t.mutation(api.orders.claimPrintFulfillmentV5, ownedArgs)).toMatchObject({ kind: "claimed" });
	expect(await t.mutation(api.orders.beginPrintFulfillmentSubmission, claimArgs)).toEqual({ kind: "lost" });
	vi.setSystemTime(Date.now() + 90_000);
	expect(await t.mutation(api.orders.beginPrintFulfillmentSubmission, ownedArgs)).toEqual({ kind: "lost" });
	expect((await t.run((ctx) => ctx.db.get(orderId)))?.printFulfillmentPhase).toBe("preparing");
});
