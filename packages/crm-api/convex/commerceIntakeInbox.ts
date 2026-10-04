import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { hubRunnerUrl } from "../src/hubRunnerUrl";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query,
	type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCreator, requireWebhookCallerOrAuth } from "./authHelpers";
import { intakeEnvelopeDigest, parseCommerceIntakeEnvelope } from "./helpers/commerceIntakeEnvelope";
import {
	INTAKE_DISPATCH_REQUIRED_REMAINING_MS, INTAKE_DISPATCH_TIMEOUT_MS, INTAKE_LEASE_MS,
	INTAKE_MAX_CYCLE_AGE_MS, INTAKE_MAX_CYCLE_ATTEMPTS, INTAKE_MAX_RECOVERIES,
	INTAKE_MAX_RECOVERY_AGE_MS, type IntakeFailure, intakeRecoveryReason, intakeRetryDelay,
	intakeScopeEnabled, intakeState,
} from "./helpers/commerceIntakeJobs";
import { readCheckoutAdmissionRouting, readCheckoutRouting } from "./helpers/orderRouting";
import { assertOrderProducersOpen } from "./helpers/orderProducerGate";
import { resolveTenantContext } from "./helpers/tenantContext";

type Inbox = Doc<"commerceIntakeInbox">;
type Authority = { inboxId: Id<"commerceIntakeInbox">; leaseToken: string; webhookSecret: string };
const authority = { inboxId: v.id("commerceIntakeInbox"), leaseToken: v.string(), webhookSecret: v.string() };
const wakeArgs = { inboxId: v.id("commerceIntakeInbox"), version: v.number(), nextAt: v.number() };
const terminal = (row: Inbox) => row.state === "done" || row.state === "blocked";
class InvalidRetainedEnvelope extends Error {}

function receipt(row: Inbox) {
	return { kind: "accepted" as const, inboxId: row._id, state: row.state, acceptedAt: row.acceptedAt };
}

async function leaseOwned(ctx: QueryCtx | MutationCtx, args: Authority) {
	await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
	const row = await ctx.db.get(args.inboxId);
	if (!row || row.state !== "processing" || row.leaseToken !== args.leaseToken
		|| !row.leaseExpiresAt || row.leaseExpiresAt <= Date.now()) {
		throw new Error("Commerce intake lease is unavailable");
	}
	return row;
}

async function schedule(ctx: MutationCtx, row: Inbox, patch: Partial<Inbox>, nextAt = Date.now()) {
	const version = row.version + 1;
	await ctx.db.patch(row._id, { ...patch, version, nextAt,
		leaseToken: undefined, leaseExpiresAt: undefined });
	if (patch.state !== "done" && patch.state !== "blocked") {
		await ctx.scheduler.runAt(nextAt, internal.commerceIntakeInbox.wake,
			{ inboxId: row._id, version, nextAt });
	}
}

async function retry(ctx: MutationCtx, row: Inbox, code: IntakeFailure) {
	const exhausted = row.cycleAttempts >= INTAKE_MAX_CYCLE_ATTEMPTS;
	const expired = Date.now() - row.cycleStartedAt >= INTAKE_MAX_CYCLE_AGE_MS;
	await schedule(ctx, row, {
		state: exhausted || expired ? "blocked" : "retry",
		errorCode: exhausted ? "attempts_exhausted" : expired ? "age_exceeded" : code,
		lastAttemptCode: code, ...(exhausted || expired ? { blockedAt: Date.now() } : {}),
	}, Date.now() + intakeRetryDelay(row.cycleAttempts));
}

