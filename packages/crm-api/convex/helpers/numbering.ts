import type { QueryCtx } from "../_generated/server";

const ORDER_NUMBER_PATTERN = /^ORD-(\d+)$/;

/** Format a positive safe integer as its unique order number. */
export function formatOrderNumber(sequence: number) {
	if (!Number.isSafeInteger(sequence) || sequence < 1) {
		throw new Error("Invalid order number sequence");
	}
	return `ORD-${String(sequence).padStart(3, "0")}`;
}

/** Return the sequence only when the complete input is in canonical form. */
export function parseCanonicalOrderNumber(orderNumber: string) {
	if (orderNumber.length < 7 || orderNumber.length > 20) return null;
	const match = ORDER_NUMBER_PATTERN.exec(orderNumber);
	if (!match) return null;

	const sequence = Number(match[1]);
	if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
	return formatOrderNumber(sequence) === orderNumber ? sequence : null;
}

/** Fail when an order number is already retained for this tenant. */
export async function assertOrderNumberAvailable(
	ctx: QueryCtx,
	siteUrl: string,
	orderNumber: string,
) {
	const [existing] = await ctx.db
		.query("orders")
		.withIndex("by_orderNumber", (q) =>
			q.eq("siteUrl", siteUrl).eq("orderNumber", orderNumber),
		)
		.take(1);
	if (existing) throw new Error("Order number already exists for tenant");
}

/**
 * Generate the next order number from the newest retained row for a tenant.
 *
 * Concurrency depends on the caller. `orders.create` invokes this helper inside
 * the mutation that persists the number, so Convex OCC retries conflicting
 * reads and empty candidate-index reads.
 */
export async function getNextOrderNumber(
	ctx: QueryCtx,
	siteUrl: string,
): Promise<string> {
	const [latest] = await ctx.db
		.query("orders")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.order("desc")
		.take(1);

	let orderNumber = "ORD-001";
	if (latest) {
		const sequence = parseCanonicalOrderNumber(latest.orderNumber);
		if (sequence === null) throw new Error("Newest order number is not canonical");
		if (sequence === Number.MAX_SAFE_INTEGER) {
			throw new Error("Newest order number cannot be incremented safely");
		}
		orderNumber = formatOrderNumber(sequence + 1);
	}

	await assertOrderNumberAvailable(ctx, siteUrl, orderNumber);
	return orderNumber;
}
