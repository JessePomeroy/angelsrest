import { buildTenantCheckoutOptions, type StripeTenantAccount } from "$lib/server/stripeConnect";
import { type CartItem, MAX_QUANTITY_PER_LINE } from "$lib/shop/cart";

export interface HandleCartIntent {
	productSlug: string;
	type: "print" | "set";
	quantity: number;
	paperSlug?: string;
	sizeSlug?: string;
	paperIndex?: number;
	borderWidthValue?: string;
	frameValue?: string;
}

export function calculateCartPrintSubtotalCents(items: CartItem[]): number {
	return items.reduce((total, item) => {
		const isPrintLine = typeof item.paperSubcategoryId === "number";
		if (!isPrintLine) return total;
		return total + item.unitPriceCents * item.quantity;
	}, 0);
}

export function buildCartTenantCheckoutOptions({
	items,
	tenant,
}: {
	items: CartItem[];
	tenant: StripeTenantAccount;
}) {
	return buildTenantCheckoutOptions({
		tenant,
		kind: "print",
		subtotalCents: calculateCartPrintSubtotalCents(items),
	});
}

export function parseHandleCartIntent(items: unknown): HandleCartIntent[] | null {
	if (!Array.isArray(items) || items.length < 1 || items.length > 40) return null;
	const parsed: HandleCartIntent[] = [];
	for (const value of items) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const item = value as Record<string, unknown>;
		if (
			typeof item.productSlug !== "string" ||
			!item.productSlug.trim() ||
			(item.type !== "print" && item.type !== "set") ||
			!Number.isInteger(item.quantity) ||
			Number(item.quantity) < 1 ||
			Number(item.quantity) > MAX_QUANTITY_PER_LINE
		)
			return null;
		const intent: HandleCartIntent = {
			productSlug: item.productSlug.trim(),
			type: item.type,
			quantity: Number(item.quantity),
		};
		for (const key of ["paperSlug", "sizeSlug", "borderWidthValue", "frameValue"] as const) {
			const candidate = item[key];
			if (candidate !== undefined) {
				if (typeof candidate !== "string" || !candidate) return null;
				intent[key] = candidate;
			}
		}
		if (item.paperIndex !== undefined) {
			if (!Number.isInteger(item.paperIndex) || Number(item.paperIndex) < 0) return null;
			intent.paperIndex = Number(item.paperIndex);
		}
		parsed.push(intent);
	}
	return parsed;
}
