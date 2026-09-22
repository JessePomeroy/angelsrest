import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isSiteAdminIdentity, requireAuth } from "../authHelpers";
import { applicationFeeMatchesExpectation, applicationFeeObservationValidator, validApplicationFeeObservation, validApplicationFeeContext } from "./applicationFeeVerification";
import { clientRefundStatusValidator } from "./clientRefundEvidence";
import { requireFinancialOrderAdmin } from "./financialOrderAuthorization";
import { calculatePrintFeeAmount, calculatePrintSubtotalCents } from "./printFeePolicy";
import { isNonnegativeSafeInteger as cents } from "./stripeFeeCapture";
import { resolveTenantContext } from "./tenantContext";

export const CLIENT_PRINT_REFUND_LEASE_MS = 90_000;
export const CLIENT_PRINT_REFUND_RETRY_MS = 23 * 60 * 60 * 1000;
export const CLIENT_PRINT_REFUND_LIMIT = 100;
export const clientPrintRefundAllocationValidator = v.object({ lineAmountsCents: v.array(v.number()), otherAmountCents: v.number() });
export type ClientPrintRefundAllocation = Infer<typeof clientPrintRefundAllocationValidator>;
export const clientPrintRefundIssueValidator = v.union(v.literal("provider_unavailable"), v.literal("provider_mismatch"),
	v.literal("manual_review"), v.literal("retry_window_expired"), v.literal("customer_refund_failed"));
export type ClientPrintRefundIssue = Infer<typeof clientPrintRefundIssueValidator>;
export const clientPrintRefundFields = {
	orderId: v.id("orders"), tenantId: v.string(), requestToken: v.string(), providerProof: v.string(), requestedBy: v.string(),
	stripeSessionId: v.string(), stripeConnectedAccountId: v.string(), stripePlatformAccountId: v.string(),
	stripePaymentIntentId: v.string(), stripeLivemode: v.boolean(),
	allocation: clientPrintRefundAllocationValidator, amountCents: v.number(), printAmountCents: v.number(), feeAmountCents: v.number(),
	state: v.union(v.literal("checking"), v.literal("customer_pending"), v.literal("fee_pending"),
		v.literal("complete"), v.literal("failed"), v.literal("canceled"), v.literal("attention")),
	leaseToken: v.optional(v.string()), leaseUntil: v.optional(v.number()), issue: v.optional(clientPrintRefundIssueValidator),
	customerRequestAt: v.optional(v.number()), feeRequestAt: v.optional(v.number()),
	stripeChargeId: v.optional(v.string()), stripeApplicationFeeId: v.optional(v.string()),
	customerRefundId: v.optional(v.string()), customerStatus: v.optional(clientRefundStatusValidator),
	feeRefundId: v.optional(v.string()), updatedAt: v.number(),
};
export const clientPrintRefundCheckpointValidator = v.object({ stage: v.union(v.literal("customer"), v.literal("fee")),
	observation: applicationFeeObservationValidator });
export const clientPrintRefundResultValidator = v.union(
	v.object({ stage: v.literal("customer"), refundId: v.string(), amountCents: v.number(), status: clientRefundStatusValidator }),
	v.object({ stage: v.literal("fee"), refundId: v.string(), amountCents: v.number() }),
);
export type ClientPrintRefundResult = Infer<typeof clientPrintRefundResultValidator>;
const tokenValid = (value: string) => /^[0-9a-f-]{36}$/.test(value);

export async function clientPrintRefundRows(ctx: Pick<QueryCtx, "db">, orderId: Id<"orders">) {
	const rows = await ctx.db.query("clientPrintRefundOperations").withIndex("by_orderId", q => q.eq("orderId", orderId)).take(CLIENT_PRINT_REFUND_LIMIT + 1);
	if (rows.length > CLIENT_PRINT_REFUND_LIMIT) throw new Error("Refund history needs operator review");
	return rows;
}

function originalOrder(order: Doc<"orders">) {
	if (!validApplicationFeeContext(order) || !order.checkoutFinancialSnapshot || !order.stripePaymentIntentId
		|| order.total < order.checkoutFinancialSnapshot.subtotalCents || order.total < 1) {
		throw new Error("This order requires operator refund review");
	}
	return { ...order.checkoutFinancialSnapshot, paymentIntentId: order.stripePaymentIntentId };
}

function originalMatches(order: Doc<"orders">, operation: Doc<"clientPrintRefundOperations">) {
	const saved = originalOrder(order);
	return operation.orderId === order._id && operation.tenantId === saved.tenantId
		&& operation.stripeSessionId === order.stripeSessionId && operation.stripeConnectedAccountId === saved.stripeConnectedAccountId
		&& operation.stripePlatformAccountId === saved.stripePlatformAccountId && operation.stripeLivemode === saved.stripeLivemode
		&& operation.stripePaymentIntentId === saved.paymentIntentId;
}

