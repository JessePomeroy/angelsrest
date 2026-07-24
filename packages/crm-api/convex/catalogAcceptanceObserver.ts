import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import {
	CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS,
	CATALOG_EDITOR_CONTINUATION_TTL_MS,
	CATALOG_EDITOR_MAX_ATTEMPTS,
	CATALOG_EDITOR_UPLOAD_ORIGIN,
	CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS,
	canonicalCatalogEditorDeclaration,
	catalogEditorCapabilityDigest,
	catalogEditorDeclarationHash,
	catalogEditorRawCapabilityFingerprint,
	privateObjectKey,
	type CatalogEditorJournalDescriptor,
} from "./helpers/catalogPrivateAssetEditorJournal";
import type { CatalogPrivateAssetFacts } from "./helpers/catalogPrivateAssetReceiptContract";
import {
	validateCatalogPrivateEditorInspectionReceiptSet,
	validateCatalogPrivateEditorStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";

const SITE_URL = "angelsrest.online";
const AGGREGATE_ERROR = "Acceptance aggregate observation failed";
const POINT_ERROR = "Acceptance completed-asset observation failed";

/**
 * Temporary acceptance-window ceilings. Each aggregate read takes one sentinel,
 * so the complete fail-closed budget is 1,340 documents.
 */
const BOUNDS = {
	operations: 4,
	capabilities: 12,
	effects: 12,
	coordinations: 8,
	authorities: 32,
	printAssets: 32,
	digitalAssets: 8,
	products: 64,
	revisions: 128,
	variants: 256,
	mediaPlacements: 256,
	printSources: 128,
	setMembers: 128,
	digitalFiles: 64,
	shopPlacements: 64,
	orders: 128,
} as const;

const ORDER_STATUSES = [
	"new",
	"printing",
	"ready",
	"shipped",
	"delivered",
	"refunded",
	"fulfillment_error",
] as const;
const FULFILLMENT_TYPES = ["lumaprints", "self", "digital"] as const;
const FEE_STATES = ["pending", "captured", "failed"] as const;
const RECOVERY_STATES = ["refund_pending", "refunded"] as const;
const SHIPMENT_EMAIL_STATES = ["pending", "sent", "failed", "skipped"] as const;
const CAPABILITY_PURPOSES = ["upload", "storage", "inspection"] as const;
const EFFECT_KINDS = ["prepare", "storage", "inspection_dispatch"] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type TimedRow = { _creationTime: number };

type CountMap<Key extends string> = Record<Key, number>;

function failIfOverflow<Row>(rows: Row[], limit: number) {
	if (rows.length > limit) throw new Error(AGGREGATE_ERROR);
	return rows;
}

function isSafeTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function highWater(values: readonly number[]) {
	if (values.some((value) => !Number.isFinite(value) || value < 0)) {
		throw new Error(AGGREGATE_ERROR);
	}
	return values.length === 0 ? null : Math.max(...values);
}

function fieldHighWater<Row>(rows: readonly Row[], value: (row: Row) => number | undefined) {
	return highWater(rows.flatMap((row) => {
		const candidate = value(row);
		return candidate === undefined ? [] : [candidate];
	}));
}

function tableCheckpoint<Row extends TimedRow>(
	rows: readonly Row[],
	mutationTime?: (row: Row) => number | undefined,
) {
	return {
		count: rows.length,
		creationHighWater: highWater(rows.map((row) => row._creationTime)),
		...(mutationTime === undefined
			? {}
			: { mutationHighWater: fieldHighWater(rows, mutationTime) }),
	};
}

function zeroCounts<const Keys extends readonly string[]>(keys: Keys): CountMap<Keys[number]> {
	return Object.fromEntries(keys.map((key) => [key, 0])) as CountMap<Keys[number]>;
}

function countBy<const Keys extends readonly string[], Row>(
	rows: readonly Row[],
	keys: Keys,
	value: (row: Row) => Keys[number],
) {
	const counts = zeroCounts(keys);
	for (const row of rows) counts[value(row)] += 1;
	return counts;
}

function checkpointRows<Row extends TimedRow>(rows: readonly Row[], included: (row: Row) => boolean) {
	let count = 0;
	const creationTimes: number[] = [];
	for (const row of rows) {
		if (!included(row)) continue;
		count += 1;
		creationTimes.push(row._creationTime);
	}
	return { count, creationHighWater: highWater(creationTimes) };
}

async function aggregateProjection(ctx: QueryCtx) {
	const [
		operations,
		capabilities,
		effects,
		coordinations,
		authorities,
		printAssets,
		digitalAssets,
		products,
		revisions,
		variants,
		mediaPlacements,
		printSources,
		setMembers,
		digitalFiles,
		shopPlacements,
		orders,
	] = await Promise.all([
		ctx.db.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.operations + 1),
		ctx.db.query("catalogPrivateAssetEditorCapabilities")
			.withIndex("by_siteUrl_and_operationId_and_purpose", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.capabilities + 1),
		ctx.db.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.effects + 1),
		ctx.db.query("catalogPrivateAssetReceiptCoordinations")
			.withIndex("by_siteUrl_and_receiptSetId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.coordinations + 1),
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_siteUrl_and_kind_and_assetKey", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.authorities + 1),
		ctx.db.query("catalogPrintSourceAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.printAssets + 1),
		ctx.db.query("catalogDigitalFileAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.digitalAssets + 1),
		ctx.db.query("catalogProducts")
			.withIndex("by_siteUrl_and_productKey", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.products + 1),
		ctx.db.query("catalogProductRevisions")
			.withIndex("by_siteUrl_and_productId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.revisions + 1),
		ctx.db.query("catalogProductVariants")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.variants + 1),
		ctx.db.query("catalogProductMediaPlacements")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.mediaPlacements + 1),
		ctx.db.query("catalogProductPrintSources")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.printSources + 1),
		ctx.db.query("catalogProductSetMembers")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.setMembers + 1),
		ctx.db.query("catalogProductDigitalFiles")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.digitalFiles + 1),
		ctx.db.query("catalogProductShopPlacements")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.shopPlacements + 1),
		ctx.db.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.take(BOUNDS.orders + 1),
	]);

	const state = {
		operations: failIfOverflow(operations, BOUNDS.operations),
		capabilities: failIfOverflow(capabilities, BOUNDS.capabilities),
		effects: failIfOverflow(effects, BOUNDS.effects),
		coordinations: failIfOverflow(coordinations, BOUNDS.coordinations),
		authorities: failIfOverflow(authorities, BOUNDS.authorities),
		printAssets: failIfOverflow(printAssets, BOUNDS.printAssets),
		digitalAssets: failIfOverflow(digitalAssets, BOUNDS.digitalAssets),
		products: failIfOverflow(products, BOUNDS.products),
		revisions: failIfOverflow(revisions, BOUNDS.revisions),
		variants: failIfOverflow(variants, BOUNDS.variants),
		mediaPlacements: failIfOverflow(mediaPlacements, BOUNDS.mediaPlacements),
		printSources: failIfOverflow(printSources, BOUNDS.printSources),
		setMembers: failIfOverflow(setMembers, BOUNDS.setMembers),
		digitalFiles: failIfOverflow(digitalFiles, BOUNDS.digitalFiles),
		shopPlacements: failIfOverflow(shopPlacements, BOUNDS.shopPlacements),
		orders: failIfOverflow(orders, BOUNDS.orders),
	};

	const publicationPointers = [] as Doc<"catalogProducts">[];
	for (const product of state.products) {
		if (product.publishedRevisionId !== undefined) publicationPointers.push(product);
	}
	const feeCapture = { ...zeroCounts(FEE_STATES), notTracked: 0 };
	const recovery = { ...zeroCounts(RECOVERY_STATES), notTracked: 0 };
	const shipmentEmail = { ...zeroCounts(SHIPMENT_EMAIL_STATES), notTracked: 0 };
	for (const order of state.orders) {
		if (order.stripeFeeCaptureStatus === undefined) feeCapture.notTracked += 1;
		else feeCapture[order.stripeFeeCaptureStatus] += 1;
		if (order.fulfillmentRecoveryStatus === undefined) recovery.notTracked += 1;
		else recovery[order.fulfillmentRecoveryStatus] += 1;
		if (order.shipmentEmailDeliveryStatus === undefined) shipmentEmail.notTracked += 1;
		else shipmentEmail[order.shipmentEmailDeliveryStatus] += 1;
	}

	return {
		interfaceVersion: "cms-5.5e.2c.5.aggregate.v1" as const,
		boundsVersion: 1 as const,
		privateState: {
			operations: tableCheckpoint(state.operations, (row) => row.updatedAt),
			capabilities: tableCheckpoint(state.capabilities, (row) => row.updatedAt),
			effects: tableCheckpoint(state.effects, (row) => row.updatedAt),
			coordinations: tableCheckpoint(state.coordinations, (row) => row.updatedAt),
			authorities: {
				...tableCheckpoint(state.authorities),
				indexedHighWater: fieldHighWater(state.authorities, (row) => row.indexedAt),
			},
			printAssets: {
				...tableCheckpoint(state.printAssets),
				verifiedHighWater: fieldHighWater(state.printAssets, (row) => row.verifiedAt),
			},
			digitalAssets: {
				...tableCheckpoint(state.digitalAssets),
				verifiedHighWater: fieldHighWater(state.digitalAssets, (row) => row.verifiedAt),
			},
		},
		catalog: {
			tables: {
				products: tableCheckpoint(state.products, (row) => row.updatedAt),
				revisions: tableCheckpoint(state.revisions),
				variants: tableCheckpoint(state.variants),
				mediaPlacements: tableCheckpoint(state.mediaPlacements),
				printSources: tableCheckpoint(state.printSources),
				setMembers: tableCheckpoint(state.setMembers),
				digitalFiles: tableCheckpoint(state.digitalFiles),
				shopPlacements: tableCheckpoint(state.shopPlacements),
			},
			publicationPointers: {
				count: publicationPointers.length,
				publishedHighWater: fieldHighWater(publicationPointers, (row) => row.publishedAt),
			},
		},
		commerce: {
			orders: {
				...tableCheckpoint(state.orders),
				statuses: countBy(state.orders, ORDER_STATUSES, (order) => order.status),
			},
			fulfillment: countBy(state.orders, FULFILLMENT_TYPES, (order) => order.fulfillmentType),
			feeCapture: {
				...feeCapture,
				activityHighWater: fieldHighWater(
					state.orders,
					(order) => order.stripeFeeCaptureLastAttemptAt,
				),
			},
			recovery: {
				...recovery,
				...checkpointRows(
					state.orders,
					(order) => order.fulfillmentRecoveryStatus !== undefined,
				),
			},
			lumaPrintsSubmission: checkpointRows(
				state.orders,
				(order) => order.lumaprintsOrderNumber !== undefined,
			),
			tracking: checkpointRows(
				state.orders,
				(order) => order.trackingNumber !== undefined || order.trackingUrl !== undefined,
			),
			shipmentEmail: {
				...shipmentEmail,
				activityHighWater: fieldHighWater(
					state.orders,
					(order) => order.shipmentEmailDeliveryAttemptedAt ?? order.shipmentEmailSentAt,
				),
			},
		},
	};
}

