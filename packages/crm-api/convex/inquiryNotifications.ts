import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	mutation,
	query,
	type MutationCtx,
} from "./_generated/server";
import {
	constantTimeSecretEquals,
	isServerSecretCandidate,
	purposeScopedServerRolesAreDisjoint,
} from "./helpers/serverSecrets";
import { requireDocumentSiteAdmin } from "./authHelpers";

const LEASE_MS = 120_000;
const REPLAY_WINDOW_MS = 23 * 60 * 60_000;
const RETRY_MS = [30_000, 120_000, 600_000, 1_800_000];
const jobArgs = {
	id: v.id("inquiryNotifications"),
	leaseToken: v.string(),
	runnerSecret: v.string(),
};

async function requireRunner(supplied: string) {
	const configured = process.env.INQUIRY_NOTIFICATION_RUNNER_SECRET;
	if (
		!configured ||
		!isServerSecretCandidate(configured) ||
		!purposeScopedServerRolesAreDisjoint() ||
		!(await constantTimeSecretEquals(supplied, configured))
	)
		throw new Error("Unauthorized notification runner");
}
function canRetry(row: Doc<"inquiryNotifications">) {
	return !row.firstAttemptAt || Date.now() < row.firstAttemptAt + REPLAY_WINDOW_MS;
}
async function retryLater(ctx: MutationCtx, row: Doc<"inquiryNotifications">, reason: string) {
	const retry = row.attempts < 5 && canRetry(row);
	const nextAt =
		Date.now() + RETRY_MS[Math.min(Math.max(0, row.attempts - 1), RETRY_MS.length - 1)];
	await ctx.db.patch(row._id, {
		state: retry ? "pending" : "uncertain",
		errorCode: reason,
		leaseToken: undefined,
		nextAt,
	});
	if (retry)
		await ctx.scheduler.runAt(nextAt, internal.inquiryNotifications.wake, { id: row._id, nextAt });
}

export const wake = internalMutation({
	args: { id: v.id("inquiryNotifications"), nextAt: v.number() },
	handler: async (ctx, { id, nextAt }) => {
		const row = await ctx.db.get(id);
		if (
			!row ||
			row.nextAt !== nextAt ||
			nextAt > Date.now() ||
			!["pending", "sending"].includes(row.state)
		)
			return;
		if (row.state === "sending") {
			await retryLater(ctx, row, "runner_interrupted");
			return;
		}
		const inquiry = await ctx.db.get(row.inquiryId);
		const tenant = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", row.siteUrl))
			.unique();
		if (
			!inquiry ||
			inquiry.siteUrl !== row.siteUrl ||
			tenant?.offboarding ||
			tenant?.subscriptionStatus === "canceled"
		) {
			await ctx.db.patch(id, { state: "failed", errorCode: "inquiry_unavailable" });
			return;
		}
		if (!canRetry(row)) {
			await ctx.db.patch(id, { state: "uncertain", errorCode: "replay_window_closed" });
			return;
		}
		const leaseToken = crypto.randomUUID();
		const deadline = Date.now() + LEASE_MS;
		await ctx.db.patch(id, {
			state: "sending",
			leaseToken,
			attempts: row.attempts + 1,
			firstAttemptAt: row.firstAttemptAt ?? Date.now(),
			nextAt: deadline,
		});
		await ctx.scheduler.runAt(deadline, internal.inquiryNotifications.wake, {
			id,
			nextAt: deadline,
		});
		await ctx.scheduler.runAfter(0, internal.inquiryNotifications.dispatch, { id, leaseToken });
	},
});

export const dispatch = internalAction({
	args: { id: v.id("inquiryNotifications"), leaseToken: v.string() },
	handler: async (ctx, args) => {
		const secret = process.env.INQUIRY_NOTIFICATION_RUNNER_SECRET;
		const origin = process.env.INQUIRY_NOTIFICATION_RUNNER_ORIGIN;
		try {
			if (!secret || secret.length < 32 || secret === process.env.WEBHOOK_SECRET || !origin)
				throw new Error("Runner unavailable");
			const url = new URL(origin);
			if (url.protocol !== "https:" || url.origin !== origin)
				throw new Error("Invalid runner origin");
			const response = await fetch(`${origin}/api/internal/inquiry-notifications`, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(25_000),
				headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
				body: JSON.stringify(args),
			});
			await response.body?.cancel();
			if (!response.ok) throw new Error("Runner unavailable");
		} catch {
			await ctx.runMutation(internal.inquiryNotifications.interrupted, args);
		}
	},
});

export const interrupted = internalMutation({
	args: { id: v.id("inquiryNotifications"), leaseToken: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.id);
		if (row?.state === "sending" && row.leaseToken === args.leaseToken)
			await retryLater(ctx, row, "runner_unavailable");
	},
});