async function retainedEnvelope(row: Inbox) {
	try {
		const parsed = parseCommerceIntakeEnvelope(row.eventJson);
		if (parsed.eventJson !== row.eventJson || await intakeEnvelopeDigest(row.eventJson) !== row.digest
			|| parsed.event.id !== row.stripeEventId || parsed.event.data.object.id !== row.stripeSessionId
			|| parsed.event.livemode !== row.livemode || parsed.event.account !== row.stripeConnectedAccountId
			|| parsed.role !== row.role) throw new InvalidRetainedEnvelope();
		return parsed;
	} catch { throw new InvalidRetainedEnvelope("Stored commerce intake evidence is inconsistent"); }
}

async function routingFor(ctx: QueryCtx, row: Inbox) {
	const parsed = await retainedEnvelope(row);
	const routing = await readCheckoutRouting(ctx, parsed.routingFacts)
		?? await readCheckoutAdmissionRouting(ctx, parsed.routingFacts);
	if (!routing || routing.siteUrl !== row.siteUrl) throw new Error("Stored commerce intake scope changed");
	const tenant = await resolveTenantContext(ctx, { siteUrl: row.siteUrl });
	if (!tenant || (tenant.tenantId ?? undefined) !== row.tenantId) {
		throw new Error("Stored commerce intake scope changed");
	}
	return { parsed, routing };
}

/** Always consult this receipt before host acceptance flags or synchronous fallback. */
export const accept = mutation({
	args: { stripeEventId: v.string(), eventJson: v.union(v.string(), v.null()),
		allowNew: v.boolean(), webhookSecret: v.string() },
	handler: async (ctx, args): Promise<{ kind: "synchronous" } | ReturnType<typeof receipt>> => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!/^evt_[A-Za-z0-9]{16,120}$/.test(args.stripeEventId)) return { kind: "synchronous" };
		const existing = await ctx.db.query("commerceIntakeInbox")
			.withIndex("by_stripeEventId", q => q.eq("stripeEventId", args.stripeEventId)).unique();
		// A newer host may no longer understand a retained version. Never send that
		// accepted event through the synchronous path, even during rollback.
		if (args.eventJson === null) {
			if (existing) throw new Error("Accepted commerce intake evidence must remain readable");
			return { kind: "synchronous" };
		}
		const parsed = parseCommerceIntakeEnvelope(args.eventJson);
		const digest = await intakeEnvelopeDigest(parsed.eventJson);
		const event = parsed.event;
		if (event.id !== args.stripeEventId) throw new Error("Commerce intake event identity changed");
		if (existing) {
			if (existing.digest !== digest || existing.eventJson !== parsed.eventJson
				|| existing.livemode !== event.livemode || existing.stripeConnectedAccountId !== event.account
				|| existing.stripeSessionId !== event.data.object.id || existing.role !== parsed.role) {
				throw new Error("Commerce intake replay conflicts with accepted evidence");
			}
			return receipt(existing);
		}
		if (!args.allowNew || event.data.object.payment_status === "unpaid") return { kind: "synchronous" };
		const routing = await readCheckoutRouting(ctx, parsed.routingFacts)
			?? await readCheckoutAdmissionRouting(ctx, parsed.routingFacts);
		if (!routing || !intakeScopeEnabled(process.env.COMMERCE_INTAKE_SCOPES, routing.siteUrl, event.livemode)) {
			return { kind: "synchronous" };
		}
		// Older orders without mode evidence and retired sessions keep their
		// existing synchronous handling. Already accepted rows were checked above.
		if (routing.source === "retired") return { kind: "synchronous" };
		if (routing.source === "order") {
			const order = await ctx.db.query("orders")
				.withIndex("by_stripeSessionId", q => q.eq("stripeSessionId", event.data.object.id)).unique();
			if (order?.stripePaymentLivemode === undefined) return { kind: "synchronous" };
			if (order.stripePaymentLivemode !== event.livemode) throw new Error("Commerce intake payment mode changed");
		}
		const tenant = await resolveTenantContext(ctx, { siteUrl: routing.siteUrl });
		if (!tenant) throw new Error("Commerce intake tenant is unavailable");
		if (routing.source !== "order") assertOrderProducersOpen();
		const now = Date.now();
		const inboxId = await ctx.db.insert("commerceIntakeInbox", {
			protocolVersion: 1, stripeEventId: event.id, stripeSessionId: event.data.object.id,
			stripeEventCreatedSeconds: event.created, livemode: event.livemode,
			accountScope: event.account ? `connected:${event.account}` : "platform",
			...(event.account ? { stripeConnectedAccountId: event.account } : {}), role: parsed.role,
			siteUrl: routing.siteUrl, ...(tenant.tenantId ? { tenantId: tenant.tenantId } : {}),
			eventJson: parsed.eventJson, digest, state: "pending", version: 1,
			acceptedAt: now, nextAt: now, attempts: 0, cycleAttempts: 0, cycleStartedAt: now, recoveryCount: 0,
		});
		await ctx.scheduler.runAt(now, internal.commerceIntakeInbox.wake, { inboxId, version: 1, nextAt: now });
		return { kind: "accepted", inboxId, state: "pending", acceptedAt: now };
	},
});

