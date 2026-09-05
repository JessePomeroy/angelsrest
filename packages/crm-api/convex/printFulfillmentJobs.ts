import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWebhookCallerOrAuth } from "./authHelpers";
import {
	PRINT_JOB_BATCH_SIZE, PRINT_JOB_MAX_AGE_MS, PRINT_JOB_MAX_SOURCES,
	printJobDescriptor, printJobItem, printJobSource,
} from "./helpers/printFulfillmentJobs";

const LEASE_MS = 90_000;
const authority = {
	jobId: v.id("printFulfillmentJobs"), leaseToken: v.string(), webhookSecret: v.string(),
};
type Job = Doc<"printFulfillmentJobs">;
type Authority = { jobId: Job["_id"]; leaseToken: string; webhookSecret: string };
const terminal = (job: Job) => job.stage === "done" || job.stage === "blocked";
const uncertain = (order: Doc<"orders">) => order.printFulfillmentClaim === true
	&& !order.lumaprintsOrderNumber && order.printFulfillmentResolution !== "resolved"
	&& order.printFulfillmentPhase !== "preparing";

async function owned(ctx: QueryCtx | MutationCtx, args: Authority) {
	await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
	const job = await ctx.db.get(args.jobId);
	if (!job || terminal(job) || job.leaseToken !== args.leaseToken
		|| !job.leaseExpiresAt || job.leaseExpiresAt <= Date.now()) {
		throw new Error("Print job lease is unavailable");
	}
	const order = await ctx.db.get(job.orderId);
	if (!order || order.printJobId !== job._id) throw new Error("Print job order is unavailable");
	return { job, order };
}

async function schedule(ctx: MutationCtx, job: Job, patch: Partial<Job>, nextAt = Date.now()) {
	if (patch.stage === "blocked") {
		const order = await ctx.db.get(job.orderId);
		if (order && order.printJobId === job._id) {
			await ctx.db.patch(order._id, {
				fulfillmentError: `Print fulfillment needs operator review (${patch.errorCode ?? "job_blocked"}).`,
			});
		}
	}
	await ctx.db.patch(job._id, {
		...patch, nextAt, leaseToken: undefined, leaseExpiresAt: undefined,
	});
	if (patch.stage !== "done" && patch.stage !== "blocked") {
		await ctx.scheduler.runAt(nextAt, internal.printFulfillmentJobs.dispatch, { jobId: job._id, nextAt });
	}
}

async function retry(ctx: MutationCtx, job: Job, code: string) {
	const attempts = job.attempts + 1;
	const blocked = attempts >= 12 || Date.now() - job.startedAt >= PRINT_JOB_MAX_AGE_MS;
	await schedule(ctx, job, {
		attempts, errorCode: code, ...(blocked ? { stage: "blocked" } : {}),
	}, Date.now() + Math.min(30_000 * 2 ** (attempts - 1), 300_000));
}

function validateSource(source: Infer<typeof printJobSource>, siteUrl: string) {
	const { descriptor, item } = source;
	if (!descriptor.key.startsWith(`sites/${siteUrl}/`) || descriptor.key.length > 1024
		|| !/^[a-f0-9]{64}$/.test(descriptor.hash)
		|| !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > 100_000_000
		|| ![descriptor.dimensions.width, descriptor.dimensions.height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 100_000)
		|| ![item.width, item.height].every((n) => Number.isFinite(n) && n > 0 && n <= 200)
		|| !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1000) {
		throw new Error("Print job source is invalid");
	}
}

/** Only the leased host runner can read private artifact descriptors or capabilities. */
export const read = query({
	args: authority,
	handler: async (ctx, args) => {
		const { job, order } = await owned(ctx, args);
		const sources = job.stage === "resolve" ? [] : await ctx.db.query("printFulfillmentSources")
			.withIndex("by_jobId_and_index", (q) => q.eq("jobId", job._id).gte("index", job.stage === "finish" ? 0 : job.cursor))
			.take(job.stage === "finish" ? PRINT_JOB_MAX_SOURCES : job.stage === "issue" ? PRINT_JOB_BATCH_SIZE : 1);
		return { job, order, sources };
	},
});