export function remainingClientRefundAmounts(order: Doc<"orders">, operations: Doc<"clientPrintRefundOperations">[]) {
	const saved = originalOrder(order);
	const lineAmountsCents = saved.lines.map(line => line.unitPriceCents * line.quantity);
	let otherAmountCents = order.total - saved.subtotalCents; let printRefundedCents = 0; let feeReturnedCents = 0;
	for (const operation of operations) {
		if (!originalMatches(order, operation)) throw new Error("Original refund identity changed");
		if (operation.state === "failed" || operation.state === "canceled") continue;
		operation.allocation.lineAmountsCents.forEach((amount, index) => { lineAmountsCents[index] -= amount; });
		otherAmountCents -= operation.allocation.otherAmountCents;
		printRefundedCents += operation.printAmountCents; feeReturnedCents += operation.feeAmountCents;
	}
	if (lineAmountsCents.some(amount => !cents(amount)) || !cents(otherAmountCents)) throw new Error("Refund allocation needs review");
	return { lineAmountsCents, otherAmountCents, printRefundedCents, feeReturnedCents };
}

export async function requestClientPrintRefund(ctx: MutationCtx, args: {
	orderId: Id<"orders">; requestToken: string; allocation: ClientPrintRefundAllocation;
}) {
	const identity = await requireAuth(ctx);
	const order = await requireFinancialOrderAdmin(ctx, args.orderId);
	const saved = originalOrder(order);
	if (!tokenValid(args.requestToken)) throw new Error("Invalid refund request");
	const operations = await clientPrintRefundRows(ctx, order._id);
	const repeated = operations.find(row => row.requestToken === args.requestToken);
	if (repeated) {
		if (JSON.stringify(repeated.allocation) !== JSON.stringify(args.allocation)) throw new Error("Refund request cannot change");
		return repeated._id;
	}
	if (operations.length >= CLIENT_PRINT_REFUND_LIMIT || operations.some(row => !["complete", "failed", "canceled"].includes(row.state))
		|| order.clientPrintRefundOperationId) throw new Error("Resolve the existing refund before starting another");
	if (order.stripeRefundId || order.automatedRefundId || order.automatedRefundClaimToken
		|| order.automatedRefundFirstAttemptAt !== undefined || order.status === "refunded" || order.status === "canceled"
		|| order.fulfillmentRecoveryStatus && order.clientPrintRefundStartedAt === undefined
		|| !order.lumaprintsOrderNumber && (order.printFulfillmentClaim || order.lumaprintsSubmissionOrderNumber
			|| order.printFulfillmentResolution === "submission_uncertain" || order.printFulfillmentResolution === "reconciliation_blocked")) {
		throw new Error("Fulfillment or another refund needs review before this refund");
	}
	const remaining = remainingClientRefundAmounts(order, operations);
	const { lineAmountsCents, otherAmountCents } = args.allocation;
	if (lineAmountsCents.length !== saved.lines.length || !cents(otherAmountCents) || otherAmountCents > remaining.otherAmountCents
		|| lineAmountsCents.some((amount, index) => !cents(amount) || amount > remaining.lineAmountsCents[index])) {
		throw new Error("Refund amounts exceed the original unrefunded items");
	}
	const amountCents = lineAmountsCents.reduce((sum, amount) => sum + amount, otherAmountCents);
	const printAmountCents = calculatePrintSubtotalCents(lineAmountsCents.map((amount, index) => ({ productKind: saved.lines[index].productKind, unitPriceCents: amount, quantity: 1 })));
	const feeAmountCents = calculatePrintFeeAmount(remaining.printRefundedCents + printAmountCents) - remaining.feeReturnedCents;
	if (!cents(amountCents) || amountCents < 1 || !cents(feeAmountCents)
		|| feeAmountCents + remaining.feeReturnedCents > saved.applicationFeeAmountCents) throw new Error("Invalid refund allocation");
	const operationId = await ctx.db.insert("clientPrintRefundOperations", {
		orderId: order._id, tenantId: saved.tenantId, requestToken: args.requestToken, providerProof: crypto.randomUUID(), requestedBy: identity.tokenIdentifier,
		stripeSessionId: order.stripeSessionId, stripeConnectedAccountId: saved.stripeConnectedAccountId,
		stripePlatformAccountId: saved.stripePlatformAccountId, stripePaymentIntentId: saved.paymentIntentId,
		stripeLivemode: saved.stripeLivemode, allocation: args.allocation, amountCents, printAmountCents, feeAmountCents,
		state: "checking", updatedAt: Date.now(),
	});
	await ctx.db.patch(order._id, { clientPrintRefundOperationId: operationId });
	return operationId;
}

