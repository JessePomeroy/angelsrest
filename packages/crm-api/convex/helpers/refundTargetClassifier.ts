import { type Infer, v } from "convex/values";

const predicateClassValidator = v.union(
	v.literal("none"),
	v.literal("unique"),
	v.literal("multiple"),
);

const historicalRelationValidator = v.union(
	v.literal("historical_only"),
	v.literal("current_only"),
	v.literal("both"),
	v.literal("neither"),
	v.literal("ambiguous"),
);

/** Closed, non-sensitive result for one bounded tenant order scan. */
export const refundTargetClassificationValidator = v.union(
	v.object({ source: v.literal("overflow") }),
	v.object({
		source: v.literal("complete"),
		predicates: v.object({
			orderNumber: predicateClassValidator,
			checkoutSession: predicateClassValidator,
			paymentIntent: predicateClassValidator,
			refund: predicateClassValidator,
			refundedState: predicateClassValidator,
			currentIdentity: predicateClassValidator,
			completedRefund: predicateClassValidator,
		}),
		historicalRelation: historicalRelationValidator,
	}),
);

export type RefundTargetClassification = Infer<typeof refundTargetClassificationValidator>;

export type RefundTargetSelectors = {
	orderNumber: string;
	stripeSessionId: string;
	stripePaymentIntentId: string;
	stripeRefundId: string;
};

export type HistoricalRefundSelectors = {
	stripeSessionId: string;
	stripePaymentIntentId: string;
	stripeRefundId: string;
	amount: number;
};

type RefundTargetRow = {
	orderNumber: string;
	stripeSessionId: string;
	stripePaymentIntentId?: string;
	stripeRefundId?: string;
	total: number;
	status: string;
};

function predicateClass(matches: ReadonlySet<RefundTargetRow>) {
	if (matches.size === 0) return "none" as const;
	if (matches.size === 1) return "unique" as const;
	return "multiple" as const;
}

/**
 * Classify all target predicates during one pass over an already tenant-bounded source.
 * No row, selector, identifier, value, or numeric count crosses the result boundary.
 */
export function classifyRefundTargetRows(
	rowsWithOverflowSentinel: readonly RefundTargetRow[],
	sourceLimit: number,
	current: RefundTargetSelectors,
	historical: HistoricalRefundSelectors | null,
): RefundTargetClassification {
	if (!Number.isSafeInteger(sourceLimit) || sourceLimit < 1) {
		throw new Error("Refund target source limit must be a positive safe integer");
	}
	if (rowsWithOverflowSentinel.length > sourceLimit) return { source: "overflow" };

	const orderNumberMatches = new Set<RefundTargetRow>();
	const checkoutSessionMatches = new Set<RefundTargetRow>();
	const paymentIntentMatches = new Set<RefundTargetRow>();
	const refundMatches = new Set<RefundTargetRow>();
	const refundedStateMatches = new Set<RefundTargetRow>();
	const currentIdentityMatches = new Set<RefundTargetRow>();
	const completedRefundMatches = new Set<RefundTargetRow>();
	const currentRelatedRows = new Set<RefundTargetRow>();
	const historicalIdentityMatches = new Set<RefundTargetRow>();
	let historicalIdentityIsAmbiguous = false;

	for (const row of rowsWithOverflowSentinel) {
		const matchesOrderNumber = row.orderNumber === current.orderNumber;
		const matchesCheckoutSession = row.stripeSessionId === current.stripeSessionId;
		const matchesPaymentIntent = row.stripePaymentIntentId === current.stripePaymentIntentId;
		const matchesRefund = row.stripeRefundId === current.stripeRefundId;
		const matchesAnyCurrentPredicate = matchesOrderNumber
			|| matchesCheckoutSession
			|| matchesPaymentIntent
			|| matchesRefund;
		const matchesCurrentIdentity = matchesOrderNumber
			&& matchesCheckoutSession
			&& matchesPaymentIntent
			&& matchesRefund;
		const isRefunded = row.status === "refunded";

		if (matchesOrderNumber) orderNumberMatches.add(row);
		if (matchesCheckoutSession) checkoutSessionMatches.add(row);
		if (matchesPaymentIntent) paymentIntentMatches.add(row);
		if (matchesRefund) refundMatches.add(row);
		if (matchesAnyCurrentPredicate) currentRelatedRows.add(row);
		if (matchesAnyCurrentPredicate && isRefunded) refundedStateMatches.add(row);
		if (matchesCurrentIdentity) currentIdentityMatches.add(row);
		if (matchesCurrentIdentity && isRefunded) completedRefundMatches.add(row);

		if (historical) {
			const matchesHistoricalSession = row.stripeSessionId === historical.stripeSessionId;
			const matchesHistoricalPayment =
				row.stripePaymentIntentId === historical.stripePaymentIntentId;
			const matchesHistoricalRefund = row.stripeRefundId === historical.stripeRefundId;
			const matchesAnyHistoricalIdentity = matchesHistoricalSession
				|| matchesHistoricalPayment
				|| matchesHistoricalRefund;
			const matchesExactHistoricalIdentity = matchesHistoricalSession
				&& matchesHistoricalPayment
				&& matchesHistoricalRefund
				&& row.total === historical.amount
				&& isRefunded;

			if (matchesExactHistoricalIdentity) historicalIdentityMatches.add(row);
			else if (matchesAnyHistoricalIdentity) historicalIdentityIsAmbiguous = true;
		}
	}

	const currentPredicatesAreAmbiguous = currentRelatedRows.size > 1
		|| orderNumberMatches.size > 1
		|| checkoutSessionMatches.size > 1
		|| paymentIntentMatches.size > 1
		|| refundMatches.size > 1
		|| currentIdentityMatches.size > 1;
	const historicalRelation = historicalIdentityIsAmbiguous
		|| historicalIdentityMatches.size > 1
		|| currentPredicatesAreAmbiguous
		? "ambiguous" as const
		: historicalIdentityMatches.size === 1 && currentIdentityMatches.size === 1
			? "both" as const
			: historicalIdentityMatches.size === 1
				? "historical_only" as const
				: currentIdentityMatches.size === 1
					? "current_only" as const
					: "neither" as const;

	return {
		source: "complete",
		predicates: {
			orderNumber: predicateClass(orderNumberMatches),
			checkoutSession: predicateClass(checkoutSessionMatches),
			paymentIntent: predicateClass(paymentIntentMatches),
			refund: predicateClass(refundMatches),
			refundedState: predicateClass(refundedStateMatches),
			currentIdentity: predicateClass(currentIdentityMatches),
			completedRefund: predicateClass(completedRefundMatches),
		},
		historicalRelation,
	};
}