function journalDescriptor(operation: Doc<"catalogPrivateAssetEditorOperations">) {
	if (
		operation.journalVersion !== 1
		|| operation.productKind === undefined
		|| operation.originalFilename === undefined
		|| operation.contentType === undefined
		|| operation.sizeBytes === undefined
		|| operation.sha256 === undefined
	) return null;
	if (
		operation.kind === "print_source"
		&& (operation.productKind === "print" || operation.productKind === "print_set")
		&& (operation.contentType === "image/jpeg" || operation.contentType === "image/png")
		&& operation.widthPixels !== undefined
		&& operation.heightPixels !== undefined
		&& operation.version === undefined
	) {
		return {
			productKind: operation.productKind,
			kind: operation.kind,
			originalFilename: operation.originalFilename,
			contentType: operation.contentType,
			sizeBytes: operation.sizeBytes,
			sha256: operation.sha256,
			widthPixels: operation.widthPixels,
			heightPixels: operation.heightPixels,
		} satisfies CatalogEditorJournalDescriptor;
	}
	if (
		operation.kind === "paid_digital_file"
		&& operation.productKind === "digital_download"
		&& operation.contentType === "application/zip"
		&& operation.widthPixels === undefined
		&& operation.heightPixels === undefined
	) {
		return {
			productKind: operation.productKind,
			kind: operation.kind,
			originalFilename: operation.originalFilename,
			contentType: operation.contentType,
			sizeBytes: operation.sizeBytes,
			sha256: operation.sha256,
			...(operation.version === undefined ? {} : { version: operation.version }),
		} satisfies CatalogEditorJournalDescriptor;
	}
	return null;
}