/** This mutation commits lease, watchdog and external dispatch together. */
export const wake = internalMutation({
	args: wakeArgs,
	handler: async (ctx, args): Promise<null> => {
		const row = await ctx.db.get(args.inboxId);
		if (!row || terminal(row) || row.version !== args.version || row.nextAt !== args.nextAt
			|| row.nextAt > Date.now()) return null;
		if (row.state === "processing") {
			if (row.leaseExpiresAt && row.leaseExpiresAt <= Date.now()) await retry(ctx, row, "runner_unavailable");
			return null;
		}
		if (row.cycleAttempts >= INTAKE_MAX_CYCLE_ATTEMPTS
			|| Date.now() - row.cycleStartedAt >= INTAKE_MAX_CYCLE_AGE_MS) {
			await retry(ctx, row, "runner_unavailable");
			return null;
		}
		try { await routingFor(ctx, row); } catch (cause) {
			await schedule(ctx, row, { state: "blocked", errorCode: cause instanceof InvalidRetainedEnvelope
				? "payload_invalid" : "scope_conflict", blockedAt: Date.now() });
			return null;
		}
		const now = Date.now();
		const leaseToken = crypto.randomUUID();
		const leaseExpiresAt = now + INTAKE_LEASE_MS;
		const version = row.version + 1;
		await ctx.db.patch(row._id, { state: "processing", version, leaseToken, leaseExpiresAt,
			nextAt: leaseExpiresAt, attempts: row.attempts + 1, cycleAttempts: row.cycleAttempts + 1,
			firstClaimAt: row.firstClaimAt ?? now, lastClaimAt: now, errorCode: undefined });
		await ctx.scheduler.runAt(leaseExpiresAt, internal.commerceIntakeInbox.wake,
			{ inboxId: row._id, version, nextAt: leaseExpiresAt });
		await ctx.scheduler.runAfter(0, internal.commerceIntakeInbox.dispatch, { inboxId: row._id, leaseToken });
		return null;
	},
});

export const dispatchReady = internalQuery({
	args: { inboxId: v.id("commerceIntakeInbox"), leaseToken: v.string() },
	handler: async (ctx, args): Promise<boolean> => {
		const row = await ctx.db.get(args.inboxId);
		return !!row && row.state === "processing" && row.leaseToken === args.leaseToken
			&& (row.leaseExpiresAt ?? 0) - Date.now() >= INTAKE_DISPATCH_REQUIRED_REMAINING_MS;
	},
});

export const failDispatch = internalMutation({
	args: { inboxId: v.id("commerceIntakeInbox"), leaseToken: v.string() },
	handler: async (ctx, args): Promise<null> => {
		const row = await ctx.db.get(args.inboxId);
		if (row?.state === "processing" && row.leaseToken === args.leaseToken
			&& (row.leaseExpiresAt ?? 0) > Date.now()) await retry(ctx, row, "runner_unavailable");
		return null;
	},
});

