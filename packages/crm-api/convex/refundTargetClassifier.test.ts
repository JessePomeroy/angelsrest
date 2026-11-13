import { describe, expect, test } from "vitest";
import {
	classifyRefundTargetRows,
	type HistoricalRefundSelectors,
	type RefundTargetSelectors,
} from "./helpers/refundTargetClassifier";

const current: RefundTargetSelectors = {
	orderNumber: "CURRENT-ORDER",
	stripeSessionId: "cs_test_current_selector",
	stripePaymentIntentId: "pi_current_selector",
	stripeRefundId: "re_current_selector",
};

const historical: HistoricalRefundSelectors = {
	stripeSessionId: "cs_test_historical_selector",
	stripePaymentIntentId: "pi_historical_selector",
	stripeRefundId: "re_historical_selector",
	amount: 1500,
};

function row(overrides: Partial<{
	orderNumber: string;
	stripeSessionId: string;
	stripePaymentIntentId: string;
	stripeRefundId: string;
	total: number;
	status: string;
}> = {}) {
	return {
		orderNumber: current.orderNumber,
		stripeSessionId: current.stripeSessionId,
		stripePaymentIntentId: current.stripePaymentIntentId,
		stripeRefundId: current.stripeRefundId,
		total: 4200,
		status: "refunded",
		...overrides,
	};
}

const historicalRow = () => row({
	orderNumber: "HISTORICAL-ORDER",
	stripeSessionId: historical.stripeSessionId,
	stripePaymentIntentId: historical.stripePaymentIntentId,
	stripeRefundId: historical.stripeRefundId,
	total: historical.amount,
});

describe("orthogonal refund target classification", () => {
	test("retains every independent finding when one target predicate misses", () => {
		expect(classifyRefundTargetRows([
			row({ stripePaymentIntentId: "pi_different_selector" }),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "unique",
				checkoutSession: "unique",
				paymentIntent: "none",
				refund: "unique",
				refundedState: "unique",
				currentIdentity: "none",
				completedRefund: "none",
			},
			historicalRelation: "neither",
		});
	});

	test("accumulates divergent predicate matches without selecting either row", () => {
		expect(classifyRefundTargetRows([
			row({
				stripePaymentIntentId: "pi_first_other",
				stripeRefundId: "re_first_other",
			}),
			row({
				orderNumber: "SECOND-ORDER",
				stripeSessionId: "cs_test_second_other",
				status: "new",
			}),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "unique",
				checkoutSession: "unique",
				paymentIntent: "unique",
				refund: "unique",
				refundedState: "unique",
				currentIdentity: "none",
				completedRefund: "none",
			},
			historicalRelation: "ambiguous",
		});
	});

	test("fails closed when distinct duplicate rows match every target predicate", () => {
		expect(classifyRefundTargetRows([
			row(),
			row({ total: 4300 }),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "multiple",
				checkoutSession: "multiple",
				paymentIntent: "multiple",
				refund: "multiple",
				refundedState: "multiple",
				currentIdentity: "multiple",
				completedRefund: "multiple",
			},
			historicalRelation: "ambiguous",
		});
	});

	test.each([
		["historical_only", [historicalRow()]],
		["current_only", [row()]],
		["both", [historicalRow(), row()]],
		["neither", []],
		[
			"ambiguous",
			[historicalRow(), row({
				orderNumber: "PARTIAL-HISTORICAL",
				stripeSessionId: historical.stripeSessionId,
			})],
		],
	] as const)("returns the %s historical relation class", (historicalRelation, rows) => {
		const result = classifyRefundTargetRows(rows, 10, current, historical);
		expect(result).toMatchObject({ source: "complete", historicalRelation });
	});

	test("fails closed on exactly one overflow sentinel", () => {
		expect(classifyRefundTargetRows([
			row(),
			row({ orderNumber: "SECOND" }),
			row({ orderNumber: "OVERFLOW-SENTINEL" }),
		], 2, current, historical)).toEqual({ source: "overflow" });
	});

	test("rejects an invalid source bound with one fixed error", () => {
		expect(() => classifyRefundTargetRows([], 0, current, historical)).toThrow(
			"Refund target source limit must be a positive safe integer",
		);
	});
});
