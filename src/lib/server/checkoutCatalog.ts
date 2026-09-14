type ProductKind =
	| "print"
	| "print_set"
	| "postcard"
	| "tapestry"
	| "digital_download"
	| "merchandise";

export interface CheckoutSelection {
	readonly productId?: unknown;
	readonly isPrintSet?: unknown;
	readonly paperSlug?: unknown;
	readonly sizeSlug?: unknown;
	readonly paperIndex?: unknown;
	readonly borderWidth?: unknown;
	readonly frame?: unknown;
	readonly paper?: unknown;
}

interface ResolvedPaper {
	readonly name: string;
	readonly subcategoryId: number;
	readonly width: number;
	readonly height: number;
	readonly borderWidth?: number;
	readonly frameSubcategoryId?: number;
	readonly canvasSubcategoryId?: number;
	readonly canvasWrapHex?: string;
}

export interface CheckoutSnapshotItem {
	readonly productKey: string;
	readonly revisionId: string;
	readonly productKind: ProductKind;
	readonly variantKey: string | null;
	readonly materialOptionKey: string | null;
	readonly sizeOptionKey: string | null;
	readonly borderOptionKey: string | null;
	readonly frameOptionKey: string | null;
}

export interface LegacyCheckoutFulfillment {
	readonly isDigital: boolean;
	readonly isPrintSet: boolean;
	readonly imageUrl: string | null;
	readonly imageUrls: readonly string[];
	readonly paper: ResolvedPaper | null;
}

export interface ResolvedCheckoutItem {
	readonly productId: string;
	readonly title: string;
	readonly unitPriceCents: number;
	readonly productCategory: string | null;
	readonly publicImage: string | null;
	readonly snapshot: CheckoutSnapshotItem | null;
	readonly legacyFulfillment: LegacyCheckoutFulfillment;
}
