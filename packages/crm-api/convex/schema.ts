import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
	contentKindValidator,
	contentRevisionPayloadValidator,
	contentRevisionSourceValidator,
	contentSlugKindValidator,
} from "./helpers/contentValidators";
import {
	catalogFulfillmentModeValidator,
	catalogProductKindValidator,
	catalogRevisionSourceValidator,
	catalogSaleAvailabilityValidator,
	catalogVariantStatusValidator,
} from "./helpers/catalogProductValidators";
import {
	catalogGraphV2PrintOptionsValidator,
	catalogGraphV2WebMediaRoleValidator,
} from "./helpers/catalogProductGraphValidators";
import {
	paidDigitalFileAssetValidator,
	privatePrintSourceAssetValidator,
} from "./helpers/catalogPrivateAssetValidators";
import {
	mediaAssetStatusValidator,
	mediaFocalPointValidator,
	webAssetDerivativesValidator,
	webAssetMasterValidator,
	webAssetSourceValidator,
} from "./helpers/mediaValidators";
import {
	richTextListItemValidator,
	richTextSpanValidator,
} from "./helpers/richTextContract";
import { stripeFeeCaptureErrorValidator } from "./helpers/stripeFeeCapture";
import { categoryValidator } from "./helpers/validators";

const contentBlockValueValidator = v.union(
	v.object({
		type: v.literal("paragraph"),
		key: v.string(),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("heading"),
		key: v.string(),
		level: v.union(v.literal(2), v.literal(3), v.literal(4)),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("quote"),
		key: v.string(),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("list"),
		key: v.string(),
		style: v.union(v.literal("bullet"), v.literal("number")),
		items: v.array(richTextListItemValidator),
	}),
	v.object({
		type: v.literal("image"),
		key: v.string(),
		placementKey: v.string(),
	}),
);

const contentMediaRoleValidator = v.union(
	v.literal("main"),
	v.literal("body"),
);

const contentReferenceFieldValidator = v.union(
	v.literal("author"),
	v.literal("category"),
);

const contentPostTechnicalFieldValidator = v.union(
	v.literal("equipment"),
	v.literal("material"),
);

const catalogProductRevisionV1Validator = v.object({
	siteUrl: v.string(),
	productId: v.id("catalogProducts"),
	productKind: catalogProductKindValidator,
	schemaVersion: v.literal(1),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
	currency: v.literal("usd"),
	fulfillmentMode: catalogFulfillmentModeValidator,
	saleAvailability: catalogSaleAvailabilityValidator,
	borderOptionsEnabled: v.boolean(),
	frameOptionsEnabled: v.boolean(),
	framePriceMultiplierBasisPoints: v.number(),
	variantCount: v.number(),
	checksum: v.string(),
	source: catalogRevisionSourceValidator,
	createdAt: v.number(),
	createdBy: v.string(),
});

const catalogProductRevisionV2CommonFields = {
	siteUrl: v.string(),
	productId: v.id("catalogProducts"),
	schemaVersion: v.literal(2),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
	seoDescription: v.optional(v.string()),
	currency: v.literal("usd"),
	saleAvailability: catalogSaleAvailabilityValidator,
	variantCount: v.number(),
	webMediaCount: v.number(),
	printSourceCount: v.number(),
	setMemberCount: v.number(),
	digitalFileCount: v.number(),
	shopPlacementCount: v.number(),
	checksum: v.string(),
	source: catalogRevisionSourceValidator,
	createdAt: v.number(),
	createdBy: v.string(),
};

const catalogProductRevisionV2Validators = [
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("print"),
		fulfillmentMode: v.union(
			v.literal("production_partner"),
			v.literal("merchant_fulfilled"),
		),
		printOptions: catalogGraphV2PrintOptionsValidator,
	}),
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("print_set"),
		fulfillmentMode: v.union(
			v.literal("production_partner"),
			v.literal("merchant_fulfilled"),
		),
		printOptions: catalogGraphV2PrintOptionsValidator,
	}),
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("postcard"),
		fulfillmentMode: v.literal("merchant_fulfilled"),
	}),
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("tapestry"),
		fulfillmentMode: v.literal("merchant_fulfilled"),
	}),
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("digital_download"),
		fulfillmentMode: v.literal("digital_delivery"),
	}),
	v.object({
		...catalogProductRevisionV2CommonFields,
		productKind: v.literal("merchandise"),
		fulfillmentMode: v.literal("merchant_fulfilled"),
	}),
] as const;

