import type { MutationCtx, QueryCtx } from "../_generated/server";

const INVOICE_PREFIX = "INV-";

type ReadableCtx = Pick<QueryCtx, "db">;

function parseInvoiceNumber(value: string): number | null {
	const match = /^INV-(\d+)$/.exec(value);
	if (!match) return null;
	const parsed = Number.parseInt(match[1], 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatInvoiceNumber(value: number): string {
	return `${INVOICE_PREFIX}${String(value).padStart(3, "0")}`;
}

async function findHighestExistingNumber(
	ctx: ReadableCtx,
	siteUrl: string,
): Promise<number> {
	let highest = 0;
	for await (const invoice of ctx.db
		.query("invoices")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))) {
		const parsed = parseInvoiceNumber(invoice.invoiceNumber);
		if (parsed !== null && parsed > highest) highest = parsed;
	}
	return highest;
}

async function findNextAvailableNumber(
	ctx: ReadableCtx,
	siteUrl: string,
	startingAfter: number,
): Promise<number> {
	let next = startingAfter + 1;
	while (true) {
		const invoiceNumber = formatInvoiceNumber(next);
		const existing = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl_and_invoiceNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("invoiceNumber", invoiceNumber),
			)
			.unique();
		if (!existing) return next;
		next += 1;
	}
}

async function readCounter(ctx: ReadableCtx, siteUrl: string) {
	return ctx.db
		.query("documentNumberCounters")
		.withIndex("by_siteUrl_and_documentType", (q) =>
			q.eq("siteUrl", siteUrl).eq("documentType", "invoice"),
		)
		.unique();
}

/**
 * Return the best current preview for the admin UI.
 *
 * The preview is intentionally non-authoritative: allocation happens only in
 * the mutation that inserts the invoice.
 */
export async function previewNextInvoiceNumber(
	ctx: QueryCtx,
	siteUrl: string,
): Promise<string> {
	const counter = await readCounter(ctx, siteUrl);
	const startingAfter = counter?.lastNumber ?? (await findHighestExistingNumber(ctx, siteUrl));
	const next = await findNextAvailableNumber(ctx, siteUrl, startingAfter);
	return formatInvoiceNumber(next);
}

/**
 * Allocate an invoice number in the same transaction that inserts the invoice.
 *
 * The first allocation bootstraps from legacy invoice rows. Subsequent calls
 * contend on one per-site counter document, so Convex retries concurrent writes
 * instead of allowing two callers to persist the same number.
 */
export async function allocateNextInvoiceNumber(
	ctx: MutationCtx,
	siteUrl: string,
): Promise<string> {
	const counter = await readCounter(ctx, siteUrl);
	const startingAfter = counter?.lastNumber ?? (await findHighestExistingNumber(ctx, siteUrl));
	const next = await findNextAvailableNumber(ctx, siteUrl, startingAfter);

	if (counter) {
		await ctx.db.patch(counter._id, { lastNumber: next });
	} else {
		await ctx.db.insert("documentNumberCounters", {
			siteUrl,
			documentType: "invoice",
			lastNumber: next,
		});
	}

	return formatInvoiceNumber(next);
}