function factsMatch(
	left: CatalogPrivateAssetFacts,
	right: CatalogPrivateAssetFacts,
) {
	return left.kind === right.kind
		&& left.assetKey === right.assetKey
		&& left.privateObjectKey === right.privateObjectKey
		&& left.originalFilename === right.originalFilename
		&& left.mimeType === right.mimeType
		&& left.sizeBytes === right.sizeBytes
		&& left.sha256 === right.sha256
		&& left.provenance.provider === "editor_upload"
		&& right.provenance.provider === "editor_upload"
		&& left.provenance.sourceId === right.provenance.sourceId
		&& (left.kind === "print_source"
			? right.kind === "print_source"
				&& left.widthPixels === right.widthPixels
				&& left.heightPixels === right.heightPixels
			: right.kind === "paid_digital_file"
				&& (left.version ?? undefined) === (right.version ?? undefined));
}

function targetMatchesFacts(
	target: Doc<"catalogPrintSourceAssets"> | Doc<"catalogDigitalFileAssets">,
	facts: CatalogPrivateAssetFacts,
	storageReceivedAt: number,
	verifiedAt: number,
) {
	return target.siteUrl === SITE_URL
		&& target.status === "verified"
		&& target.assetKey === facts.assetKey
		&& target.privateObjectKey === facts.privateObjectKey
		&& target.originalFilename === facts.originalFilename
		&& target.mimeType === facts.mimeType
		&& target.sizeBytes === facts.sizeBytes
		&& target.sha256 === facts.sha256
		&& target.provenance.provider === "editor_upload"
		&& facts.provenance.provider === "editor_upload"
		&& target.provenance.sourceId === facts.provenance.sourceId
		&& target.createdAt === storageReceivedAt
		&& target.createdBy === "cms-catalog-storage-receipt:v1"
		&& target.verifiedAt === verifiedAt
		&& target.verifiedBy === "cms-catalog-evidence-match:v1"
		&& (facts.kind === "print_source"
			? "widthPixels" in target
				&& target.widthPixels === facts.widthPixels
				&& target.heightPixels === facts.heightPixels
			: !("widthPixels" in target)
				&& (target.version ?? undefined) === (facts.version ?? undefined));
}

