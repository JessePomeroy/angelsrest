import type { Doc } from "$convex/dataModel";
import type { PortalPageData, PortalPageDataBase } from "./portalPageData";

type PortalDocument = Doc<"quotes"> | Doc<"invoices"> | Doc<"contracts"> | Doc<"galleries">;

type PortalQuerySuccess = {
	token: Pick<Doc<"portalTokens">, "type" | "used" | "siteUrl">;
	document: PortalDocument;
	client: PortalPageDataBase["client"];
};

function isQuoteDocument(value: PortalDocument): value is Doc<"quotes"> {
	return (
		"quoteNumber" in value &&
		typeof value.quoteNumber === "string" &&
		"packages" in value &&
		Array.isArray(value.packages)
	);
}

function isInvoiceDocument(value: PortalDocument): value is Doc<"invoices"> {
	return (
		"invoiceNumber" in value &&
		typeof value.invoiceNumber === "string" &&
		"items" in value &&
		Array.isArray(value.items)
	);
}

function isContractDocument(value: PortalDocument): value is Doc<"contracts"> {
	return (
		"title" in value &&
		typeof value.title === "string" &&
		"body" in value &&
		typeof value.body === "string"
	);
}

/** Correlate and validate the Convex token/document unions at the server boundary. */
export function createPortalPageData(
	token: string,
	businessName: string,
	result: PortalQuerySuccess,
): PortalPageData {
	const base: PortalPageDataBase = {
		token,
		client: result.client,
		used: result.token.used,
		businessName,
		siteUrl: result.token.siteUrl,
	};

	switch (result.token.type) {
		case "quote":
			if (!isQuoteDocument(result.document)) {
				throw new Error("Portal quote token returned a non-quote document");
			}
			return { ...base, type: "quote", document: result.document };
		case "invoice":
			if (!isInvoiceDocument(result.document)) {
				throw new Error("Portal invoice token returned a non-invoice document");
			}
			return { ...base, type: "invoice", document: result.document };
		case "contract":
			if (!isContractDocument(result.document)) {
				throw new Error("Portal contract token returned a non-contract document");
			}
			return { ...base, type: "contract", document: result.document };
		case "gallery":
			throw new Error("Gallery tokens are not supported by the document portal");
	}
}