export const getDispatch = query({
	args: jobArgs,
	handler: async (ctx, args) => {
		await requireRunner(args.runnerSecret);
		const row = await ctx.db.get(args.id);
		if (
			!row ||
			row.state !== "sending" ||
			row.leaseToken !== args.leaseToken ||
			row.nextAt <= Date.now() ||
			!canRetry(row)
		)
			return null;
		return {
			siteUrl: row.siteUrl,
			envelope: row.envelope,
			idempotencyKey: `inquiry/${row.inquiryId}`,
		};
	},
});

/** Bind retries to the actual provider credential without persisting that credential. */
export const authorizeSender = mutation({
	args: { ...jobArgs, fingerprint: v.string() },
	handler: async (ctx, args) => {
		await requireRunner(args.runnerSecret);
		const row = await ctx.db.get(args.id);
		if (
			!row ||
			row.state !== "sending" ||
			row.leaseToken !== args.leaseToken ||
			row.nextAt <= Date.now() ||
			!canRetry(row) ||
			!/^[a-f0-9]{64}$/.test(args.fingerprint)
		)
			return false;
		const inquiry = await ctx.db.get(row.inquiryId);
		const tenant = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", row.siteUrl))
			.unique();
		if (
			!inquiry ||
			inquiry.siteUrl !== row.siteUrl ||
			tenant?.offboarding ||
			tenant?.subscriptionStatus === "canceled"
		)
			return false;
		if (row.senderFingerprint && row.senderFingerprint !== args.fingerprint) {
			await ctx.db.patch(row._id, {
				state: "uncertain",
				leaseToken: undefined,
				errorCode: "sender_changed",
			});
			return false;
		}
		if (!row.senderFingerprint)
			await ctx.db.patch(row._id, { senderFingerprint: args.fingerprint });
		return true;
	},
});

export const complete = mutation({
	args: {
		...jobArgs,
		outcome: v.union(
			v.literal("accepted"),
			v.literal("rejected"),
			v.literal("retryable"),
			v.literal("uncertain"),
		),
		providerId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireRunner(args.runnerSecret);
		const row = await ctx.db.get(args.id);
		if (!row || row.state !== "sending" || row.leaseToken !== args.leaseToken) return;
		if (args.outcome === "accepted") {
			if (!args.providerId || args.providerId.length > 200)
				throw new Error("Missing provider acceptance");
			await ctx.db.patch(row._id, {
				state: "accepted",
				providerId: args.providerId,
				acceptedAt: Date.now(),
				leaseToken: undefined,
				errorCode: undefined,
			});
		} else if (args.outcome === "rejected") {
			await ctx.db.patch(row._id, {
				state: "failed",
				errorCode: "provider_rejected",
				leaseToken: undefined,
			});
		} else
			await retryLater(
				ctx,
				row,
				args.outcome === "retryable" ? "provider_unavailable" : "provider_uncertain",
			);
	},
});

export const status = query({
	args: { inquiryId: v.id("inquiries") },
	handler: async (ctx, { inquiryId }) => {
		await requireDocumentSiteAdmin(ctx, "inquiries", inquiryId, "inquiries");
		const row = await ctx.db
			.query("inquiryNotifications")
			.withIndex("by_inquiryId", (q) => q.eq("inquiryId", inquiryId))
			.unique();
		return row
			? {
					state: row.state,
					attempts: row.attempts,
					nextAt: row.nextAt,
					errorCode: row.errorCode ?? null,
					canRetry:
						["failed", "uncertain"].includes(row.state) &&
						row.recoveries < 3 &&
						canRetry(row) &&
						row.errorCode !== "inquiry_unavailable",
				}
			: null;
	},
});

export const retry = mutation({
	args: { inquiryId: v.id("inquiries") },
	handler: async (ctx, { inquiryId }) => {
		await requireDocumentSiteAdmin(ctx, "inquiries", inquiryId, "inquiries");
		const row = await ctx.db
			.query("inquiryNotifications")
			.withIndex("by_inquiryId", (q) => q.eq("inquiryId", inquiryId))
			.unique();
		if (
			!row ||
			!["failed", "uncertain"].includes(row.state) ||
			row.recoveries >= 3 ||
			!canRetry(row) ||
			row.errorCode === "inquiry_unavailable"
		)
			throw new Error(
				"This notification cannot be retried safely. Review provider acceptance first.",
			);
		const nextAt = Date.now();
		await ctx.db.patch(row._id, { state: "pending", recoveries: row.recoveries + 1, nextAt });
		await ctx.scheduler.runAt(nextAt, internal.inquiryNotifications.wake, { id: row._id, nextAt });
	},
});