export const advance = mutation({
	args: {
		...authority,
		result: v.union(
			v.object({ kind: v.literal("resolved"), sources: v.array(printJobSource) }),
			v.object({ kind: v.literal("prepared"), descriptor: printJobDescriptor, item: printJobItem }),
			v.object({ kind: v.literal("issued"), urls: v.array(v.object({ url: v.string(), expiresAt: v.number() })) }),
			v.object({ kind: v.literal("finished") }),
			v.object({ kind: v.literal("refresh") }),
			v.object({ kind: v.literal("retry"), code: v.union(v.literal("runner_unavailable"), v.literal("step_failed")) }),
			v.object({ kind: v.literal("blocked"), code: v.literal("preparation_failed") }),
		),
	},
	handler: async (ctx, args) => {
		const { job, order } = await owned(ctx, args);
		const result = args.result;
		if (result.kind === "retry") return retry(ctx, job, result.code);
		if (result.kind === "blocked") {
			await schedule(ctx, job, { stage: "blocked", errorCode: result.code });
			return;
		}
		if (result.kind === "refresh") {
			if (job.stage !== "finish" || uncertain(order) || order.lumaprintsOrderNumber
				|| order.stripeRefundId || order.status !== "new") throw new Error("Print capabilities cannot be refreshed");
			if (Date.now() - job.startedAt >= PRINT_JOB_MAX_AGE_MS) {
				await schedule(ctx, job, { stage: "blocked", errorCode: "preparation_expired" });
			} else {
				await schedule(ctx, job, { stage: "issue", cursor: 0, attempts: 0 });
			}
			return;
		}
		if (result.kind === "resolved") {
			if (job.stage !== "resolve" || result.sources.length > PRINT_JOB_BATCH_SIZE
				|| job.sourceCount + result.sources.length > PRINT_JOB_MAX_SOURCES) throw new Error("Print job stage mismatch");
			for (const [offset, source] of result.sources.entries()) {
				validateSource(source, order.siteUrl);
				await ctx.db.insert("printFulfillmentSources", { jobId: job._id, index: job.sourceCount + offset, ...source });
			}
			const sourceCount = job.sourceCount + result.sources.length;
			const resolved = job.cursor + 1 === job.ordinalCount;
			await schedule(ctx, job, {
				stage: resolved ? sourceCount ? "prepare" : "finish" : "resolve",
				cursor: resolved ? 0 : job.cursor + 1, sourceCount, attempts: 0, errorCode: undefined,
			});
			return;
		}
		if (result.kind === "prepared") {
			if (job.stage !== "prepare") throw new Error("Print job stage mismatch");
			validateSource(result, order.siteUrl);
			const source = await ctx.db.query("printFulfillmentSources")
				.withIndex("by_jobId_and_index", (q) => q.eq("jobId", job._id).eq("index", job.cursor)).unique();
			if (!source) throw new Error("Print job source is unavailable");
			await ctx.db.patch(source._id, { descriptor: result.descriptor, item: result.item });
			const prepared = job.cursor + 1 === job.sourceCount;
			await schedule(ctx, job, { stage: prepared ? "issue" : "prepare", cursor: prepared ? 0 : job.cursor + 1, attempts: 0, errorCode: undefined });
			return;
		}
		if (result.kind === "issued") {
			if (job.stage !== "issue") throw new Error("Print job stage mismatch");
			const sources = await ctx.db.query("printFulfillmentSources")
				.withIndex("by_jobId_and_index", (q) => q.eq("jobId", job._id).gte("index", job.cursor)).take(PRINT_JOB_BATCH_SIZE);
			if (!sources.length || result.urls.length !== sources.length) throw new Error("Print job capability count mismatch");
			for (const [index, capability] of result.urls.entries()) {
				const url = new URL(capability.url);
				if (url.origin !== "https://cms-media-worker.thinkingofview.workers.dev"
					|| !url.pathname.startsWith("/v1/catalog-assets/fulfillment/") || url.search || url.hash
					|| capability.url.length > 2048 || !Number.isSafeInteger(capability.expiresAt)
					|| capability.expiresAt < Date.now() + 23 * 60 * 60 * 1000
					|| capability.expiresAt > Date.now() + PRINT_JOB_MAX_AGE_MS + 60_000) {
					throw new Error("Print job capability is invalid");
				}
				await ctx.db.patch(sources[index]._id, capability);
			}
			const cursor = job.cursor + sources.length;
			await schedule(ctx, job, { stage: cursor === job.sourceCount ? "finish" : "issue", cursor, attempts: 0, errorCode: undefined });
			return;
		}
		if (job.stage !== "finish") throw new Error("Print job stage mismatch");
		if (uncertain(order) && order.printFulfillmentResolution !== "reconciliation_blocked") {
			const attempts = order.printFulfillmentReconciliationPendingAttempts ?? 0;
			const firstAt = order.printFulfillmentReconciliationPendingFirstAt ?? Date.now();
			const retryAt = (order.printFulfillmentReconciliationLastAttemptAt ?? firstAt)
				+ Math.min(60_000 * 4 ** Math.max(0, attempts - 1), 3_600_000);
			await schedule(ctx, job, { attempts: 0, errorCode: undefined }, Math.max(Date.now() + 1000, retryAt));
		} else if (order.printFulfillmentResolution === "resolved" || order.lumaprintsOrderNumber
			|| order.printFulfillmentResolution === "reconciliation_blocked"
			|| order.status === "canceled" || order.stripeRefundId || order.fulfillmentType !== "lumaprints"
			|| job.sourceCount === 0 && order.orderConfirmationClaimedAt !== undefined) {
			await schedule(ctx, job, { stage: "done", attempts: 0, errorCode: undefined });
		} else {
			await retry(ctx, job, "step_failed");
		}
	},
});

