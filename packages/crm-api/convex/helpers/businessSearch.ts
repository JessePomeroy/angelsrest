export function businessSearchText(row: {
	orderNumber?: string;
	invoiceNumber?: string;
	quoteNumber?: string;
	title?: string;
	clientName?: string;
	customerName?: string;
	customerEmail?: string;
}) {
	return [
		row.orderNumber,
		row.invoiceNumber,
		row.quoteNumber,
		row.title,
		row.clientName,
		row.customerName,
		row.customerEmail,
	]
		.filter((value) => typeof value === "string")
		.join(" ")
		.slice(0, 8192);
}