async function capabilitiesAreValid(
	rows: readonly Doc<"catalogPrivateAssetEditorCapabilities">[],
	operation: Doc<"catalogPrivateAssetEditorOperations">,
) {
	if (
		rows.length !== 3
		|| new Set(rows.map((row) => row.purpose)).size !== 3
		|| new Set(rows.map((row) => row.digest)).size !== 3
		|| new Set(rows.map((row) => row.rawFingerprint)).size !== 3
		|| new Set(rows.map((row) => row.issuedAt)).size !== 1
	) return false;
	for (const row of rows) {
		if (
			row.siteUrl !== SITE_URL
			|| row.operationId !== operation.operationId
			|| row.generation !== 1
			|| row.rawFingerprint === undefined
			|| !isSafeTimestamp(row.issuedAt)
			|| !isSafeTimestamp(row.expiresAt)
			|| !isSafeTimestamp(row.purgeAt)
			|| !isSafeTimestamp(row.createdAt)
			|| !isSafeTimestamp(row.updatedAt)
			|| row.issuedAt < operation.createdAt - 60_000
			|| row.createdAt > row.updatedAt
			|| row.expiresAt - row.issuedAt !== (
				row.purpose === "upload"
					? CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS
					: CATALOG_EDITOR_CONTINUATION_TTL_MS
			)
			|| row.purgeAt !== row.expiresAt + CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS
			|| (row.purgedAt === undefined) !== (row.value !== undefined)
			|| (row.purgedAt !== undefined && (
				!isSafeTimestamp(row.purgedAt) || row.purgedAt < row.purgeAt
			))
		) return false;
		if (row.value !== undefined && (
			await catalogEditorCapabilityDigest(row.purpose, row.value) !== row.digest
			|| await catalogEditorRawCapabilityFingerprint(row.value) !== row.rawFingerprint
		)) return false;
	}
	return true;
}

