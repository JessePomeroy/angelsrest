import type { FunctionReturnType } from "convex/server";
import type { api } from "$convex/api";
import {
	calculatePrintFeeAmount,
	calculatePrintSubtotalCents,
	type PrintFeeLine,
} from "../../packages/crm-api/convex/helpers/printFeePolicy";

export type ClientPrintRefundPageData = {
	siteUrl: string;
	enabled: boolean;
	requestToken: string;
	page: FunctionReturnType<typeof api.orders.getClientPrintRefundPage> | null;
};
export function clientPrintRefundPath(siteUrl: string) {
	return `/portal/refunds/${encodeURIComponent(siteUrl)}`;
}
export function refundCents(value: string) {
	if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) return null;
	const [whole, fraction = ""] = value.split(".");
	return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

type RefundOrder = {
	lines: readonly { kind: PrintFeeLine["productKind"]; remainingCents: number }[];
	otherRemainingCents: number;
	printRefundedCents: number;
	feeReturnedCents: number;
};

/** Preview only; the authenticated refund mutation recalculates from its saved snapshot. */
export function previewClientPrintRefund(
	order: RefundOrder,
	lineAmounts: string[],
	otherAmount: string,
) {
	const parsedLines = lineAmounts.map(refundCents);
	const otherCents = refundCents(otherAmount);
	if (
		parsedLines.length !== order.lines.length ||
		otherCents === null ||
		otherCents > order.otherRemainingCents ||
		parsedLines.some(
			(amount, index) => amount === null || amount > order.lines[index].remainingCents,
		)
	) {
		return { valid: false, totalCents: 0, feeCents: 0 };
	}
	const cents = parsedLines.filter((amount): amount is number => amount !== null);
	const printCents = calculatePrintSubtotalCents(
		order.lines.map((line, index) => ({
			productKind: line.kind,
			unitPriceCents: cents[index],
			quantity: 1,
		})),
	);
	const feeCents =
		calculatePrintFeeAmount(order.printRefundedCents + printCents) - order.feeReturnedCents;
	const totalCents = cents.reduce((sum, amount) => sum + amount, otherCents);
	if (feeCents < 0 || !Number.isSafeInteger(totalCents)) {
		return { valid: false, totalCents: 0, feeCents: 0 };
	}
	return { valid: true, totalCents, feeCents };
}
