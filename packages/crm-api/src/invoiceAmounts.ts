export type InvoiceAmountItem = { quantity: number; unitPrice: number };

export function invoiceBalance(totalCents: number, paidAmount = 0) {
	if (!Number.isSafeInteger(paidAmount) || paidAmount < 0) {
		throw new Error("Invalid invoice payment amount");
	}
	return {
		paidCents: paidAmount,
		remainingCents: Math.max(0, totalCents - paidAmount),
		overpaidCents: Math.max(0, paidAmount - totalCents),
	};
}

/** Unit prices are cents; fractional quantities are rounded per line before tax. */
export function calculateInvoiceAmounts(
	items: ReadonlyArray<InvoiceAmountItem>,
	taxPercent = 0,
) {
	if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
		throw new Error("Invalid invoice tax percentage");
	}
	let subtotalCents = 0;
	const lineAmountsCents = items.map(({ quantity, unitPrice }) => {
		if (!Number.isFinite(quantity) || quantity <= 0) {
			throw new Error("Invalid invoice line item quantity");
		}
		if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
			throw new Error("Invalid invoice line item price");
		}
		const amount = Math.round(quantity * unitPrice);
		subtotalCents += amount;
		if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(subtotalCents)) {
			throw new Error("Invoice amount exceeds safe cent precision");
		}
		return amount;
	});
	const taxCents = Math.round((subtotalCents * taxPercent) / 100);
	const totalCents = subtotalCents + taxCents;
	if (!Number.isSafeInteger(taxCents) || !Number.isSafeInteger(totalCents)) {
		throw new Error("Invoice amount exceeds safe cent precision");
	}
	return { lineAmountsCents, subtotalCents, taxCents, totalCents };
}