export async function claimClientPrintRefund(ctx: MutationCtx, operationId: Id<"clientPrintRefundOperations">, leaseToken: string) {
	if (!tokenValid(leaseToken)) throw new Error("Invalid refund claim");
	const operation = await ctx.db.get(operationId);
	if (!operation) throw new Error("Refund request not found");
	const order = await ctx.db.get(operation.orderId);
	if (!order || !originalMatches(order, operation)) throw new Error("Original refund identity changed");
	if (["complete", "failed", "canceled"].includes(operation.state)) return { kind: "closed" as const };
	if (order.clientPrintRefundOperationId !== operationId) throw new Error("Refund request is not current");
	if (operation.leaseToken && operation.leaseUntil !== undefined && operation.leaseUntil > Date.now()) return { kind: "busy" as const };
	await ctx.db.patch(operationId, { leaseToken, leaseUntil: Date.now() + CLIENT_PRINT_REFUND_LEASE_MS, issue: undefined, updatedAt: Date.now() });
	return { kind: "claimed" as const, operation, order, previous: (await clientPrintRefundRows(ctx, order._id)).filter(row => row._id !== operationId) };
}

async function currentClaim(ctx: MutationCtx, operationId: Id<"clientPrintRefundOperations">, leaseToken: string) {
	const operation = await ctx.db.get(operationId);
	if (!operation || ["complete", "failed", "canceled"].includes(operation.state) || operation.leaseToken !== leaseToken || operation.leaseUntil === undefined || operation.leaseUntil <= Date.now()) return null;
	const order = await ctx.db.get(operation.orderId);
	if (!order || order.clientPrintRefundOperationId !== operationId || !originalMatches(order, operation)) throw new Error("Original refund claim changed");
	return { order, operation };
}

export async function checkpointClientPrintRefund(ctx: MutationCtx, operationId: Id<"clientPrintRefundOperations">, leaseToken: string,
	checkpoint: Infer<typeof clientPrintRefundCheckpointValidator>) {
	const current = await currentClaim(ctx, operationId, leaseToken);
	if (!current) return false;
	const { order, operation } = current; const observed = checkpoint.observation;
	if (!validApplicationFeeObservation(order, observed) || !applicationFeeMatchesExpectation(order, observed) || observed.payment.kind !== "paid"
		|| operation.stripeChargeId !== undefined && operation.stripeChargeId !== observed.payment.stripeChargeId
		|| operation.stripeApplicationFeeId !== undefined && operation.stripeApplicationFeeId !== observed.payment.stripeApplicationFeeId) throw new Error("Refund provider identity mismatch");
	const startedAt = checkpoint.stage === "customer" ? operation.customerRequestAt : operation.feeRequestAt;
	if (startedAt !== undefined && Date.now() - startedAt >= CLIENT_PRINT_REFUND_RETRY_MS) return false;
	if (checkpoint.stage === "customer" && operation.customerRefundId || checkpoint.stage === "fee" && (operation.customerStatus !== "succeeded"
		|| !operation.customerRefundId || operation.feeRefundId || operation.feeAmountCents < 1 || !observed.payment.stripeApplicationFeeId)) return false;
	await ctx.db.patch(operationId, { stripeChargeId: observed.payment.stripeChargeId,
		stripeApplicationFeeId: observed.payment.stripeApplicationFeeId ?? undefined,
		...(checkpoint.stage === "customer" ? { customerRequestAt: startedAt ?? Date.now() } : { feeRequestAt: startedAt ?? Date.now() }), updatedAt: Date.now() });
	if (checkpoint.stage === "customer") await ctx.db.patch(order._id, { clientPrintRefundStartedAt: order.clientPrintRefundStartedAt ?? Date.now() });
	return true;
}

