import type { MutationCtx, QueryCtx } from "../_generated/server";

type DocumentType = "invoice" | "quote";

type NumberingDefinition = {
	documentType: DocumentType;
	prefix: string;
};

const INVOICE_NUMBERING = {
	documentType: "invoice",
	prefix: "INV-",
} satisfies NumberingDefinition;

const QUOTE_NUMBERING = {
	documentType: "quote",
	prefix: "QT-",
} satisfies NumberingDefinition;

type ReadableCtx = Pick<QueryCtx, "db">;

function parseDocumentNumber(value: string, prefix: string): number | null {
	if (!value.startsWith(prefix)) return null;
	const suffix = value.slice(prefix.length);
	if (!/^\d+$/.test(suffix)) return null;
	const parsed = Number.parseInt(suffix, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatDocumentNumber(value: number, prefix: string): string {
	return `${prefix}${String(value).padStart(3, "0")}`;
}

async function findHighestExistingNumber(
	ctx: ReadableCtx,
	siteUrl: string,
	definition: NumberingDefinition,
): Promise<number> {
	let highest = 0;
	if (definition.documentType === "invoice") {
		for await (const invoice of ctx.db
			.query("invoices")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))) {
			const parsed = parseDocumentNumber(invoice.invoiceNumber, definition.prefix);
			if (parsed !== null && parsed > highest) highest = parsed;
		}
	} else {
		for await (const quote of ctx.db
			.query("quotes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))) {
			const parsed = parseDocumentNumber(quote.quoteNumber, definition.prefix);
			if (parsed !== null && parsed > highest) highest = parsed;
		}
	}
	return highest;
}

async function documentNumberExists(
	ctx: ReadableCtx,
	siteUrl: string,
	documentNumber: string,
	documentType: DocumentType,
): Promise<boolean> {
	if (documentType === "invoice") {
		const existing = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl_and_invoiceNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("invoiceNumber", documentNumber),
			)
			.unique();
		return existing !== null;
	}
	const existing = await ctx.db
		.query("quotes")
		.withIndex("by_siteUrl_and_quoteNumber", (q) =>
			q.eq("siteUrl", siteUrl).eq("quoteNumber", documentNumber),
		)
		.unique();
	return existing !== null;
}

async function findNextAvailableNumber(
	ctx: ReadableCtx,
	siteUrl: string,
	startingAfter: number,
	definition: NumberingDefinition,
): Promise<number> {
	let next = startingAfter + 1;
	while (true) {
		const documentNumber = formatDocumentNumber(next, definition.prefix);
		if (!(await documentNumberExists(ctx, siteUrl, documentNumber, definition.documentType))) {
			return next;
		}
		next += 1;
	}
}

async function readCounter(
	ctx: ReadableCtx,
	siteUrl: string,
	documentType: DocumentType,
) {
	return ctx.db
		.query("documentNumberCounters")
		.withIndex("by_siteUrl_and_documentType", (q) =>
			q.eq("siteUrl", siteUrl).eq("documentType", documentType),
		)
		.unique();
}

async function previewNextDocumentNumber(
	ctx: QueryCtx,
	siteUrl: string,
	definition: NumberingDefinition,
): Promise<string> {
	const counter = await readCounter(ctx, siteUrl, definition.documentType);
	const startingAfter =
		counter?.lastNumber ?? (await findHighestExistingNumber(ctx, siteUrl, definition));
	const next = await findNextAvailableNumber(ctx, siteUrl, startingAfter, definition);
	return formatDocumentNumber(next, definition.prefix);
}

async function allocateNextDocumentNumber(
	ctx: MutationCtx,
	siteUrl: string,
	definition: NumberingDefinition,
): Promise<string> {
	const counter = await readCounter(ctx, siteUrl, definition.documentType);
	const startingAfter =
		counter?.lastNumber ?? (await findHighestExistingNumber(ctx, siteUrl, definition));
	const next = await findNextAvailableNumber(ctx, siteUrl, startingAfter, definition);

	if (counter) {
		await ctx.db.patch(counter._id, { lastNumber: next });
	} else {
		await ctx.db.insert("documentNumberCounters", {
			siteUrl,
			documentType: definition.documentType,
			lastNumber: next,
		});
	}

	return formatDocumentNumber(next, definition.prefix);
}

/** Return the best current invoice preview without reserving it. */
export function previewNextInvoiceNumber(ctx: QueryCtx, siteUrl: string) {
	return previewNextDocumentNumber(ctx, siteUrl, INVOICE_NUMBERING);
}

/** Allocate an invoice number inside the invoice-creation mutation. */
export function allocateNextInvoiceNumber(ctx: MutationCtx, siteUrl: string) {
	return allocateNextDocumentNumber(ctx, siteUrl, INVOICE_NUMBERING);
}

/** Return the best current quote preview without reserving it. */
export function previewNextQuoteNumber(ctx: QueryCtx, siteUrl: string) {
	return previewNextDocumentNumber(ctx, siteUrl, QUOTE_NUMBERING);
}

/** Allocate a quote number inside the quote-creation mutation. */
export function allocateNextQuoteNumber(ctx: MutationCtx, siteUrl: string) {
	return allocateNextDocumentNumber(ctx, siteUrl, QUOTE_NUMBERING);
}
