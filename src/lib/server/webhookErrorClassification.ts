import { CatalogBoundaryError } from "./catalogCommerceClients";
import { FulfillmentValidationError } from "./fulfillmentValidationError";
import { LumaPrintsError, LumaPrintsSubmissionError } from "./lumaprints";

export type FailureClassification = "permanent" | "transient" | "refunded";

export function classifyLumaPrintsFailure(err: unknown): FailureClassification {
	if (err instanceof FulfillmentValidationError) return "permanent";
	if (err instanceof CatalogBoundaryError)
		return err.kind === "rejected"
			? "permanent"
			: err.kind === "refunded"
				? "refunded"
				: "transient";
	if (err instanceof LumaPrintsSubmissionError)
		return err.disposition === "definitely_rejected" ? "permanent" : "transient";
	if (err instanceof LumaPrintsError) return "transient";
	return "transient";
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
