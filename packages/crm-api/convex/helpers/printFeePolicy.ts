import type { CatalogProductKind } from "./catalogProductValidators";

const PRINT_FEE_DIVISOR = 20;
export const PLATFORM_PRINT_FEE_RATE = 1 / PRINT_FEE_DIVISOR;

export interface PrintFeeLine {
	productKind: CatalogProductKind;
	unitPriceCents: number;
	quantity: number;
}

function assertCents(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Print fee amounts must be non-negative safe integer cents");
	}
}

/** Callers supply catalog-resolved or authenticated snapshot lines, never browser prices. */
export function calculatePrintSubtotalCents(lines: readonly PrintFeeLine[]): number {
	let subtotalCents = 0;
	for (const line of lines) {
		assertCents(line.unitPriceCents);
		if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
			throw new Error("Print fee quantity must be a positive safe integer");
		}
		const lineTotal = line.unitPriceCents * line.quantity;
		assertCents(lineTotal);
		switch (line.productKind) {
			case "print":
			case "print_set":
				subtotalCents += lineTotal;
				assertCents(subtotalCents);
				break;
			case "digital_download":
			case "postcard":
			case "tapestry":
			case "merchandise":
				break;
			default:
				throw new Error(`Unsupported print fee product kind: ${line.productKind satisfies never}`);
		}
	}
	return subtotalCents;
}

export function calculatePrintFeeAmount(printSubtotalCents: number): number {
	assertCents(printSubtotalCents);
	// One twentieth is exactly 5%. Round down once, after summing all print lines.
	return Math.floor(printSubtotalCents / PRINT_FEE_DIVISOR);
}