function effectsAreValid(
	rows: readonly Doc<"catalogPrivateAssetEditorEffects">[],
	operation: Doc<"catalogPrivateAssetEditorOperations">,
) {
	if (rows.length !== 3 || new Set(rows.map((row) => row.kind)).size !== 3) return false;
	for (const row of rows) {
		if (
			row.siteUrl !== SITE_URL
			|| row.operationId !== operation.operationId
			|| row.generation !== 1
			|| row.state !== "acknowledged"
			|| !Number.isSafeInteger(row.attempts)
			|| row.attempts < 0
			|| row.attempts > CATALOG_EDITOR_MAX_ATTEMPTS
			|| !isSafeTimestamp(row.nextAttemptAt)
			|| !isSafeTimestamp(row.createdAt)
			|| !isSafeTimestamp(row.updatedAt)
			|| !isSafeTimestamp(row.acknowledgedAt)
			|| row.createdAt > row.updatedAt
			|| row.createdAt > row.acknowledgedAt
			|| row.acknowledgedAt > row.updatedAt
		) return false;
		if (row.kind === "prepare") {
			if (
				row.attempts !== 0
				|| row.lastOutcome !== "success"
				|| row.leaseDigest !== undefined
				|| row.leaseExpiresAt !== undefined
				|| row.lastAckLeaseDigest !== undefined
				|| row.lastAckOutcome !== undefined
				|| row.lastAckStatus !== undefined
				|| row.lastAckRetryAt !== undefined
			) return false;
			continue;
		}
		if (row.lastOutcome !== "success" && row.lastOutcome !== "reconciled") return false;
		if (row.lastOutcome === "success" && (
			row.leaseDigest !== undefined
			|| row.leaseExpiresAt !== undefined
			|| row.lastAckLeaseDigest === undefined
			|| row.lastAckOutcome !== "success"
			|| row.lastAckStatus !== "acknowledged"
			|| row.lastAckRetryAt !== undefined
		)) return false;
		if (row.lastOutcome === "reconciled" && (
			(row.leaseDigest === undefined) !== (row.leaseExpiresAt === undefined)
			|| (row.leaseExpiresAt !== undefined && !isSafeTimestamp(row.leaseExpiresAt))
			|| row.lastAckLeaseDigest !== undefined
			|| row.lastAckOutcome !== undefined
			|| row.lastAckStatus !== undefined
			|| row.lastAckRetryAt !== undefined
		)) return false;
	}
	return true;
}