export async function recordClientPrintRefund(ctx: MutationCtx, operationId: Id<"clientPrintRefundOperations">, leaseToken: string, result: ClientPrintRefundResult) {
	const current = await currentClaim(ctx, operationId, leaseToken);
	if (!current) return false;
	const { operation, order } = current;
	if (result.stage === "customer") {
		if (!/^re_[A-Za-z0-9]{8,120}$/.test(result.refundId) || result.amountCents !== operation.amountCents
			|| operation.customerRequestAt === undefined || operation.customerRefundId !== undefined && operation.customerRefundId !== result.refundId) throw new Error("Customer refund result mismatch");
		const failed = result.status === "failed" || result.status === "canceled";
		const complete = result.status === "succeeded" && operation.feeAmountCents === 0;
		await ctx.db.patch(operationId, { customerRefundId: result.refundId, customerStatus: result.status,
			state: failed ? (operation.feeRequestAt !== undefined ? "attention" : "failed") : complete ? "complete" : result.status === "succeeded" ? "fee_pending" : "customer_pending",
			issue: failed ? "customer_refund_failed" : undefined, updatedAt: Date.now() });
		if (failed && operation.feeRequestAt === undefined || complete) await ctx.db.patch(order._id, { clientPrintRefundOperationId: undefined });
		if (result.status === "succeeded") {
			const prior = await clientPrintRefundRows(ctx, order._id);
			const refunded = prior.filter(row => row.customerStatus === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
			if (refunded === order.total) await ctx.db.patch(order._id, { status: "refunded", stripeRefundId: result.refundId });
		}
	} else {
		if (!/^fr_[A-Za-z0-9]{8,120}$/.test(result.refundId) || result.amountCents !== operation.feeAmountCents
			|| operation.feeRequestAt === undefined
			|| operation.feeRefundId !== undefined && operation.feeRefundId !== result.refundId) throw new Error("Fee refund result mismatch");
		await ctx.db.patch(operationId, { feeRefundId: result.refundId, state: operation.customerStatus === "succeeded" ? "complete" : "attention",
			issue: operation.customerStatus === "succeeded" ? undefined : "customer_refund_failed", updatedAt: Date.now() });
		if (operation.customerStatus === "succeeded") await ctx.db.patch(order._id, { clientPrintRefundOperationId: undefined });
	}
	return true;
}

export async function releaseClientPrintRefund(ctx: MutationCtx, operationId: Id<"clientPrintRefundOperations">, leaseToken: string, issue?: ClientPrintRefundIssue) {
	const operation = await ctx.db.get(operationId);
	if (!operation || operation.leaseToken !== leaseToken) return false;
	await ctx.db.patch(operationId, { leaseToken: undefined, leaseUntil: undefined, updatedAt: Date.now(),
		...(issue && !["complete", "failed", "canceled"].includes(operation.state) ? { state: "attention" as const, issue } : {}) });
	return true;
}

export async function clientRefundSite(ctx: QueryCtx, siteUrl: string) {
	const identity = await requireAuth(ctx); const tenant = await resolveTenantContext(ctx, { siteUrl });
	if (!tenant?.tenantId || !isSiteAdminIdentity(identity, tenant.client)) throw new Error("Not authorized for this client's refunds");
	return tenant;
}

export function publicClientPrintRefund(operation: Doc<"clientPrintRefundOperations">) {
	return { id: operation._id, state: operation.state, amountCents: operation.amountCents, printAmountCents: operation.printAmountCents,
		feeAmountCents: operation.feeAmountCents, customerStatus: operation.customerStatus ?? null,
		customerRefundId: operation.customerRefundId ?? null, feeRefundId: operation.feeRefundId ?? null,
		issue: operation.issue ?? null, updatedAt: operation.updatedAt,
		canCancel: operation.customerRequestAt === undefined && !["complete", "failed", "canceled"].includes(operation.state) };
}

/** Preserve later provider status without treating success or a fee return as irreversible. */
export async function syncClientPrintRefundObservation(ctx: MutationCtx, evidenceId: Id<"clientRefundEvidence">) {
	const evidence = await ctx.db.get(evidenceId);
	if (!evidence?.observation) return;
	const operation = await ctx.db.query("clientPrintRefundOperations").withIndex("by_stripeConnectedAccountId_and_customerRefundId", q => q
		.eq("stripeConnectedAccountId", evidence.stripeConnectedAccountId).eq("customerRefundId", evidence.stripeRefundId)).unique();
	if (!operation) return;
	if (operation.tenantId !== evidence.tenantId || operation.stripeSessionId !== evidence.stripeSessionId
		|| operation.stripePaymentIntentId !== evidence.stripePaymentIntentId || operation.amountCents !== evidence.observation.amountCents
		|| operation.stripeChargeId !== evidence.observation.stripeChargeId) throw new Error("Guided refund evidence identity mismatch");
	const status = evidence.observation.status;
	const changedAfterSuccess = operation.customerStatus === "succeeded" && status !== "succeeded";
	await ctx.db.patch(operation._id, { customerStatus: status, updatedAt: Date.now(),
		...(changedAfterSuccess ? { state: "attention" as const, issue: "customer_refund_failed" as const } : {}) });
}