export const dispatch = internalAction({
	args: { inboxId: v.id("commerceIntakeInbox"), leaseToken: v.string() },
	handler: async (ctx, args): Promise<null> => {
		const ready: boolean = await ctx.runQuery(internal.commerceIntakeInbox.dispatchReady, args);
		if (!ready) return null;
		try {
			const url = hubRunnerUrl(process.env.COMMERCE_INTAKE_RUNNER_URL,
				process.env.CONVEX_SITE_URL, "/api/internal/commerce-intake");
			const secret = process.env.COMMERCE_INTAKE_RUNNER_SECRET;
			if (!secret || secret.length < 32 || secret === process.env.WEBHOOK_SECRET
				|| secret === process.env.PRINT_FULFILLMENT_RUNNER_SECRET) {
				throw new Error("Commerce intake runner configuration is invalid");
			}
			const response = await fetch(url, { method: "POST", redirect: "error",
				signal: AbortSignal.timeout(INTAKE_DISPATCH_TIMEOUT_MS),
				headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
				body: JSON.stringify(args) });
			if (!response.ok) console.error(`commerce_intake.runner_http_${response.status}`);
			await response.body?.cancel();
		} catch { console.error("commerce_intake.runner_unavailable"); }
		// HTTP success is not completion; only a lease-owned checkpoint can release this claim.
		await ctx.runMutation(internal.commerceIntakeInbox.failDispatch, args);
		return null;
	},
});

export const read = query({
	args: authority,
	handler: async (ctx, args) => {
		const row = await leaseOwned(ctx, args);
		await routingFor(ctx, row);
		return { eventJson: row.eventJson, digest: row.digest, siteUrl: row.siteUrl,
			tenantId: row.tenantId ?? null, livemode: row.livemode, leaseExpiresAt: row.leaseExpiresAt };
	},
});

type Completion =
	| { kind: "done"; completion: "order_intake" | "retired_session"; orderId?: Id<"orders"> }
	| { kind: "retry" | "blocked"; code: IntakeFailure; orderId?: Id<"orders"> };

async function completionFromEvidence(ctx: QueryCtx, row: Inbox): Promise<Completion> {
	let context: Awaited<ReturnType<typeof routingFor>>;
	try { context = await routingFor(ctx, row); }
	catch (cause) { return { kind: "blocked", code: cause instanceof InvalidRetainedEnvelope ? "payload_invalid" : "scope_conflict" }; }
	if (context.routing.source === "retired") return { kind: "done", completion: "retired_session" };
	const order = await ctx.db.query("orders")
		.withIndex("by_stripeSessionId", q => q.eq("stripeSessionId", row.stripeSessionId)).unique();
	if (!order) return { kind: "blocked", code: "missing_order" };
	const orderId = order._id;
	if (order.siteUrl !== row.siteUrl || order.stripePaymentLivemode !== row.livemode
		|| order.tenantId !== undefined && order.tenantId !== row.tenantId
		|| order.stripeConnectedAccountId !== undefined && order.stripeConnectedAccountId !== row.stripeConnectedAccountId) {
		return { kind: "blocked", code: "scope_conflict", orderId };
	}
	const financialTerminal = order.status === "refunded"
		&& (order.stripeRefundId !== undefined || order.automatedRefundStatus === "succeeded");
	if (financialTerminal) return { kind: "done", completion: "order_intake", orderId };
	// Local cancellation stops fulfillment; it proves neither refund nor receipt delivery.
	if (order.status === "canceled" || order.fulfillmentRecoveryStatus !== undefined || order.stripeRefundId !== undefined
		|| order.automatedRefundId !== undefined) return { kind: "blocked", code: "financial_recovery", orderId };
	if (context.parsed.event.data.object.payment_status === "paid"
		&& (order.orderReceiptCustomerSentAt === undefined || order.orderReceiptAdminSentAt === undefined)) {
		return { kind: order.orderReceiptStartedAt === undefined
			|| Date.now() - order.orderReceiptStartedAt >= INTAKE_MAX_CYCLE_AGE_MS ? "blocked" : "retry",
			code: order.orderReceiptStartedAt === undefined
			|| Date.now() - order.orderReceiptStartedAt >= INTAKE_MAX_CYCLE_AGE_MS ? "receipt_uncertain" : "receipt_pending",
			orderId };
	}
	if (order.printJobId) {
		const job = await ctx.db.get(order.printJobId);
		if (job?.orderId === order._id) return { kind: "done", completion: "order_intake", orderId };
	} else if (order.fulfillmentType !== "lumaprints" && order.orderConfirmationClaimedAt !== undefined
		|| order.lumaprintsOrderNumber !== undefined || order.printFulfillmentResolution === "resolved") {
		return { kind: "done", completion: "order_intake", orderId };
	}
	return { kind: "blocked", code: "handoff_unproven", orderId };
}