async function pointProjection(
	ctx: QueryCtx,
	assetId: Doc<"catalogPrintSourceAssets">["_id"] | Doc<"catalogDigitalFileAssets">["_id"],
) {
	const printId = ctx.db.normalizeId("catalogPrintSourceAssets", assetId);
	const digitalId = printId ? null : ctx.db.normalizeId("catalogDigitalFileAssets", assetId);
	if (!printId && !digitalId) throw new Error(POINT_ERROR);

	const resolved = printId
		? {
				kind: "print_source" as const,
				assetId: printId,
				target: await ctx.db.get(printId),
				authority: await ctx.db.query("catalogPrivateAssetTargetAuthorities")
					.withIndex("by_siteUrl_and_kind_and_assetId", (q) =>
						q.eq("siteUrl", SITE_URL).eq("kind", "print_source").eq("assetId", printId)
					)
					.unique(),
				attached: (await ctx.db.query("catalogProductPrintSources")
					.withIndex("by_siteUrl_and_assetId", (q) =>
						q.eq("siteUrl", SITE_URL).eq("assetId", printId)
					)
					.take(1)).length > 0,
			}
		: {
				kind: "paid_digital_file" as const,
				assetId: digitalId!,
				target: await ctx.db.get(digitalId!),
				authority: await ctx.db.query("catalogPrivateAssetTargetAuthorities")
					.withIndex("by_siteUrl_and_kind_and_assetId", (q) =>
						q.eq("siteUrl", SITE_URL)
							.eq("kind", "paid_digital_file")
							.eq("assetId", digitalId!)
					)
					.unique(),
				attached: (await ctx.db.query("catalogProductDigitalFiles")
					.withIndex("by_siteUrl_and_assetId", (q) =>
						q.eq("siteUrl", SITE_URL).eq("assetId", digitalId!)
					)
					.take(1)).length > 0,
			};

	const { target, authority } = resolved;
	if (!target || !authority) throw new Error(POINT_ERROR);
	const [globalAuthority, keyAuthority] = await Promise.all([
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_kind_and_assetId", (q) =>
				q.eq("kind", resolved.kind).eq("assetId", resolved.assetId)
			)
			.unique(),
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_siteUrl_and_kind_and_assetKey", (q) =>
				q.eq("siteUrl", SITE_URL)
					.eq("kind", resolved.kind)
					.eq("assetKey", target.assetKey)
			)
			.unique(),
	]);
	if (
		!globalAuthority
		|| !keyAuthority
		|| globalAuthority._id !== authority._id
		|| keyAuthority._id !== authority._id
		|| resolved.attached
		|| target.siteUrl !== SITE_URL
		|| authority.siteUrl !== SITE_URL
		|| authority.kind !== resolved.kind
		|| authority.assetId !== resolved.assetId
		|| authority.assetKey !== target.assetKey
		|| authority.originSchemaVersion !== 2
		|| !isSafeTimestamp(authority.indexedAt)
	) throw new Error(POINT_ERROR);

	const coordination = await ctx.db.get(authority.originCoordinationId);
	if (
		!coordination
		|| coordination.siteUrl !== SITE_URL
		|| coordination.status !== "verified"
		|| coordination.receiptSetId !== authority.originReceiptSetId
		|| coordination.receiptSetId !== coordination.storageReceiptSet.receiptSetId
		|| coordination.receiptSetId !== coordination.inspectionReceiptSet.receiptSetId
		|| coordination.storageReceiptSet.siteUrl !== SITE_URL
		|| coordination.inspectionReceiptSet.siteUrl !== SITE_URL
		|| coordination.storageReceiptSet.schemaVersion !== 2
		|| coordination.inspectionReceiptSet.schemaVersion !== 2
		|| coordination.storageReceiptSet.receipts.length !== 1
		|| coordination.inspectionReceiptSet.receipts.length !== 1
		|| coordination.targets.length !== 1
		|| !("targetResolutionVersion" in coordination)
		|| !("targetBindings" in coordination)
		|| coordination.targetResolutionVersion !== 1
		|| coordination.targetBindings?.length !== 1
		|| !isSafeTimestamp(coordination.createdAt)
		|| !isSafeTimestamp(coordination.updatedAt)
		|| !isSafeTimestamp(coordination.storageReceivedAt)
		|| !isSafeTimestamp(coordination.inspectionReceivedAt)
		|| !isSafeTimestamp(coordination.verifiedAt)
		|| coordination.createdAt !== Math.min(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.verifiedAt < Math.max(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.updatedAt !== coordination.verifiedAt
		|| authority.indexedAt !== coordination.verifiedAt
	) throw new Error(POINT_ERROR);

	const mapping = coordination.targets[0];
	const binding = coordination.targetBindings[0];
	if (
		!mapping
		|| !binding
		|| mapping.kind !== resolved.kind
		|| mapping.assetId !== resolved.assetId
		|| mapping.assetKey !== target.assetKey
		|| binding.kind !== resolved.kind
		|| binding.assetId !== resolved.assetId
		|| binding.assetKey !== target.assetKey
		|| binding.resolution !== "created"
		|| binding.authorityId !== authority._id
	) throw new Error(POINT_ERROR);

	const [storage, inspection] = await Promise.all([
		validateCatalogPrivateEditorStorageReceiptSet(coordination.storageReceiptSet),
		validateCatalogPrivateEditorInspectionReceiptSet(coordination.inspectionReceiptSet),
	]);
	const storageFacts = storage.facts[0];
	const inspectionFacts = inspection.facts[0];
	if (
		!storageFacts
		|| !inspectionFacts
		|| !factsMatch(storageFacts, inspectionFacts)
		|| storage.operation.operationId !== inspection.operation.operationId
		|| storage.operation.sourceId !== inspection.operation.sourceId
		|| storage.operation.kind !== resolved.kind
		|| inspection.operation.kind !== resolved.kind
		|| storage.operation.assetKey !== target.assetKey
		|| storage.operation.privateObjectKey !== target.privateObjectKey
		|| storage.assetSetChecksum !== coordination.assetSetChecksum
		|| inspection.assetSetChecksum !== coordination.assetSetChecksum
		|| storage.roleChecksum !== coordination.storageReceiptChecksum
		|| inspection.roleChecksum !== coordination.inspectionReceiptChecksum
		|| !targetMatchesFacts(
			target,
			storageFacts,
			coordination.storageReceivedAt,
			coordination.verifiedAt,
		)
	) throw new Error(POINT_ERROR);

	const operation = await ctx.db.query("catalogPrivateAssetEditorOperations")
		.withIndex("by_siteUrl_and_operationId", (q) =>
			q.eq("siteUrl", SITE_URL).eq("operationId", storage.operation.operationId)
		)
		.unique();
	const descriptor = operation ? journalDescriptor(operation) : null;
	if (
		!operation
		|| !descriptor
		|| operation.siteUrl !== SITE_URL
		|| operation.journalVersion !== 1
		|| operation.generation !== 1
		|| operation.lifecycle !== "verified"
		|| operation.receiptSetId !== coordination.receiptSetId
		|| operation.assetSetChecksum !== coordination.assetSetChecksum
		|| operation.sourceId !== storage.operation.sourceId
		|| operation.kind !== resolved.kind
		|| operation.assetKey !== target.assetKey
		|| operation.privateObjectKey !== target.privateObjectKey
		|| operation.uploadOrigin !== CATALOG_EDITOR_UPLOAD_ORIGIN
		|| operation.uploadHandleHash === undefined
		|| !SHA256_PATTERN.test(operation.uploadHandleHash)
		|| operation.updatedAt === undefined
		|| operation.prepareCommittedAt === undefined
		|| operation.storageReceivedAt === undefined
		|| operation.inspectionReceivedAt === undefined
		|| ![
			operation.createdAt,
			operation.updatedAt,
			operation.prepareCommittedAt,
			operation.storageReceivedAt,
			operation.inspectionReceivedAt,
		].every(isSafeTimestamp)
		|| operation.createdAt > operation.prepareCommittedAt
		|| operation.prepareCommittedAt > operation.storageReceivedAt
		|| operation.prepareCommittedAt > operation.inspectionReceivedAt
		|| operation.storageReceivedAt > operation.updatedAt
		|| operation.inspectionReceivedAt > operation.updatedAt
		|| descriptor.originalFilename !== storageFacts.originalFilename
		|| descriptor.contentType !== storageFacts.mimeType
		|| descriptor.sizeBytes !== storageFacts.sizeBytes
		|| descriptor.sha256 !== storageFacts.sha256
		|| (descriptor.kind === "print_source"
			? storageFacts.kind !== "print_source"
				|| descriptor.widthPixels !== storageFacts.widthPixels
				|| descriptor.heightPixels !== storageFacts.heightPixels
			: storageFacts.kind !== "paid_digital_file"
				|| (descriptor.version ?? undefined) !== (storageFacts.version ?? undefined))
		|| operation.privateObjectKey !== privateObjectKey(SITE_URL, operation.operationId, descriptor.kind)
	) throw new Error(POINT_ERROR);
	const canonical = canonicalCatalogEditorDeclaration(SITE_URL, operation.operationId, descriptor);
	if (
		operation.canonicalDeclaration !== canonical
		|| operation.declarationHash !== await catalogEditorDeclarationHash(canonical)
	) throw new Error(POINT_ERROR);

	const capabilities = await Promise.all(CAPABILITY_PURPOSES.map(async (purpose) =>
		await ctx.db.query("catalogPrivateAssetEditorCapabilities")
			.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
				q.eq("siteUrl", SITE_URL)
					.eq("operationId", operation.operationId)
					.eq("purpose", purpose)
			)
			.unique()
	));
	const effects = await Promise.all(EFFECT_KINDS.map(async (kind) =>
		await ctx.db.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", SITE_URL)
					.eq("operationId", operation.operationId)
					.eq("kind", kind)
			)
			.unique()
	));
	if (
		capabilities.some((row) => row === null)
		|| effects.some((row) => row === null)
		|| !await capabilitiesAreValid(
			capabilities as Doc<"catalogPrivateAssetEditorCapabilities">[],
			operation,
		)
		|| !effectsAreValid(effects as Doc<"catalogPrivateAssetEditorEffects">[], operation)
	) throw new Error(POINT_ERROR);

	return {
		interfaceVersion: "cms-5.5e.2c.5.point.v1" as const,
		result: "verified_unattached" as const,
		checks: {
			journal: true as const,
			effects: true as const,
			coordination: true as const,
			authority: true as const,
			target: true as const,
			unattached: true as const,
		},
	};
}

/** Temporary CLI-only, hard-pinned aggregate evidence for one acceptance window. */
export const observeAggregate = internalQuery({
	args: {},
	handler: async (ctx) => {
		try {
			return await aggregateProjection(ctx);
		} catch {
			throw new Error(AGGREGATE_ERROR);
		}
	},
});

/** Temporary CLI-only proof for one completed browser-safe private asset ID. */
export const observeCompletedAsset = internalQuery({
	args: {
		assetId: v.union(v.id("catalogPrintSourceAssets"), v.id("catalogDigitalFileAssets")),
	},
	handler: async (ctx, { assetId }) => {
		try {
			return await pointProjection(ctx, assetId);
		} catch {
			throw new Error(POINT_ERROR);
		}
	},
});
