import { type Infer, v } from "convex/values";
import { catalogProductKindValidator } from "./catalogProductValidators";
import { isStripeConnectedAccountId, type ReservedCheckoutSnapshot } from "./checkoutSnapshot";
import { calculatePrintFeeAmount, calculatePrintSubtotalCents } from "./printFeePolicy";
import { isTenantId } from "./tenantContext";

export const checkoutFinancialIntentValidator = v.object({
	version: v.literal(1),
	currency: v.literal("usd"),
	lines: v.array(v.object({ unitPriceCents: v.number(), quantity: v.number() })),
	applicationFeeAmountCents: v.number(),
});
export type CheckoutFinancialIntent = Infer<typeof checkoutFinancialIntentValidator>;

/** Expected checkout amounts, never evidence that Stripe collected or returned money. */
export const checkoutFinancialSnapshotValidator = v.object({
	version: v.literal(1),
	policy: v.literal("print_subtotal_5pct_floor_v1"),
	tenantId: v.string(),
	stripePlatformAccountId: v.string(),
	stripeConnectedAccountId: v.string(),
	stripeLivemode: v.boolean(),
	currency: v.literal("usd"),
	lines: v.array(v.object({
		productKind: catalogProductKindValidator, unitPriceCents: v.number(), quantity: v.number(),
	})),
	subtotalCents: v.number(),
	printSubtotalCents: v.number(),
	applicationFeeAmountCents: v.number(),
});
export type CheckoutFinancialSnapshot = Infer<typeof checkoutFinancialSnapshotValidator>;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
		&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function cents(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseCheckoutFinancialIntent(value: unknown): CheckoutFinancialIntent | null {
	if (!exact(value, ["version", "currency", "lines", "applicationFeeAmountCents"])
		|| value.version !== 1 || value.currency !== "usd" || !cents(value.applicationFeeAmountCents)
		|| !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 40) return null;
	const lines: CheckoutFinancialIntent["lines"] = [];
	let subtotal = 0;
	for (const line of value.lines) {
		if (!exact(line, ["unitPriceCents", "quantity"]) || !cents(line.unitPriceCents)
			|| !cents(line.quantity) || line.quantity < 1 || line.quantity > 20) return null;
		subtotal += line.unitPriceCents * line.quantity;
		if (!cents(subtotal)) return null;
		lines.push({ unitPriceCents: line.unitPriceCents, quantity: line.quantity });
	}
	if (value.applicationFeeAmountCents > subtotal) return null;
	return { version: 1, currency: "usd", lines, applicationFeeAmountCents: value.applicationFeeAmountCents };
}

export function freezeCheckoutFinancialSnapshot({
	intent, snapshot, unitAmounts, identity,
}: {
	intent: CheckoutFinancialIntent;
	snapshot: ReservedCheckoutSnapshot;
	unitAmounts: readonly number[];
	identity: Pick<CheckoutFinancialSnapshot, "tenantId" | "stripePlatformAccountId" | "stripeConnectedAccountId" | "stripeLivemode">;
}): CheckoutFinancialSnapshot {
	const parsed = parseCheckoutFinancialIntent(intent);
	if (!parsed || parsed.lines.length !== snapshot.items.length || unitAmounts.length !== parsed.lines.length
		|| !isTenantId(identity.tenantId) || !isStripeConnectedAccountId(identity.stripePlatformAccountId)
		|| !isStripeConnectedAccountId(identity.stripeConnectedAccountId)
		|| identity.stripePlatformAccountId === identity.stripeConnectedAccountId) {
		throw new Error("Checkout financial identity is invalid");
	}
	const lines = parsed.lines.map((line, index) => {
		const selected = snapshot.items[index];
		if (!selected || line.unitPriceCents !== unitAmounts[index]) {
			throw new Error("Checkout financial amounts do not match frozen catalog prices");
		}
		return { ...line, productKind: selected.productKind };
	});
	const printSubtotalCents = calculatePrintSubtotalCents(lines);
	const applicationFeeAmountCents = calculatePrintFeeAmount(printSubtotalCents);
	if (applicationFeeAmountCents !== parsed.applicationFeeAmountCents) {
		throw new Error("Checkout financial fee does not match the print policy");
	}
	return {
		version: 1, policy: "print_subtotal_5pct_floor_v1", ...identity, currency: "usd", lines,
		subtotalCents: lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0),
		printSubtotalCents, applicationFeeAmountCents,
	};
}

export function financialIntentMatchesSnapshot(intent: CheckoutFinancialIntent, snapshot: CheckoutFinancialSnapshot) {
	const parsed = parseCheckoutFinancialIntent(intent);
	return parsed !== null && parsed.currency === snapshot.currency
		&& parsed.applicationFeeAmountCents === snapshot.applicationFeeAmountCents
		&& parsed.lines.length === snapshot.lines.length
		&& parsed.lines.every((line, index) => line.unitPriceCents === snapshot.lines[index]?.unitPriceCents
			&& line.quantity === snapshot.lines[index]?.quantity);
}