export default defineSchema({
	// Photographers you've built sites for
	platformClients: defineTable({
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		sanityProjectId: v.optional(v.string()),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		stripeCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		stripeConnectedAccountId: v.optional(v.string()),
		adminEmails: v.array(v.string()),
		role: v.optional(v.union(v.literal("creator"), v.literal("client"))),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_email", ["email"])
		.index("by_stripeSubscriptionId", ["stripeSubscriptionId"])
		.index("by_stripeConnectedAccountId", ["stripeConnectedAccountId"]),

	// Provider-neutral editorial identity. Legacy page kinds remain tenant
	// singletons; supporting Blog records use a stable document key plus a
	// tenant/kind-scoped mutable slug and server-assigned rank.
	contentDocuments: defineTable({
		siteUrl: v.string(),
		kind: contentKindValidator,
		documentKey: v.optional(v.string()),
		slug: v.optional(v.string()),
		rank: v.optional(v.number()),
		draftRevisionId: v.optional(v.id("contentRevisions")),
		publishedRevisionId: v.optional(v.id("contentRevisions")),
		createdAt: v.number(),
		createdBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
		publishedAt: v.optional(v.number()),
		publishedBy: v.optional(v.string()),
		archivedAt: v.optional(v.number()),
		archivedBy: v.optional(v.string()),
	})
		.index("by_siteUrl_and_kind", ["siteUrl", "kind"])
		.index("by_siteUrl_and_kind_and_documentKey", [
			"siteUrl",
			"kind",
			"documentKey",
		])
		.index("by_siteUrl_and_kind_and_slug", ["siteUrl", "kind", "slug"])
		.index("by_siteUrl_and_kind_and_rank", ["siteUrl", "kind", "rank"]),

	// Every former published slug remains reserved to its original document.
	// Public hosts resolve these rows directly to the document's current slug,
	// so repeated URL changes never create redirect chains.
	contentSlugHistory: defineTable({
		siteUrl: v.string(),
		kind: contentSlugKindValidator,
		slug: v.string(),
		documentId: v.id("contentDocuments"),
		createdAt: v.number(),
		createdBy: v.string(),
	})
		.index("by_siteUrl_and_kind_and_slug", ["siteUrl", "kind", "slug"])
		.index("by_documentId_and_createdAt", ["documentId", "createdAt"]),

	// Immutable revisions keep drafts and published values auditable. The
	// payload union remains explicit rather than accepting arbitrary content.
	contentRevisions: defineTable({
		siteUrl: v.string(),
		documentId: v.id("contentDocuments"),
		kind: contentKindValidator,
		schemaVersion: v.literal(1),
		payload: contentRevisionPayloadValidator,
		source: contentRevisionSourceValidator,
		checksum: v.string(),
		createdAt: v.number(),
		createdBy: v.string(),
	})
		.index("by_documentId_and_createdAt", ["documentId", "createdAt"])
		.index("by_siteUrl_and_kind_and_createdAt", ["siteUrl", "kind", "createdAt"]),

	// Ordered Post body rows keep rich text queryable without placing an
	// unbounded document inside the revision payload. Image blocks contain only
	// a placement key; the corresponding media row owns asset metadata.
	contentBlocks: defineTable({
		siteUrl: v.string(),
		documentId: v.id("contentDocuments"),
		revisionId: v.id("contentRevisions"),
		blockKey: v.string(),
		order: v.number(),
		block: contentBlockValueValidator,
	})
		.index("by_revisionId_and_order", ["revisionId", "order"])
		.index("by_documentId_and_revisionId", ["documentId", "revisionId"]),

	// A placement is the sole owner of a Post image's asset, alt text, and
	// caption. Main and body images share one ordered revision-owned relation.
	contentMediaPlacements: defineTable({
		siteUrl: v.string(),
		documentId: v.id("contentDocuments"),
		revisionId: v.id("contentRevisions"),
		assetId: v.id("mediaAssets"),
		placementKey: v.string(),
		role: contentMediaRoleValidator,
		order: v.number(),
		altText: v.optional(v.string()),
		caption: v.optional(v.string()),
	})
		.index("by_revisionId_and_role_and_order", ["revisionId", "role", "order"])
		.index("by_revisionId_and_assetId", ["revisionId", "assetId"])
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"])
		.index("by_documentId_and_revisionId", ["documentId", "revisionId"]),

	// Equipment and material lists are ordered Post graph rows rather than
	// embedded revision payloads. This keeps list reads bounded even when every
	// Technical Note uses the maximum authored detail.
	contentPostTechnicalItems: defineTable({
		siteUrl: v.string(),
		documentId: v.id("contentDocuments"),
		revisionId: v.id("contentRevisions"),
		field: contentPostTechnicalFieldValidator,
		itemKey: v.string(),
		order: v.number(),
		label: v.optional(v.string()),
		details: v.optional(v.string()),
	})
		.index("by_revisionId_and_field_and_order", [
			"revisionId",
			"field",
			"order",
		])
		.index("by_documentId_and_revisionId", [
			"documentId",
			"revisionId",
		]),

	// Post references resolve through the target document's current published
	// revision. Keeping the target identity dynamic allows an Author or Category
	// correction to flow through without republishing every referring Post.
	contentReferences: defineTable({
		siteUrl: v.string(),
		fromDocumentId: v.id("contentDocuments"),
		fromRevisionId: v.id("contentRevisions"),
		toDocumentId: v.id("contentDocuments"),
		field: contentReferenceFieldValidator,
		referenceKey: v.string(),
		order: v.number(),
	})
		.index("by_fromRevisionId_and_field_and_order", [
			"fromRevisionId",
			"field",
			"order",
		])
		.index("by_siteUrl_and_toDocumentId", ["siteUrl", "toDocumentId"])
		.index("by_siteUrl_and_toDocumentId_and_fromRevisionId", [
			"siteUrl",
			"toDocumentId",
			"fromRevisionId",
		])
		.index("by_fromDocumentId_and_fromRevisionId", [
			"fromDocumentId",
			"fromRevisionId",
		]),

	// Public CMS media identity. Private R2 masters and public derivative keys
	// belong to one tenant; the original staging upload is not retained here.
	mediaAssets: defineTable({
		siteUrl: v.string(),
		assetId: v.string(),
		intent: v.literal("web"),
		status: mediaAssetStatusValidator,
		originalFilename: v.string(),
		source: webAssetSourceValidator,
		master: webAssetMasterValidator,
		derivatives: webAssetDerivativesValidator,
		createdAt: v.number(),
		createdBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
		deletionRequestedAt: v.optional(v.number()),
		deletionRequestedBy: v.optional(v.string()),
	})
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"])
		.index("by_siteUrl_and_status", ["siteUrl", "status"])
		.index("by_siteUrl_and_createdAt", ["siteUrl", "createdAt"])
		.searchIndex("search_originalFilename", {
			searchField: "originalFilename",
			filterFields: ["siteUrl", "status"],
		}),

	// A completed storage deletion permanently reserves the Worker's asset UUID.
	// Keeping this small record outside the active media library prevents a
	// delayed registration from recreating metadata for tombstoned R2 objects.
	mediaAssetDeletionTombstones: defineTable({
		siteUrl: v.string(),
		assetId: v.string(),
		mediaAssetId: v.string(),
		privateKeys: v.array(v.string()),
		publicKeys: v.array(v.string()),
		deletedAt: v.number(),
		deletionRequestedAt: v.optional(v.number()),
		deletionRequestedBy: v.optional(v.string()),
	})
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"])
		.index("by_siteUrl_and_mediaAssetId", ["siteUrl", "mediaAssetId"]),

	// Portfolio galleries and their revisions are distinct from private client
	// delivery galleries. CMS-2.4b adds their behavior; these relations exist
	// now so media deletion can enforce placement usage atomically.
	portfolioGalleries: defineTable({
		siteUrl: v.string(),
		slug: v.string(),
		portfolioOrder: v.number(),
		isPublished: v.boolean(),
		draftRevisionId: v.optional(v.id("portfolioGalleryRevisions")),
		publishedRevisionId: v.optional(v.id("portfolioGalleryRevisions")),
		createdAt: v.number(),
		createdBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
		publishedAt: v.optional(v.number()),
		publishedBy: v.optional(v.string()),
	})
		.index("by_siteUrl_and_slug", ["siteUrl", "slug"])
		.index("by_siteUrl_and_portfolioOrder", ["siteUrl", "portfolioOrder"])
		.index("by_siteUrl_and_isPublished_and_portfolioOrder", [
			"siteUrl",
			"isPublished",
			"portfolioOrder",
		]),

	portfolioGalleryRevisions: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("portfolioGalleries"),
		schemaVersion: v.literal(1),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		slug: v.string(),
		placementCount: v.number(),
		checksum: v.string(),
		source: v.union(
			v.literal("admin"),
			v.literal("sanityImport"),
			v.literal("restore"),
		),
		createdAt: v.number(),
		createdBy: v.string(),
	})
		.index("by_galleryId_and_createdAt", ["galleryId", "createdAt"])
		.index("by_siteUrl_and_galleryId", ["siteUrl", "galleryId"]),

	portfolioPlacements: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("portfolioGalleries"),
		revisionId: v.id("portfolioGalleryRevisions"),
		assetId: v.id("mediaAssets"),
		placementKey: v.string(),
		order: v.number(),
		altText: v.optional(v.string()),
		caption: v.optional(v.string()),
		focalPoint: v.optional(mediaFocalPointValidator),
	})
		.index("by_revisionId_and_order", ["revisionId", "order"])
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"])
		.index("by_galleryId_and_revisionId", ["galleryId", "revisionId"]),

	// Provider-neutral commerce identity. CMS-5.2 exposes only authenticated
	// private drafts; publication remains unreachable until a revision can own
	// and validate a ready, tenant-scoped private print source atomically.
	catalogProducts: defineTable({
		siteUrl: v.string(),
		productKey: v.string(),
		productKind: catalogProductKindValidator,
		// Absent is the exact V1 identity contract. V2 writers always set 2.
		graphVersion: v.optional(v.literal(2)),
		slug: v.optional(v.string()),
		draftRevisionId: v.optional(v.id("catalogProductRevisions")),
		publishedRevisionId: v.optional(v.id("catalogProductRevisions")),
		createdAt: v.number(),
		createdBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
		publishedAt: v.optional(v.number()),
		publishedBy: v.optional(v.string()),
	})
		.index("by_siteUrl_and_productKey", ["siteUrl", "productKey"])
		.index("by_siteUrl_and_slug", ["siteUrl", "slug"])
		.index("by_siteUrl_and_productKind_and_createdAt", [
			"siteUrl",
			"productKind",
			"createdAt",
		])
		.index("by_siteUrl_and_graphVersion_and_productKind_and_createdAt", [
			"siteUrl",
			"graphVersion",
			"productKind",
			"createdAt",
		]),

	// Revisions are immutable commercial snapshots. Product kind and fulfillment
	// mode are separate: a provider adapter may later map production-partner work
	// to LumaPrints without making that provider part of catalog identity.
	catalogProductRevisions: defineTable(v.union(
		catalogProductRevisionV1Validator,
		...catalogProductRevisionV2Validators,
	))
		.index("by_productId_and_createdAt", ["productId", "createdAt"])
		.index("by_siteUrl_and_productId", ["siteUrl", "productId"]),

	// Variant rows belong to exactly one immutable revision. Stable opaque keys
	// and provider-neutral option keys replace array indexes and provider IDs.
	catalogProductVariants: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		variantKey: v.string(),
		order: v.number(),
		materialOptionKey: v.optional(v.string()),
		sizeOptionKey: v.optional(v.string()),
		retailPriceCents: v.optional(v.number()),
		status: catalogVariantStatusValidator,
	})
		.index("by_revisionId_and_order", ["revisionId", "order"])
		.index("by_revisionId_and_variantKey", ["revisionId", "variantKey"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"]),

	// Public-display media remains in the existing web asset registry. These
	// immutable rows cannot point at print masters or paid files by construction.
	catalogProductMediaPlacements: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		assetId: v.id("mediaAssets"),
		placementKey: v.string(),
		role: catalogGraphV2WebMediaRoleValidator,
		order: v.number(),
		altText: v.optional(v.string()),
	})
		.index("by_revisionId_and_role_and_order", ["revisionId", "role", "order"])
		.index("by_revisionId_and_placementKey", ["revisionId", "placementKey"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"])
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"]),

	// Full-resolution print masters and paid files use separate registries and
	// private namespaces. No public URL or download capability is stored here.
	catalogPrintSourceAssets: defineTable(privatePrintSourceAssetValidator)
		.index("by_siteUrl_and_assetKey", ["siteUrl", "assetKey"])
		.index("by_siteUrl_and_sha256", ["siteUrl", "sha256"]),

	catalogDigitalFileAssets: defineTable(paidDigitalFileAssetValidator)
		.index("by_siteUrl_and_assetKey", ["siteUrl", "assetKey"])
		.index("by_siteUrl_and_sha256", ["siteUrl", "sha256"]),

	catalogProductPrintSources: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		assetId: v.id("catalogPrintSourceAssets"),
		relationKey: v.string(),
		order: v.number(),
	})
		.index("by_revisionId_and_order", ["revisionId", "order"])
		.index("by_revisionId_and_relationKey", ["revisionId", "relationKey"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"])
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"]),

	catalogProductSetMembers: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		memberKey: v.string(),
		order: v.number(),
		mediaPlacementKey: v.string(),
		printSourceKey: v.string(),
	})
		.index("by_revisionId_and_order", ["revisionId", "order"])
		.index("by_revisionId_and_memberKey", ["revisionId", "memberKey"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"]),

	catalogProductDigitalFiles: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		assetId: v.id("catalogDigitalFileAssets"),
		relationKey: v.string(),
		version: v.optional(v.string()),
	})
		.index("by_revisionId", ["revisionId"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"])
		.index("by_siteUrl_and_assetId", ["siteUrl", "assetId"]),

	catalogProductShopPlacements: defineTable({
		siteUrl: v.string(),
		productId: v.id("catalogProducts"),
		revisionId: v.id("catalogProductRevisions"),
		featured: v.boolean(),
		orderRank: v.optional(v.string()),
	})
		.index("by_revisionId", ["revisionId"])
		.index("by_productId_and_revisionId", ["productId", "revisionId"]),

	// Print orders (from Stripe checkout on any client site)
	orders: defineTable({
		siteUrl: v.string(),
		orderNumber: v.string(),
		stripeSessionId: v.string(),
		stripePaymentIntentId: v.optional(v.string()),
		// Connected-account context needed by delayed Stripe reads after the
		// webhook request that originally resolved tenant routing has ended.
		stripeConnectedAccountId: v.optional(v.string()),
		customerEmail: v.string(),
		customerName: v.optional(v.string()),
		shippingAddress: v.optional(
			v.object({
				line1: v.string(),
				line2: v.optional(v.string()),
				city: v.string(),
				state: v.string(),
				postalCode: v.string(),
				country: v.string(),
			}),
		),
		items: v.array(
			v.object({
				productName: v.string(),
				quantity: v.number(),
				price: v.number(),
			}),
		),
		subtotal: v.optional(v.number()),
		total: v.number(),
		stripeFees: v.optional(v.number()),
		// Durable lifecycle for the asynchronous Stripe balance-transaction read.
		// Optional for compatibility with orders created before fee capture was
		// checkpointed explicitly.
		stripeFeeCaptureStatus: v.optional(
			v.union(v.literal("pending"), v.literal("captured"), v.literal("failed")),
		),
		stripeFeeCaptureAttempts: v.optional(v.number()),
		stripeFeeCaptureLastAttemptAt: v.optional(v.number()),
		stripeFeeCaptureNextAttemptAt: v.optional(v.number()),
		// Safe machine-readable code, never a raw Stripe response.
		stripeFeeCaptureError: v.optional(stripeFeeCaptureErrorValidator),
		couponCode: v.optional(v.string()),
		discountAmount: v.optional(v.number()),
		fulfillmentType: v.union(
			v.literal("lumaprints"),
			v.literal("self"),
			v.literal("digital"),
		),
		lumaprintsOrderNumber: v.optional(v.string()),
		paperName: v.optional(v.string()),
		paperSubcategoryId: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		// Legacy claim marker for the one-time shipment email side effect.
		// New delivery observability lives in `shipmentEmailDeliveryStatus`.
		shipmentEmailSentAt: v.optional(v.number()),
		shipmentEmailDeliveryStatus: v.optional(
			v.union(
				v.literal("pending"),
				v.literal("sent"),
				v.literal("failed"),
				v.literal("skipped"),
			),
		),
		shipmentEmailDeliveryAttemptedAt: v.optional(v.number()),
		shipmentEmailDeliveryError: v.optional(v.string()),
		status: v.union(
			v.literal("new"),
			v.literal("printing"),
			v.literal("ready"),
			v.literal("shipped"),
			v.literal("delivered"),
			v.literal("refunded"),
			// Permanent fulfillment failure. `fulfillmentError` records the
			// upstream problem; `stripeRefundId` is present only when a refund
			// was successfully created. Do not infer refund/email delivery from
			// this status alone.
			v.literal("fulfillment_error"),
		),
		// Human-readable error from the failed LumaPrints submission.
		fulfillmentError: v.optional(v.string()),
		// Stripe refund ID when automated refund creation succeeded.
		stripeRefundId: v.optional(v.string()),
		// Durable checkpoint for retry-safe permanent fulfillment recovery.
		// `refund_pending` is written before Stripe is called; `refunded` is
		// written only after the refund ID is durable on this order.
		fulfillmentRecoveryStatus: v.optional(
			v.union(v.literal("refund_pending"), v.literal("refunded")),
		),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_stripeSessionId", ["stripeSessionId"])
		.index("by_orderNumber", ["siteUrl", "orderNumber"])
		.index("by_customerEmail", ["siteUrl", "customerEmail"])
		// Hub-owned shipment webhook lookup. LumaPrints order numbers are
		// provider-global; the mutation rejects duplicates rather than guessing.
		.index("by_lumaprintsOrderNumber_global", ["lumaprintsOrderNumber"])
		// Webhook lookup: LumaPrints' shipment.created webhook arrives with
		// only the LumaPrints order number (no Convex _id). Scoped by siteUrl
		// so spokes can't read each other's orders.
		.index("by_lumaprintsOrderNumber", ["siteUrl", "lumaprintsOrderNumber"]),

	// Clients (photography clients + web dev clients)
	photographyClients: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		category: categoryValidator,
		type: v.optional(
			v.union(
				// Photography types
				v.literal("wedding"),
				v.literal("portrait"),
				v.literal("family"),
				v.literal("commercial"),
				v.literal("event"),
				// Web dev types
				v.literal("website"),
				v.literal("redesign"),
				v.literal("maintenance"),
				v.literal("other"),
			),
		),
		status: v.union(
			v.literal("lead"),
			v.literal("booked"),
			v.literal("in-progress"),
			v.literal("completed"),
			v.literal("archived"),
		),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
		siteUrl_client: v.optional(v.string()),
		boardColumnId: v.optional(v.string()),
		boardPosition: v.optional(v.number()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_category", ["siteUrl", "category"])
		.index("by_siteUrl_and_boardColumnId", ["siteUrl", "boardColumnId"]),

	// Invoices — Full tier only
	invoices: defineTable({
		siteUrl: v.string(),
		invoiceNumber: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		invoiceType: v.union(
			v.literal("one-time"),
			v.literal("recurring"),
			v.literal("deposit"),
			v.literal("package"),
			v.literal("milestone"),
		),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("paid"),
			v.literal("partial"),
			v.literal("overdue"),
			v.literal("canceled"),
		),
		items: v.array(
			v.object({
				description: v.string(),
				quantity: v.number(),
				unitPrice: v.number(),
			}),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		sentAt: v.optional(v.number()),
		paidAt: v.optional(v.number()),
		stripeCheckoutSessionId: v.optional(v.string()),
		stripeCheckoutFingerprint: v.optional(v.string()),
		stripeCheckoutStatus: v.optional(
			v.union(v.literal("open"), v.literal("paid"), v.literal("expired"), v.literal("failed")),
		),
		stripeCheckoutStartedAt: v.optional(v.number()),
		stripeCheckoutUpdatedAt: v.optional(v.number()),
		// Recurring config
		recurring: v.optional(
			v.object({
				interval: v.union(
					v.literal("weekly"),
					v.literal("monthly"),
					v.literal("quarterly"),
					v.literal("yearly"),
				),
				nextDueDate: v.optional(v.string()),
				endDate: v.optional(v.string()),
			}),
		),
		// Deposit/milestone tracking
		depositPercent: v.optional(v.number()),
		totalProject: v.optional(v.number()),
		paidAmount: v.optional(v.number()),
		// Milestone tracking
		milestoneName: v.optional(v.string()),
		milestoneIndex: v.optional(v.number()),
		parentInvoiceId: v.optional(v.id("invoices")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_and_invoiceNumber", ["siteUrl", "invoiceNumber"]),

	// Authoritative allocation state for invoice and quote numbers.
	documentNumberCounters: defineTable({
		siteUrl: v.string(),
		documentType: v.union(v.literal("invoice"), v.literal("quote")),
		lastNumber: v.number(),
	}).index("by_siteUrl_and_documentType", ["siteUrl", "documentType"]),

	// Quotes — Full tier only
	quotes: defineTable({
		siteUrl: v.string(),
		quoteNumber: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		category: v.optional(categoryValidator),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("accepted"),
			v.literal("declined"),
			v.literal("expired"),
		),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
		validUntil: v.optional(v.string()),
		notes: v.optional(v.string()),
		sentAt: v.optional(v.number()),
		acceptedAt: v.optional(v.number()),
		convertedToInvoice: v.optional(v.id("invoices")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_and_quoteNumber", ["siteUrl", "quoteNumber"]),

	// Quote presets — saved package configurations for quick loading
	quotePresets: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		category: v.optional(categoryValidator),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
	}).index("by_siteUrl", ["siteUrl"]),

	// Contracts — Full tier only
	contracts: defineTable({
		siteUrl: v.string(),
		title: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		category: v.optional(categoryValidator),
		templateId: v.optional(v.id("contractTemplates")),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("signed"),
			v.literal("expired"),
		),
		body: v.string(),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
		sentAt: v.optional(v.number()),
		signedAt: v.optional(v.number()),
		signedByName: v.optional(v.string()),
		signedByEmail: v.optional(v.string()),
		signatureData: v.optional(v.string()),
		signedIp: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Contract templates — Full tier only
	contractTemplates: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	}).index("by_siteUrl", ["siteUrl"]),

	// Email templates — Full tier only
	emailTemplates: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		category: v.union(
			v.literal("inquiry-reply"),
			v.literal("booking-confirmation"),
			v.literal("reminder"),
			v.literal("gallery-delivery"),
			v.literal("follow-up"),
			v.literal("thank-you"),
			v.literal("custom"),
		),
		subject: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_category", ["siteUrl", "category"]),

	// Platform messages (client <-> creator communication)
	platformMessages: defineTable({
		siteUrl: v.string(),
		sender: v.union(v.literal("client"), v.literal("creator")),
		content: v.string(),
		read: v.boolean(),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_unread", ["siteUrl", "read"])
		.index("by_siteUrl_sender_unread", ["siteUrl", "sender", "read"]),

	// Kanban board configurations — Full tier only
	boardConfigs: defineTable({
		siteUrl: v.string(),
		projectType: v.string(),
		columns: v.array(
			v.object({
				id: v.string(),
				name: v.string(),
				position: v.number(),
			}),
		),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_projectType", ["siteUrl", "projectType"]),

	// Email sending log
	emailLog: defineTable({
		siteUrl: v.string(),
		to: v.string(),
		subject: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("reminder"),
			v.literal("custom"),
		),
		relatedId: v.optional(v.string()),
		status: v.union(v.literal("sent"), v.literal("failed")),
		error: v.optional(v.string()),
		resendId: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_type", ["siteUrl", "type"]),

	// Portal share tokens — public links for clients to view/act on documents
	portalTokens: defineTable({
		token: v.string(),
		siteUrl: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("gallery"),
		),
		documentId: v.string(),
		clientId: v.id("photographyClients"),
		expiresAt: v.optional(v.number()),
		used: v.boolean(),
	})
		.index("by_token", ["token"])
		.index("by_siteUrl", ["siteUrl"])
		.index("by_documentId", ["documentId"]),

	// Tags for categorizing clients
	clientTags: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		color: v.optional(v.string()), // hex color for display
	}).index("by_siteUrl", ["siteUrl"]),

	// Many-to-many: which tags are on which clients
	clientTagAssignments: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		tagId: v.id("clientTags"),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_clientId", ["clientId"])
		.index("by_tagId", ["tagId"])
		// Audit M22: fast point-check for "is this tag assigned to this client?"
		// used by tags.assignTag / tags.removeTag (previously linear take(100) scans).
		.index("by_clientId_and_tagId", ["clientId", "tagId"]),

	// Activity log for tracking interactions
	activityLog: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		action: v.string(),
		description: v.string(),
		metadata: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_clientId", ["clientId"]),

	// Gallery delivery — private photo galleries for client delivery
	galleries: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		name: v.string(),
		slug: v.string(),
		status: v.union(
			v.literal("draft"),
			v.literal("uploading"),
			v.literal("published"),
			v.literal("archived"),
		),
		coverImageKey: v.optional(v.string()),
		imageCount: v.number(),
		totalSizeBytes: v.number(),
		expiresAt: v.optional(v.number()),
		downloadEnabled: v.boolean(),
		favoritesEnabled: v.boolean(),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_and_slug", ["siteUrl", "slug"])
		.index("by_client", ["clientId"]),

	// Gallery password verifiers are deliberately separate from public gallery
	// documents so portal reads can never serialize password material.
	galleryPasswordVerifiers: defineTable({
		galleryId: v.id("galleries"),
		siteUrl: v.string(),
		algorithm: v.literal("scrypt"),
		salt: v.string(),
		hash: v.string(),
		cost: v.number(),
		blockSize: v.number(),
		parallelization: v.number(),
		keyLength: v.number(),
		version: v.string(),
		updatedAt: v.number(),
	})
		.index("by_gallery", ["galleryId"])
		.index("by_siteUrl", ["siteUrl"]),

	// Short-lived bearer grants issued only after a server-side password check.
	// The verifier version binds grants to the current password, making password
	// changes revoke every existing grant without a fan-out delete.
	galleryAccessGrants: defineTable({
		grant: v.string(),
		galleryId: v.id("galleries"),
		portalTokenId: v.id("portalTokens"),
		siteUrl: v.string(),
		verifierVersion: v.string(),
		expiresAt: v.number(),
	})
		.index("by_grant", ["grant"])
		.index("by_gallery", ["galleryId"])
		.index("by_expiresAt", ["expiresAt"]),

	// Token-scoped throttling prevents online password guessing. A successful
	// verification clears the row; lockouts expire automatically by timestamp.
	galleryPasswordAttempts: defineTable({
		portalTokenId: v.id("portalTokens"),
		failures: v.number(),
		windowStartedAt: v.number(),
		lockedUntil: v.optional(v.number()),
	})
		.index("by_portalToken", ["portalTokenId"])
		.index("by_lockedUntil", ["lockedUntil"]),

	// Gallery images — individual photos in a delivery gallery
	galleryImages: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		r2Key: v.string(),
		filename: v.string(),
		sizeBytes: v.number(),
		width: v.number(),
		height: v.number(),
		order: v.number(),
		isFavorite: v.boolean(),
		downloadCount: v.number(),
	})
		.index("by_gallery", ["galleryId"])
		.index("by_siteUrl", ["siteUrl"])
		.index("by_r2Key", ["r2Key"]),

	// Gallery download tracking
	galleryDownloads: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		imageId: v.optional(v.id("galleryImages")),
		downloadedAt: v.number(),
		ipHash: v.string(),
		type: v.union(
			v.literal("single"),
			v.literal("zip"),
			v.literal("favorites"),
		),
	})
		// Audit M23: dropped redundant `by_gallery` — any galleryId-only query
		// also needs tenant scoping via siteUrl, so `by_siteUrl_and_galleryId`
		// covers the same lookups without the duplicate write cost.
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_galleryId", ["siteUrl", "galleryId"]),

	// Contact form inquiries (from public site visitors)
	inquiries: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		email: v.string(),
		phone: v.optional(v.string()),
		subject: v.optional(v.string()),
		message: v.string(),
		status: v.union(v.literal("new"), v.literal("read"), v.literal("replied")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Admin sidebar notification tracking
	adminLastSeen: defineTable({
		siteUrl: v.string(),
		userId: v.string(),
		page: v.string(),
		lastSeenAt: v.number(),
	})
		.index("by_siteUrl_and_userId", ["siteUrl", "userId"])
		.index("by_siteUrl_and_userId_and_page", ["siteUrl", "userId", "page"]),
});
