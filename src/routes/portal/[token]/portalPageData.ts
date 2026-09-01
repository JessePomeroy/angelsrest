export type PortalClient = { name: string } | null;

export type PortalQuoteDocument = {
	_creationTime: number;
	quoteNumber: string;
	status: "draft" | "sent" | "accepted" | "declined" | "expired";
	packages: Array<{
		name: string;
		description?: string;
		price: number;
		included?: string[];
	}>;
	validUntil?: string;
	notes?: string;
};

export type PortalInvoiceDocument = {
	_creationTime: number;
	invoiceNumber: string;
	status: "draft" | "sent" | "paid" | "partial" | "overdue" | "canceled";
	items: Array<{ description: string; quantity: number; unitPrice: number }>;
	taxPercent?: number;
	dueDate?: string;
	notes?: string;
};

export type PortalContractDocument = {
	_creationTime: number;
	title: string;
	status: "draft" | "sent" | "signed" | "expired";
	body: string;
	eventDate?: string;
	eventLocation?: string;
	totalPrice?: number;
	depositAmount?: number;
	signedAt?: number;
};

export type PortalPageDataBase = {
	token: string;
	client: PortalClient;
	used: boolean;
	businessName: string;
	siteUrl: string;
};

export type PortalPageData =
	| (PortalPageDataBase & { type: "quote"; document: PortalQuoteDocument })
	| (PortalPageDataBase & { type: "invoice"; document: PortalInvoiceDocument })
	| (PortalPageDataBase & { type: "contract"; document: PortalContractDocument });

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