async function applyCompletion(ctx: MutationCtx, row: Inbox, result: Completion) {
	if (result.kind === "retry") {
		if (result.orderId) await ctx.db.patch(row._id, { orderId: result.orderId });
		await retry(ctx, row, result.code);
	} else {
		await schedule(ctx, row, result.kind === "done"
			? { state: "done", completion: result.completion, orderId: result.orderId,
				completedAt: Date.now(), errorCode: undefined, blockedAt: undefined }
			: { state: "blocked", errorCode: result.code, orderId: result.orderId, blockedAt: Date.now() });
	}
}

/** The worker can report an attempt; persisted order/receipt facts alone authorize done. */
export const advance = mutation({
	args: { ...authority, result: v.union(
		v.object({ kind: v.literal("processed"), version: v.literal(1) }),
		v.object({ kind: v.literal("retry"), code: v.literal("processing_failed") }),
		v.object({ kind: v.literal("blocked"), code: v.union(v.literal("payload_invalid"), v.literal("scope_conflict")) }),
	) },
	handler: async (ctx, args): Promise<null> => {
		const row = await leaseOwned(ctx, args);
		if (args.result.kind === "retry") await retry(ctx, row, args.result.code);
		else if (args.result.kind === "blocked") {
			await schedule(ctx, row, { state: "blocked", errorCode: args.result.code, blockedAt: Date.now() });
		} else await applyCompletion(ctx, row, await completionFromEvidence(ctx, row));
		return null;
	},
});

function operatorProjection(row: Inbox) {
	return {
		inboxId: row._id, version: row.version, protocolVersion: row.protocolVersion,
		siteUrl: row.siteUrl, tenantId: row.tenantId ?? null, mode: row.livemode ? "live" as const : "test" as const,
		accountScope: row.accountScope, stripeEventId: row.stripeEventId, stripeSessionId: row.stripeSessionId,
		state: row.state, acceptedAt: row.acceptedAt, firstClaimAt: row.firstClaimAt ?? null,
		lastClaimAt: row.lastClaimAt ?? null, nextAt: row.nextAt, leaseExpiresAt: row.leaseExpiresAt ?? null,
		attempts: row.attempts, cycleAttempts: row.cycleAttempts, recoveryCount: row.recoveryCount,
		errorCode: row.errorCode ?? null, lastAttemptCode: row.lastAttemptCode ?? null,
		orderId: row.orderId ?? null, completedAt: row.completedAt ?? null, blockedAt: row.blockedAt ?? null,
		completion: row.completion ?? null,
		overdue: !terminal(row) && Date.now() - row.nextAt > 300_000,
	};
}