/** Claim and watchdog commit together before any host/provider work starts. */
export const begin = internalMutation({
	args: { jobId: v.id("printFulfillmentJobs"), nextAt: v.number() },
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || terminal(job) || job.nextAt !== args.nextAt || job.nextAt > Date.now()
			|| job.leaseExpiresAt && job.leaseExpiresAt > Date.now()) return null;
		const order = await ctx.db.get(job.orderId);
		if (!order || order.printJobId !== job._id) {
			await schedule(ctx, job, { stage: "blocked", errorCode: "order_unavailable" });
			return null;
		}
		if (job.stage !== "finish" && !uncertain(order)
			&& (order.status === "canceled" || order.stripeRefundId || order.lumaprintsOrderNumber)) {
			await schedule(ctx, job, { stage: "done" });
			return null;
		}
		if (Date.now() - job.startedAt >= PRINT_JOB_MAX_AGE_MS && job.stage !== "finish") {
			await schedule(ctx, job, { stage: "blocked", errorCode: "preparation_expired" });
			return null;
		}
		if (job.leaseToken) {
			await retry(ctx, job, "runner_unavailable");
			return null;
		}
		const leaseToken = crypto.randomUUID();
		const leaseExpiresAt = Date.now() + LEASE_MS;
		await ctx.db.patch(job._id, { leaseToken, leaseExpiresAt, nextAt: leaseExpiresAt });
		await ctx.scheduler.runAt(leaseExpiresAt, internal.printFulfillmentJobs.dispatch, { jobId: job._id, nextAt: leaseExpiresAt });
		return { leaseToken };
	},
});

export const failAttempt = internalMutation({
	args: { jobId: v.id("printFulfillmentJobs"), leaseToken: v.string() },
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (job && !terminal(job) && job.leaseToken === args.leaseToken) await retry(ctx, job, "runner_unavailable");
	},
});

export const dispatch = internalAction({
	args: { jobId: v.id("printFulfillmentJobs"), nextAt: v.number() },
	handler: async (ctx, args) => {
		const lease: { leaseToken: string } | null = await ctx.runMutation(internal.printFulfillmentJobs.begin, args);
		if (!lease) return;
		try {
			const url = new URL(process.env.PRINT_FULFILLMENT_RUNNER_URL ?? "");
			const secret = process.env.PRINT_FULFILLMENT_RUNNER_SECRET;
			if (!["https://angelsrest.online", "https://www.angelsrest.online"].includes(url.origin)
				|| url.pathname !== "/api/internal/print-fulfillment" || url.search || url.hash || url.username || url.password
				|| !secret || secret.length < 32 || secret === process.env.WEBHOOK_SECRET) {
				throw new Error("Print runner configuration is invalid");
			}
			const response = await fetch(url, {
				method: "POST", redirect: "error", signal: AbortSignal.timeout(55_000),
				headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
				body: JSON.stringify({ jobId: args.jobId, leaseToken: lease.leaseToken }),
			});
			if (!response.ok) console.error(`print_job.runner_http_${response.status}`);
			await response.body?.cancel();
		} catch {
			console.error("print_job.runner_unavailable");
		}
		// A successful runner advances under its lease. Missing/failed callbacks
		// converge here; a crashed action converges through the durable watchdog.
		await ctx.runMutation(internal.printFulfillmentJobs.failAttempt, { jobId: args.jobId, leaseToken: lease.leaseToken });
	},
});
