import type { Doc } from "$convex/dataModel";

type PortalClient = { name: string; email?: string } | null;

export type PortalPageDataBase = {
	token: string;
	client: PortalClient;
	used: boolean;
	businessName: string;
	siteUrl: string;
};

export type PortalPageData =
	| (PortalPageDataBase & { type: "quote"; document: Doc<"quotes"> })
	| (PortalPageDataBase & { type: "invoice"; document: Doc<"invoices"> })
	| (PortalPageDataBase & { type: "contract"; document: Doc<"contracts"> });

export function getQuoteTotal(packages: ReadonlyArray<{ price: number }>): number {
	return packages.reduce((sum, pkg) => sum + pkg.price, 0);
}

export function getInvoiceSubtotal(
	items: ReadonlyArray<{ quantity: number; unitPrice: number }>,
): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export function getInvoiceTotal(
	items: ReadonlyArray<{ quantity: number; unitPrice: number }>,
	taxPercent?: number,
): number {
	const subtotal = getInvoiceSubtotal(items);
	return taxPercent ? subtotal + subtotal * (taxPercent / 100) : subtotal;
}