/** Bounded creator-only status; replay payloads and lease tokens never enter this projection. */
export const list = query({
	args: { siteUrl: v.string(), state: v.optional(intakeState), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireCreator(ctx);
		if (!Number.isSafeInteger(args.paginationOpts.numItems)
			|| args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 50) {
			throw new Error("Commerce intake pages must contain 1 to 50 records");
		}
		const state = args.state;
		const page = state === undefined
			? await ctx.db.query("commerceIntakeInbox").withIndex("by_siteUrl_and_acceptedAt", q => q.eq("siteUrl", args.siteUrl))
				.order("desc").paginate(args.paginationOpts)
			: await ctx.db.query("commerceIntakeInbox").withIndex("by_siteUrl_and_state_and_nextAt", q => q
				.eq("siteUrl", args.siteUrl).eq("state", state)).order("asc").paginate(args.paginationOpts);
		return { ...page, page: page.page.map(operatorProjection) };
	},
});

export const inspect = query({
	args: { inboxId: v.id("commerceIntakeInbox"), siteUrl: v.string() },
	handler: async (ctx, args) => {
		await requireCreator(ctx);
		const row = await ctx.db.get(args.inboxId);
		if (!row || row.siteUrl !== args.siteUrl) throw new Error("Commerce intake record is unavailable");
		const recoveries = await ctx.db.query("commerceIntakeRecoveries")
			.withIndex("by_inboxId_and_at", q => q.eq("inboxId", row._id)).order("desc").take(INTAKE_MAX_RECOVERIES + 1);
		return { ...operatorProjection(row), recoveries: recoveries.map(({ at, reason, operatorTokenIdentifier,
			previousVersion, previousState, previousErrorCode }) => ({ at, reason, operatorTokenIdentifier,
				previousVersion, previousState, previousErrorCode: previousErrorCode ?? null })) };
	},
});

/** Audited recovery grants a bounded inbox cycle; it never resets an order or provider fence. */
export const recover = mutation({
	args: { inboxId: v.id("commerceIntakeInbox"), siteUrl: v.string(), expectedVersion: v.number(),
		reason: intakeRecoveryReason },
	handler: async (ctx, args): Promise<{ changed: boolean; state: Inbox["state"] }> => {
		const { identity } = await requireCreator(ctx);
		const row = await ctx.db.get(args.inboxId);
		if (!row || row.siteUrl !== args.siteUrl || row.version !== args.expectedVersion
			|| !Number.isSafeInteger(args.expectedVersion)) throw new Error("Commerce intake recovery target changed");
		if (row.state === "done") return { changed: false, state: "done" };
		if (row.state !== "blocked" && Date.now() - row.nextAt <= 300_000) {
			throw new Error("Commerce intake work is not blocked or overdue");
		}
		if (args.reason === "persisted_outcome_verified") {
			const outcome = await completionFromEvidence(ctx, row);
			if (outcome.kind !== "done") return { changed: false, state: row.state };
			await applyCompletion(ctx, row, outcome);
		} else {
			if (row.recoveryCount >= INTAKE_MAX_RECOVERIES || Date.now() - row.acceptedAt >= INTAKE_MAX_RECOVERY_AGE_MS
				|| row.errorCode === "receipt_uncertain" || row.errorCode === "financial_recovery"
				|| row.errorCode === "payload_invalid") throw new Error("Commerce intake requires separate evidence reconciliation");
			await routingFor(ctx, row);
			await schedule(ctx, row, { state: "retry", cycleAttempts: 0, cycleStartedAt: Date.now(),
				recoveryCount: row.recoveryCount + 1, errorCode: undefined, blockedAt: undefined });
		}
		await ctx.db.insert("commerceIntakeRecoveries", { inboxId: row._id, at: Date.now(),
			operatorTokenIdentifier: identity.tokenIdentifier, previousVersion: row.version,
			previousState: row.state, ...(row.errorCode ? { previousErrorCode: row.errorCode } : {}), reason: args.reason });
		return { changed: true, state: args.reason === "persisted_outcome_verified" ? "done" : "retry" };
	},
});
