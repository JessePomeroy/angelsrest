import { randomUUID } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import Stripe from "stripe";
import { api } from "$convex/api";
import type { Doc, Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { getStripeSecretKey } from "$lib/server/runtimeConfig";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import {
	type ApplicationFeeObservation,
	applicationFeeMatchesExpectation,
} from "../../../packages/crm-api/convex/helpers/applicationFeeVerification";
import {
	CLIENT_PRINT_REFUND_RETRY_MS,
	type ClientPrintRefundIssue,
} from "../../../packages/crm-api/convex/helpers/clientPrintRefunds";
import {
	ApplicationFeeReadError,
	readApplicationFee,
} from "../../../packages/crm-api/convex/helpers/readApplicationFee";

const READ_OPTIONS = { timeout: 5_000, maxNetworkRetries: 0 } as const;
const AUTOMATION = "client_print_refund_v1";
type Operation = Doc<"clientPrintRefundOperations">;
type PaidObservation = ApplicationFeeObservation & {
	payment: Extract<ApplicationFeeObservation["payment"], { kind: "paid" }>;
};
export class ClientPrintRefundError extends Error {
	constructor(readonly issue: ClientPrintRefundIssue) {
		super("The refund needs another status check or operator review.");
	}
}
export function isClientPrintRefundsEnabled() {
	return (
		env.CLIENT_PRINT_REFUNDS_ENABLED === "true" && env.CLIENT_REFUND_EVIDENCE_ENABLED === "true"
	);
}
export function assertClientPrintRefundsEnabled() {
	if (!isClientPrintRefundsEnabled()) throw new ClientPrintRefundError("manual_review");
}
let refundStripe: Stripe | undefined;
export function getClientPrintRefundStripe() {
	assertClientPrintRefundsEnabled();
	if (!refundStripe)
		refundStripe = new Stripe(getStripeSecretKey(), {
			apiVersion: STRIPE_API_VERSION,
			...READ_OPTIONS,
		});
	return refundStripe;
}
function id(value: string | { id: string } | null | undefined) {
	return typeof value === "string" ? value : value?.id;
}
function cents(value: number) {
	return Number.isSafeInteger(value) && value >= 0;
}
function invalid(): never {
	throw new ClientPrintRefundError("provider_mismatch");
}
function review(): never {
	throw new ClientPrintRefundError("manual_review");
}
function validStatus(
	status: unknown,
): status is "succeeded" | "pending" | "requires_action" | "failed" | "canceled" {
	return ["succeeded", "pending", "requires_action", "failed", "canceled"].includes(String(status));
}
function retryAllowed(startedAt: number | undefined) {
	if (startedAt !== undefined && Date.now() - startedAt >= CLIENT_PRINT_REFUND_RETRY_MS)
		throw new ClientPrintRefundError("retry_window_expired");
}
function validateCustomer(refund: Stripe.Refund, operation: Operation, observed: PaidObservation) {
	if (
		refund.object !== "refund" ||
		!/^re_[A-Za-z0-9]{8,120}$/.test(refund.id) ||
		id(refund.charge) !== observed.payment.stripeChargeId ||
		id(refund.payment_intent) !== operation.stripePaymentIntentId ||
		refund.currency !== "usd" ||
		refund.amount !== operation.amountCents ||
		!validStatus(refund.status) ||
		(operation.customerRefundId !== undefined && operation.customerRefundId !== refund.id)
	)
		invalid();
	return refund.status;
}
function validateFee(refund: Stripe.FeeRefund, operation: Operation, observed: PaidObservation) {
	if (
		refund.object !== "fee_refund" ||
		!/^fr_[A-Za-z0-9]{8,120}$/.test(refund.id) ||
		id(refund.fee) !== observed.payment.stripeApplicationFeeId ||
		refund.currency !== "usd" ||
		refund.amount !== operation.feeAmountCents ||
		(operation.feeRefundId !== undefined && operation.feeRefundId !== refund.id)
	)
		invalid();
}

/** One bounded current read inside a money operation, never a stored history service. */
async function history(stripe: Stripe, operation: Operation, observed: PaidObservation) {
	const [customers, fees] = await Promise.all([
		stripe.refunds.list(
			{ charge: observed.payment.stripeChargeId, limit: 100 },
			{ ...READ_OPTIONS, stripeAccount: operation.stripeConnectedAccountId },
		),
		observed.payment.stripeApplicationFeeId
			? stripe.applicationFees.listRefunds(
					observed.payment.stripeApplicationFeeId,
					{ limit: 100 },
					READ_OPTIONS,
				)
			: null,
	]);
	if (
		customers.object !== "list" ||
		!Array.isArray(customers.data) ||
		customers.has_more !== false ||
		customers.data.length > 100 ||
		(fees &&
			(fees.object !== "list" ||
				!Array.isArray(fees.data) ||
				fees.has_more !== false ||
				fees.data.length > 100))
	)
		review();
	const customerIds = new Set<string>();
	const feeIds = new Set<string>();
	for (const refund of customers.data) {
		if (
			refund.object !== "refund" ||
			customerIds.has(refund.id) ||
			!/^re_[A-Za-z0-9]{8,120}$/.test(refund.id) ||
			id(refund.charge) !== observed.payment.stripeChargeId ||
			id(refund.payment_intent) !== operation.stripePaymentIntentId ||
			refund.currency !== "usd" ||
			!cents(refund.amount) ||
			refund.amount < 1 ||
			refund.amount > observed.totalCents ||
			!validStatus(refund.status)
		)
			invalid();
		customerIds.add(refund.id);
	}
	for (const refund of fees?.data ?? []) {
		if (
			refund.object !== "fee_refund" ||
			feeIds.has(refund.id) ||
			!/^fr_[A-Za-z0-9]{8,120}$/.test(refund.id) ||
			id(refund.fee) !== observed.payment.stripeApplicationFeeId ||
			refund.currency !== "usd" ||
			!cents(refund.amount) ||
			refund.amount < 1
		)
			invalid();
		feeIds.add(refund.id);
	}
	if (
		(fees?.data ?? []).reduce((sum, refund) => sum + refund.amount, 0) !==
		observed.applicationFeeRefundedCents
	)
		review();
	return { customers: customers.data, fees: fees?.data ?? [] };
}

function knownHistory(
	records: Awaited<ReturnType<typeof history>>,
	previous: Operation[],
	operation: Operation,
	customer: Stripe.Refund | undefined,
	fee: Stripe.FeeRefund | undefined,
) {
	const customerIds = new Set<string>();
	const feeIds = new Set<string>();
	for (const prior of previous) {
		if (prior.customerRefundId) {
			const found = records.customers.find((row) => row.id === prior.customerRefundId);
			if (!found || found.amount !== prior.amountCents || found.status !== prior.customerStatus)
				review();
			customerIds.add(prior.customerRefundId);
		}
		if (prior.feeRefundId) {
			const found = records.fees.find((row) => row.id === prior.feeRefundId);
			if (!found || found.amount !== prior.feeAmountCents) review();
			feeIds.add(prior.feeRefundId);
		}
		if (!["complete", "failed", "canceled"].includes(prior.state)) review();
	}
	if (customer) {
		const listed = records.customers.find((row) => row.id === customer.id);
		if (!listed || listed.status !== customer.status || listed.amount !== operation.amountCents)
			review();
		customerIds.add(customer.id);
	}
	if (fee) feeIds.add(fee.id);
	// Unknown Dashboard refunds are not an allocation guess, including failed attempts.
	if (
		records.customers.some((row) => !customerIds.has(row.id)) ||
		records.fees.some((row) => !feeIds.has(row.id))
	)
		review();
}

function recover<T extends { id: string; metadata: Stripe.Metadata | null }>(
	rows: T[],
	operation: Operation,
	startedAt: number | undefined,
	knownId?: string,
) {
	if (knownId) return rows.find((row) => row.id === knownId);
	if (startedAt === undefined) return undefined;
	const candidates = rows.filter(
		(row) =>
			row.metadata?.hubRefundProof === operation.providerProof &&
			row.metadata?.automated === AUTOMATION,
	);
	if (candidates.length > 1) review();
	return candidates[0];
}

async function execute({
	stripe,
	convex,
	operationId,
}: {
	stripe: Stripe;
	convex: ConvexHttpClient;
	operationId: Id<"clientPrintRefundOperations">;
}) {
	assertClientPrintRefundsEnabled();
	const webhookSecret = getWebhookSecret();
	const leaseToken = randomUUID();
	const claim = await convex.mutation(api.orders.claimClientPrintRefund, {
		operationId,
		leaseToken,
		webhookSecret,
	});
	if (claim.kind === "closed") return;
	if (claim.kind === "busy") throw new ClientPrintRefundError("provider_unavailable");
	const { operation, order, previous } = claim;
	const request = { operationId, leaseToken, webhookSecret };
	const scope = { ...READ_OPTIONS, stripeAccount: operation.stripeConnectedAccountId };
	try {
		let observation = await readApplicationFee(stripe, order);
		if (
			!applicationFeeMatchesExpectation(order, observation) ||
			observation.payment.kind !== "paid"
		)
			invalid();
		let observed: PaidObservation = { ...observation, payment: observation.payment };
		if (
			(operation.stripeChargeId && operation.stripeChargeId !== observed.payment.stripeChargeId) ||
			(operation.stripeApplicationFeeId &&
				operation.stripeApplicationFeeId !== observed.payment.stripeApplicationFeeId)
		)
			invalid();
		let records = await history(stripe, operation, observed);
		let customer = recover(
			records.customers,
			operation,
			operation.customerRequestAt,
			operation.customerRefundId,
		);
		let fee = recover(records.fees, operation, operation.feeRequestAt, operation.feeRefundId);
		if ((operation.customerRefundId && !customer) || (operation.feeRefundId && !fee)) review();
		if (customer) {
			customer = await stripe.refunds.retrieve(customer.id, scope);
			validateCustomer(customer, operation, observed);
		}
		if (fee) validateFee(fee, operation, observed);
		knownHistory(records, previous, operation, customer, fee);
		if (!customer) {
			retryAllowed(operation.customerRequestAt);
			if (
				!(await convex.mutation(api.orders.checkpointClientPrintRefund, {
					...request,
					checkpoint: { stage: "customer", observation: observed },
				}))
			)
				throw new ClientPrintRefundError("retry_window_expired");
			customer = await stripe.refunds.create(
				{
					charge: observed.payment.stripeChargeId,
					amount: operation.amountCents,
					reason: "requested_by_customer",
					refund_application_fee: false,
					metadata: { automated: AUTOMATION, hubRefundProof: operation.providerProof },
				},
				{ ...scope, idempotencyKey: `client-print-refund:${operationId}:customer:v1` },
			);
		}
		const status = validateCustomer(customer, operation, observed);
		if (
			!(await convex.mutation(api.orders.recordClientPrintRefund, {
				...request,
				result: { stage: "customer", refundId: customer.id, amountCents: customer.amount, status },
			}))
		)
			throw new ClientPrintRefundError("provider_unavailable");
		if (status !== "succeeded" || operation.feeAmountCents === 0) return;
		// Refresh after customer success; a fee-only retry never sends another customer POST.
		observation = await readApplicationFee(stripe, order);
		if (
			!applicationFeeMatchesExpectation(order, observation) ||
			observation.payment.kind !== "paid"
		)
			invalid();
		observed = { ...observation, payment: observation.payment };
		records = await history(stripe, operation, observed);
		customer = await stripe.refunds.retrieve(customer.id, scope);
		if (validateCustomer(customer, operation, observed) !== "succeeded") review();
		fee = recover(records.fees, operation, operation.feeRequestAt, operation.feeRefundId);
		if (fee) validateFee(fee, operation, observed);
		knownHistory(records, previous, operation, customer, fee);
		if (!fee) {
			retryAllowed(operation.feeRequestAt);
			if (!observed.payment.stripeApplicationFeeId) invalid();
			if (
				!(await convex.mutation(api.orders.checkpointClientPrintRefund, {
					...request,
					checkpoint: { stage: "fee", observation: observed },
				}))
			)
				throw new ClientPrintRefundError("retry_window_expired");
			fee = await stripe.applicationFees.createRefund(
				observed.payment.stripeApplicationFeeId,
				{
					amount: operation.feeAmountCents,
					metadata: { automated: AUTOMATION, hubRefundProof: operation.providerProof },
				},
				{ ...READ_OPTIONS, idempotencyKey: `client-print-refund:${operationId}:fee:v1` },
			);
		}
		validateFee(fee, operation, observed);
		if (
			!(await convex.mutation(api.orders.recordClientPrintRefund, {
				...request,
				result: { stage: "fee", refundId: fee.id, amountCents: fee.amount },
			}))
		)
			throw new ClientPrintRefundError("provider_unavailable");
	} catch (cause) {
		const issue =
			cause instanceof ClientPrintRefundError
				? cause.issue
				: cause instanceof ApplicationFeeReadError
					? "provider_mismatch"
					: "provider_unavailable";
		await convex.mutation(api.orders.releaseClientPrintRefund, { ...request, issue });
		throw new ClientPrintRefundError(issue);
	} finally {
		await convex.mutation(api.orders.releaseClientPrintRefund, request);
	}
}

export async function runClientPrintRefund(args: Parameters<typeof execute>[0]) {
	try {
		await execute(args);
	} catch (cause) {
		throw cause instanceof ClientPrintRefundError
			? cause
			: new ClientPrintRefundError("provider_unavailable");
	}
}
