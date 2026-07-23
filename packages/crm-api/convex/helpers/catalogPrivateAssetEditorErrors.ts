import { ConvexError } from "convex/values";

export type CatalogPrivateEditorReceiptErrorCategory = "validation" | "conflict";

export class CatalogPrivateAssetValidationError extends Error {
	readonly name = "CatalogPrivateAssetValidationError";
}

export function catalogPrivateAssetValidationError(message: string) {
	return new CatalogPrivateAssetValidationError(message);
}

export function isCatalogPrivateAssetValidationError(
	error: unknown,
): error is CatalogPrivateAssetValidationError {
	return error instanceof CatalogPrivateAssetValidationError;
}

type CatalogPrivateEditorReceiptErrorData = {
	scope: "catalog_private_editor_receipt";
	category: CatalogPrivateEditorReceiptErrorCategory;
};

export function catalogPrivateEditorReceiptError(
	category: CatalogPrivateEditorReceiptErrorCategory,
) {
	return new ConvexError<CatalogPrivateEditorReceiptErrorData>({
		scope: "catalog_private_editor_receipt",
		category,
	});
}

export function catalogPrivateEditorReceiptErrorCategory(
	error: unknown,
): CatalogPrivateEditorReceiptErrorCategory | null {
	if (!(error instanceof ConvexError)) return null;
	const data = error.data;
	if (
		!data ||
		typeof data !== "object" ||
		Array.isArray(data) ||
		data.scope !== "catalog_private_editor_receipt" ||
		(data.category !== "validation" && data.category !== "conflict")
	)
		return null;
	return data.category;
}

export function catalogPrivateEditorReceiptHttpStatus(error: unknown): 400 | 409 | 503 {
	const category = catalogPrivateEditorReceiptErrorCategory(error);
	return category === "validation" ? 400 : category === "conflict" ? 409 : 503;
}

export function isCatalogPrivateEditorExpectedValidationError(error: unknown) {
	return (
		catalogPrivateEditorReceiptErrorCategory(error) === "validation" ||
		isCatalogPrivateAssetValidationError(error)
	);
}

export function catalogPrivateEditorPrevalidationHttpStatus(error: unknown): 400 | 503 {
	return isCatalogPrivateEditorExpectedValidationError(error) ? 400 : 503;
}
