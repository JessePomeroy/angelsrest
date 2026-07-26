import { CatalogBoundaryError } from "./catalogCommerceClients";
import { FulfillmentValidationError } from "./fulfillmentValidationError";
import { LumaPrintsError } from "./lumaprints";

export type FailureClassification = "permanent" | "transient" | "refunded";

export function classifyLumaPrintsFailure(err: unknown): FailureClassification {
	if (err instanceof FulfillmentValidationError) return "permanent";
	if (err instanceof CatalogBoundaryError)
		return err.kind === "rejected"
			? "permanent"
			: err.kind === "refunded"
				? "refunded"
				: "transient";
	if (err instanceof LumaPrintsError) return classifyLumaPrintsErrorDetails(err.details);
	return "transient";
}

function classifyLumaPrintsErrorDetails(details: unknown): FailureClassification {
	if (!details || typeof details !== "object") return "transient";
	const value = details as Record<string, unknown>;
	if (typeof value.statusCode === "number")
		return value.statusCode >= 400 && value.statusCode < 500 ? "permanent" : "transient";
	const message = extractMessageString(value)?.toLowerCase();
	if (!message) return "transient";
	const permanentPatterns = [
		"invalid image",
		"invalid dimensions",
		"invalid paper",
		"invalid size",
		"invalid subcategory",
		"invalid option",
		"invalid url",
		"invalid aspect",
		"not found",
		"must be",
		"required",
		"out of range",
		"not supported",
		"bad request",
		"unauthorized",
		"forbidden",
		"unprocessable",
		"aspect ratio",
		"resolution",
		"subcategory",
	];
	return permanentPatterns.some((pattern) => message.includes(pattern)) ? "permanent" : "transient";
}

function extractMessageString(value: Record<string, unknown>) {
	if (typeof value.message === "string") return value.message;
	return Array.isArray(value.message)
		? value.message.filter((item): item is string => typeof item === "string").join("; ")
		: null;
}

/** Never lets provider bodies, source URLs, or arbitrary messages cross the durable boundary. */
export function formatFailureForAdmin(err: unknown): string {
	if (err instanceof FulfillmentValidationError || err instanceof CatalogBoundaryError)
		return classifyLumaPrintsFailure(err) === "permanent"
			? "Fulfillment validation rejected"
			: "Print fulfillment unavailable";
	if (err instanceof LumaPrintsError)
		return classifyLumaPrintsFailure(err) === "permanent"
			? "Print provider rejected fulfillment"
			: "Print provider temporarily unavailable";
	return "Print fulfillment unavailable";
}
