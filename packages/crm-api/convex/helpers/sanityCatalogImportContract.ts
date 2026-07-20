import type {
	CatalogFulfillmentMode,
	CatalogProductKind,
} from "./catalogProductValidators";

export type SanityCatalogImportIssue = {
	code:
		| "duplicate-placement-key"
		| "duplicate-product-key"
		| "duplicate-slug"
		| "duplicate-source-id"
		| "duplicate-variant-key"
		| "duplicate-variant-options"
		| "invalid-file-reference"
		| "invalid-image-reference"
		| "invalid-price"
		| "invalid-source-metadata"
		| "invalid-target-field"
		| "legacy-print-contract"
		| "missing-exported-reference"
		| "missing-image-alt"
		| "missing-required-field"
		| "unsupported-category"
		| "unsupported-source-document"
		| "unexpected-source-type";
	path: string;
	message: string;
	severity: "error" | "warning";
};

export type SanityCatalogDocumentSource = {
	_id?: unknown;
	_type?: unknown;
	_rev?: unknown;
	_createdAt?: unknown;
	_updatedAt?: unknown;
};

export type SanityCatalogImageSource = {
	_key?: unknown;
	assetRef?: unknown;
	alt?: unknown;
};

export type SanityCatalogVariantSource = {
	_key?: unknown;
	paper?: unknown;
	size?: unknown;
	retailPrice?: unknown;
	enabled?: unknown;
};

export type SanityCatalogProductBaseSource = SanityCatalogDocumentSource & {
	title?: unknown;
	slug?: unknown;
	description?: unknown;
	inStock?: unknown;
	featured?: unknown;
};

export type SanityCatalogPrintSource = SanityCatalogProductBaseSource & {
	image?: SanityCatalogImageSource;
	variants?: SanityCatalogVariantSource[];
	bordersEnabled?: unknown;
	framedEnabled?: unknown;
	frameMarkupMultiplier?: unknown;
};

export type SanityCatalogPrintSetSource = SanityCatalogProductBaseSource & {
	previewImage?: SanityCatalogImageSource;
	images?: SanityCatalogImageSource[];
	parentRef?: unknown;
	variants?: SanityCatalogVariantSource[];
	bordersEnabled?: unknown;
	framedEnabled?: unknown;
	frameMarkupMultiplier?: unknown;
};

export type SanityCatalogGeneralProductSource = SanityCatalogProductBaseSource & {
	orderRank?: unknown;
	images?: SanityCatalogImageSource[];
	price?: unknown;
	category?: unknown;
	collectionRef?: unknown;
	digitalFileRef?: unknown;
	digitalFileAsset?: {
		_id?: unknown;
		originalFilename?: unknown;
		mimeType?: unknown;
		size?: unknown;
	};
	digitalFileVersion?: unknown;
	availablePapers?: unknown;
	seo?: {
		description?: unknown;
		ogImage?: SanityCatalogImageSource;
	};
};

export type SanityCatalogCollectionSource = SanityCatalogDocumentSource & {
	title?: unknown;
	slug?: unknown;
	parentRef?: unknown;
};

export type SanityCatalogCouponSource = SanityCatalogDocumentSource & {
	code?: unknown;
};

export type SanityCatalogImportSource = {
	prints: SanityCatalogPrintSource[];
	sets: SanityCatalogPrintSetSource[];
	general: SanityCatalogGeneralProductSource[];
	collections: SanityCatalogCollectionSource[];
	coupons: SanityCatalogCouponSource[];
};

export type SanityCatalogImportKind = CatalogProductKind | "unsupported";

export type SanityCatalogImportVariant = {
	key: string;
	origin: "source_variant" | "fixed_price";
	materialOptionKey?: string;
	sizeOptionKey?: string;
	retailPriceCents?: number;
	status: "enabled" | "disabled";
};

export type SanityCatalogImportMediaPlacement = {
	key: string;
	role: "primary" | "cover" | "gallery" | "set_member" | "social_share";
	order: number;
	sourceAssetRef: string;
	altText?: string;
	printSource: boolean;
};

export type SanityCatalogImportProduct = {
	sourcePath: string;
	sourceId: string;
	sourceType: "lumaProductV2" | "lumaPrintSetV2" | "product";
	sourceRevision?: string;
	sourceCreatedAt?: string;
	sourceUpdatedAt?: string;
	productKey: string;
	kind: SanityCatalogImportKind;
	fulfillmentMode: CatalogFulfillmentMode;
	title?: string;
	slug?: string;
	description?: string;
	saleAvailability: "available" | "unavailable";
	shopPlacement: {
		featured: boolean;
		orderRank?: string;
	};
	variants: SanityCatalogImportVariant[];
	media: SanityCatalogImportMediaPlacement[];
	printOptions?: {
		borderOptionsEnabled: boolean;
		frameOptionsEnabled: boolean;
		framePriceMultiplierBasisPoints: number;
	};
	printSetMembers?: Array<{
		key: string;
		order: number;
		mediaPlacementKey: string;
		sourceAssetRef: string;
	}>;
	sourceCollectionId?: string;
	digitalFile?: {
		sourceFileRef: string;
		sourceAssetId: string;
		originalFilename: string;
		mimeType: string;
		sizeBytes: number;
		version?: string;
	};
	seoDescription?: string;
	normalizations: string[];
	issues: SanityCatalogImportIssue[];
};

export type SanityCatalogImportManifest = {
	version: 1;
	products: SanityCatalogImportProduct[];
	sourceExtras: {
		collections: number;
		coupons: number;
	};
	issues: SanityCatalogImportIssue[];
};

export type SanityCatalogImportDryRunReport = {
	version: 1;
	counts: {
		products: number;
		productsByKind: Record<SanityCatalogImportKind, number>;
		sourceExplicitVariants: number;
		normalizedVariants: number;
		mediaPlacements: number;
		uniqueSourceImages: number;
		printSourcePlacements: number;
		uniquePrintSourceImages: number;
		printSetMembers: number;
		digitalFiles: number;
		compatibilityDefaultsApplied: number;
		collections: number;
		coupons: number;
	};
	requiredSourceImageRefs: string[];
	requiredPrintSourceImageRefs: string[];
	requiredSourceFileRefs: string[];
	draftImport: SanityCatalogImportReadiness;
	publicationRemediation: SanityCatalogImportReadiness;
};

export type SanityCatalogImportReadiness = {
	status: "ready" | "ready-with-warnings" | "blocked";
	counts: { errors: number; warnings: number };
	blockingIssues: SanityCatalogImportIssue[];
	warningIssues: SanityCatalogImportIssue[];
	issues: SanityCatalogImportIssue[];
};
