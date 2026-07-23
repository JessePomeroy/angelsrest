import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import {
	CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
	createCatalogPrivateAssetV2CanarySnapshot,
	requireCatalogPrivateAssetV2CanaryInspectionReceipt,
	requireCatalogPrivateAssetV2CanaryStorageReceipt,
} from "./helpers/catalogPrivateAssetCanarySnapshot";
import {
	catalogPrivateEditorReceiptError,
	isCatalogPrivateEditorExpectedValidationError,
} from "./helpers/catalogPrivateAssetEditorErrors";
import {
	CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS,
	CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS,
	CATALOG_EDITOR_CONTINUATION_TTL_MS,
	CATALOG_EDITOR_INSPECTION_LEASE_MS,
	CATALOG_EDITOR_MAX_ATTEMPTS,
	CATALOG_EDITOR_STORAGE_LEASE_MS,
	CATALOG_EDITOR_SUPPORTED_SITE,
	CATALOG_EDITOR_UPLOAD_ORIGIN,
	CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS,
	canonicalCatalogEditorDeclaration,
	catalogEditorCapabilityDigest,
	catalogEditorDeclarationHash,
	catalogEditorJournalError,
	catalogEditorRawCapabilityFingerprint,
	catalogEditorRetryDelayMs,
	createCatalogEditorWorkerDeclaration,
	isCatalogEditorCapabilityValue,
	parseCatalogEditorBeginBody,
	privateObjectKey,
	productKindMatchesAssetKind,
	type CatalogEditorJournalDescriptor,
} from "./helpers/catalogPrivateAssetEditorJournal";
import {
	type CatalogPrivateInspectionReceiptSet,
	type CatalogPrivateStorageReceiptSet,
	catalogPrivateInspectionReceiptSetValidator,
	catalogPrivateStorageReceiptSetValidator,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN,
	claimsCatalogPrivateEditorOperation,
	sameCatalogPrivateInspectionReceiptSet,
	sameCatalogPrivateStorageReceiptSet,
	validateCatalogPrivateEditorInspectionReceiptSet,
	validateCatalogPrivateEditorStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";
import {
	recordCatalogPrivateInspectionReceiptSet,
	recordCatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetRegistry";
import {
	backfillPrivateCatalogTargetAuthorities,
	requireVerifiedPrivateCatalogTargets,
} from "./helpers/catalogPrivateAssetRegistryTargets";
import {
	toEditorSafePaidDigitalFileAsset,
	toEditorSafePrivatePrintSourceAsset,
} from "./helpers/catalogPrivateAssetValidators";
import { requireCatalogProductKindEnabled } from "./helpers/catalogProductPolicy";
import { catalogProductKindValidator } from "./helpers/catalogProductValidators";

function editorAdmissionResult(
	result: Awaited<ReturnType<typeof recordCatalogPrivateStorageReceiptSet>>,
) {
	return {
		status: result.status,
		replayed: result.replayed,
		assetCount: result.status === "verified" ? 1 : result.assetCount,
	};
}

type CheckedEditorReceipt =
	| Awaited<ReturnType<typeof validateCatalogPrivateEditorStorageReceiptSet>>
	| Awaited<ReturnType<typeof validateCatalogPrivateEditorInspectionReceiptSet>>;

function journalDescriptor(operation: Doc<"catalogPrivateAssetEditorOperations">) {
	if (
		operation.journalVersion !== 1
		|| !operation.productKind
		|| !operation.originalFilename
		|| !operation.contentType
		|| operation.sizeBytes === undefined
		|| !operation.sha256
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

async function requireReservedOperationMatchesReceipt(
	operation: Doc<"catalogPrivateAssetEditorOperations">,
	checked: CheckedEditorReceipt,
) {
	if (operation.journalVersion !== 1) return;
	const descriptor = journalDescriptor(operation);
	const facts = checked.facts[0];
	if (!descriptor || !facts) throw catalogPrivateEditorReceiptError("conflict");
	const canonical = canonicalCatalogEditorDeclaration(
		operation.siteUrl,
		operation.operationId,
		descriptor,
	);
	const expectedDeclarationHash = await catalogEditorDeclarationHash(canonical);
	if (
		operation.uploadOrigin !== CATALOG_EDITOR_UPLOAD_ORIGIN
		|| operation.uploadHandleHash === undefined
		|| operation.generation !== 1
		|| operation.lifecycle === undefined
		|| operation.updatedAt === undefined
		|| operation.canonicalDeclaration !== canonical
		|| operation.declarationHash !== expectedDeclarationHash
		|| operation.sourceId !== `editor-upload:${operation.operationId}`
		|| operation.assetKey !== `editor-upload-${operation.operationId}`
		|| operation.privateObjectKey !== privateObjectKey(
			operation.siteUrl,
			operation.operationId,
			operation.kind,
		)
		|| !productKindMatchesAssetKind(descriptor.productKind, facts.kind)
		|| facts.kind !== descriptor.kind
		|| facts.originalFilename !== descriptor.originalFilename
		|| facts.mimeType !== descriptor.contentType
		|| facts.sizeBytes !== descriptor.sizeBytes
		|| facts.sha256 !== descriptor.sha256
		|| facts.assetKey !== operation.assetKey
		|| facts.privateObjectKey !== operation.privateObjectKey
		|| facts.provenance.provider !== "editor_upload"
		|| facts.provenance.sourceId !== operation.sourceId
		|| (facts.kind === "print_source"
			? descriptor.kind !== "print_source"
				|| facts.widthPixels !== descriptor.widthPixels
				|| facts.heightPixels !== descriptor.heightPixels
			: descriptor.kind !== "paid_digital_file"
				|| (facts.version ?? undefined) !== (descriptor.version ?? undefined))
	) throw catalogPrivateEditorReceiptError("conflict");
}

async function bindEditorOperation(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
	checked: CheckedEditorReceipt,
) {
	const { operation } = checked;
	// Convex tracks this indexed read and the insert in one mutation transaction.
	// Concurrent snapshots that both observe no binding conflict under OCC and are
	// retried against the winner before any coordination or target write commits.
	const existing = await ctx.db
		.query("catalogPrivateAssetEditorOperations")
		.withIndex("by_siteUrl_and_operationId", (q) =>
			q.eq("siteUrl", receiptSet.siteUrl).eq("operationId", operation.operationId),
		)
		.unique();
	const binding = {
		siteUrl: receiptSet.siteUrl,
		operationId: operation.operationId,
		sourceId: operation.sourceId,
		receiptSetId: receiptSet.receiptSetId,
		assetSetChecksum: checked.assetSetChecksum,
		kind: operation.kind,
		assetKey: operation.assetKey,
		privateObjectKey: operation.privateObjectKey,
	};
	if (!existing) {
		const id = await ctx.db.insert("catalogPrivateAssetEditorOperations", {
			...binding,
			createdAt: Date.now(),
		});
		const inserted = await ctx.db.get(id);
		if (!inserted) throw catalogPrivateEditorReceiptError("conflict");
		return inserted;
	}
	await requireReservedOperationMatchesReceipt(existing, checked);
	if (
		existing.siteUrl !== binding.siteUrl
		|| existing.operationId !== binding.operationId
		|| existing.sourceId !== binding.sourceId
		|| (existing.receiptSetId !== undefined
			&& existing.receiptSetId !== binding.receiptSetId)
		|| (existing.assetSetChecksum !== undefined
			&& existing.assetSetChecksum !== binding.assetSetChecksum)
		|| (existing.receiptSetId === undefined) !== (existing.assetSetChecksum === undefined)
		|| existing.kind !== binding.kind
		|| existing.assetKey !== binding.assetKey
		|| existing.privateObjectKey !== binding.privateObjectKey
	) throw catalogPrivateEditorReceiptError("conflict");
	if (existing.receiptSetId === undefined) {
		await ctx.db.patch(existing._id, {
			receiptSetId: binding.receiptSetId,
			assetSetChecksum: binding.assetSetChecksum,
			...(existing.journalVersion === 1 ? { updatedAt: Date.now() } : {}),
		});
		return { ...existing, receiptSetId: binding.receiptSetId, assetSetChecksum: binding.assetSetChecksum };
	}
	return existing;
}

async function requireNoEditorRoleDrift(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
	checked: CheckedEditorReceipt,
	role: "storage" | "inspection",
) {
	const coordination = await ctx.db
		.query("catalogPrivateAssetReceiptCoordinations")
		.withIndex("by_siteUrl_and_receiptSetId", (q) =>
			q.eq("siteUrl", receiptSet.siteUrl).eq("receiptSetId", receiptSet.receiptSetId),
		)
		.unique();
	if (!coordination) return;
	if (coordination.assetSetChecksum !== checked.assetSetChecksum) {
		throw catalogPrivateEditorReceiptError("conflict");
	}
	if (
		role === "storage" &&
		"storageReceiptSet" in coordination &&
		!sameCatalogPrivateStorageReceiptSet(
			coordination.storageReceiptSet,
			receiptSet as CatalogPrivateStorageReceiptSet,
		)
	)
		throw catalogPrivateEditorReceiptError("conflict");
	if (
		role === "inspection" &&
		"inspectionReceiptSet" in coordination &&
		!sameCatalogPrivateInspectionReceiptSet(
			coordination.inspectionReceiptSet,
			receiptSet as CatalogPrivateInspectionReceiptSet,
		)
	)
		throw catalogPrivateEditorReceiptError("conflict");
}

async function validateEditorStorageReceipt(receiptSet: CatalogPrivateStorageReceiptSet) {
	try {
		return await validateCatalogPrivateEditorStorageReceiptSet(receiptSet);
	} catch (error) {
		if (!isCatalogPrivateEditorExpectedValidationError(error)) throw error;
		throw catalogPrivateEditorReceiptError("validation");
	}
}

async function validateEditorInspectionReceipt(receiptSet: CatalogPrivateInspectionReceiptSet) {
	try {
		return await validateCatalogPrivateEditorInspectionReceiptSet(receiptSet);
	} catch (error) {
		if (!isCatalogPrivateEditorExpectedValidationError(error)) throw error;
		throw catalogPrivateEditorReceiptError("validation");
	}
}

async function admitEditorStorageReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	const checked = await validateEditorStorageReceipt(receiptSet);
	const operation = await bindEditorOperation(ctx, receiptSet, checked);
	await requireNoEditorRoleDrift(ctx, receiptSet, checked, "storage");
	return operation;
}

async function admitEditorInspectionReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	const checked = await validateEditorInspectionReceipt(receiptSet);
	const operation = await bindEditorOperation(ctx, receiptSet, checked);
	await requireNoEditorRoleDrift(ctx, receiptSet, checked, "inspection");
	return operation;
}

async function admitHistoricalEditorStorageReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	return claimsCatalogPrivateEditorOperation(receiptSet)
		? await admitEditorStorageReceipt(ctx, receiptSet)
		: null;
}

async function admitHistoricalEditorInspectionReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	return claimsCatalogPrivateEditorOperation(receiptSet)
		? await admitEditorInspectionReceipt(ctx, receiptSet)
		: null;
}

async function reconcileJournalStorageEvidence(
	ctx: MutationCtx,
	operation: Doc<"catalogPrivateAssetEditorOperations">,
	verified: boolean,
) {
	if (operation.journalVersion !== 1) return;
	const now = Date.now();
	const [storageEffect, inspectionCapability, inspectionEffect] = await Promise.all([
		ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", operation.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("kind", "storage"),
			)
			.unique(),
		ctx.db
			.query("catalogPrivateAssetEditorCapabilities")
			.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
				q.eq("siteUrl", operation.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("purpose", "inspection"),
			)
			.unique(),
		ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", operation.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("kind", "inspection_dispatch"),
			)
			.unique(),
	]);
	if (!storageEffect || !inspectionCapability || operation.prepareCommittedAt === undefined) {
		throw catalogPrivateEditorReceiptError("conflict");
	}
	const currentInspectionCapability = inspectionCapability.generation === operation.generation
		&& inspectionCapability.value !== undefined;
	const freshInspectionClaimAvailable = currentInspectionCapability
		&& inspectionCapability.expiresAt - now >= (
			CATALOG_EDITOR_INSPECTION_LEASE_MS + CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS
		);
	const activeInspectionLease = currentInspectionCapability
		&& inspectionCapability.expiresAt > now
		&& inspectionEffect !== null
		&& inspectionEffect.generation === operation.generation
		&& inspectionEffect.state === "leased"
		&& inspectionEffect.leaseDigest !== undefined
		&& (inspectionEffect.leaseExpiresAt ?? 0) > now;
	const inspectionRecoverable = freshInspectionClaimAvailable || activeInspectionLease;
	await ctx.db.patch(storageEffect._id, {
		state: "acknowledged",
		lastOutcome: "reconciled",
		updatedAt: now,
		acknowledgedAt: now,
	});
	if (!inspectionEffect) {
		await ctx.db.insert("catalogPrivateAssetEditorEffects", {
			siteUrl: operation.siteUrl,
			operationId: operation.operationId,
			kind: "inspection_dispatch",
			generation: inspectionCapability.generation,
			state: verified ? "acknowledged" : inspectionRecoverable ? "queued" : "failed",
			attempts: 0,
			nextAttemptAt: now,
			...(verified
				? { lastOutcome: "reconciled" as const, acknowledgedAt: now }
				: inspectionRecoverable ? {} : { lastOutcome: "expired" as const }),
			createdAt: now,
			updatedAt: now,
		});
	} else if (verified) {
		await ctx.db.patch(inspectionEffect._id, {
			state: "acknowledged",
			lastOutcome: "reconciled",
			updatedAt: now,
			acknowledgedAt: now,
		});
	} else if (!inspectionRecoverable) {
		await ctx.db.patch(inspectionEffect._id, {
			state: "failed",
			lastOutcome: "expired",
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			updatedAt: now,
		});
	}
	await ctx.db.patch(operation._id, {
		lifecycle: verified ? "verified" : inspectionRecoverable ? "storage_recorded" : "expired",
		storageReceivedAt: operation.storageReceivedAt ?? now,
		...(verified ? { inspectionReceivedAt: operation.inspectionReceivedAt ?? now } : {}),
		updatedAt: now,
	});
}

async function reconcileJournalInspectionEvidence(
	ctx: MutationCtx,
	operation: Doc<"catalogPrivateAssetEditorOperations">,
	verified: boolean,
) {
	if (operation.journalVersion !== 1) return;
	const now = Date.now();
	const inspectionEffect = await ctx.db
		.query("catalogPrivateAssetEditorEffects")
		.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
			q.eq("siteUrl", operation.siteUrl)
				.eq("operationId", operation.operationId)
				.eq("kind", "inspection_dispatch"),
		)
		.unique();
	// An inspection receipt may arrive first through the retained ingress. It is
	// evidence, but it must not create or queue the dispatch effect before storage.
	if (inspectionEffect) {
		await ctx.db.patch(inspectionEffect._id, {
			state: "acknowledged",
			lastOutcome: "reconciled",
			updatedAt: now,
			acknowledgedAt: now,
		});
	}
	await ctx.db.patch(operation._id, {
		...(verified ? { lifecycle: "verified" as const } : {}),
		inspectionReceivedAt: operation.inspectionReceivedAt ?? now,
		updatedAt: now,
	});
}

/** Acceptance-only, bounded and redacted production state projection. */
export const getV2CanarySnapshot = internalQuery({
	args: {},
	handler: async (ctx) => await createCatalogPrivateAssetV2CanarySnapshot(ctx),
});

/** Bounded operator backfill; empty args select only the acceptance canary's exact V1 set. */
export const backfillTargetAuthorities = internalMutation({
	args: { siteUrl: v.optional(v.string()), receiptSetId: v.optional(v.string()) },
	handler: async (ctx, { siteUrl, receiptSetId }) => {
		if ((siteUrl === undefined) !== (receiptSetId === undefined)) {
			throw new Error("Private catalog authority backfill identity is incomplete");
		}
		return await backfillPrivateCatalogTargetAuthorities(
			ctx,
			siteUrl ?? CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION.siteUrl,
			receiptSetId ?? CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION.v1ReceiptSetId,
		);
	},
});

/** Server-to-server storage evidence only; not part of the public/admin API. */
export const recordStorageReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateStorageReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		// Reserved editor operation facts always pass through the same strict
		// admission before retained canary checks. Removing the canary cannot
		// turn this historical path into an editor-policy bypass.
		const operation = await admitHistoricalEditorStorageReceipt(ctx, receiptSet);
		await requireCatalogPrivateAssetV2CanaryStorageReceipt(ctx, receiptSet);
		const result = await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet);
		if (operation) await reconcileJournalStorageEvidence(ctx, operation, result.status === "verified");
		return result;
	},
});

/** Independently authenticated content-inspection evidence only. */
export const recordInspectionReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		const operation = await admitHistoricalEditorInspectionReceipt(ctx, receiptSet);
		await requireCatalogPrivateAssetV2CanaryInspectionReceipt(ctx, receiptSet);
		const result = await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet);
		if (operation) {
			await reconcileJournalInspectionEvidence(ctx, operation, result.status === "verified");
		}
		return result;
	},
});

/** Exact-one schema-2 editor storage evidence on the dedicated ingress. */
export const recordEditorStorageReceipt = internalMutation({
	args: { receiptSet: catalogPrivateStorageReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		const operation = await admitEditorStorageReceipt(ctx, receiptSet);
		const result = await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet);
		await reconcileJournalStorageEvidence(ctx, operation, result.status === "verified");
		return editorAdmissionResult(result);
	},
});

/** Exact-one independently inspected editor evidence with the schema-2 policy pinned. */
export const recordEditorInspectionReceipt = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		const operation = await admitEditorInspectionReceipt(ctx, receiptSet);
		const result = await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet);
		await reconcileJournalInspectionEvidence(ctx, operation, result.status === "verified");
		return editorAdmissionResult(result);
	},
});

const journalDescriptorValidator = v.union(
	v.object({
		productKind: v.union(v.literal("print"), v.literal("print_set")),
		kind: v.literal("print_source"),
		originalFilename: v.string(),
		contentType: v.union(v.literal("image/jpeg"), v.literal("image/png")),
		sizeBytes: v.number(),
		sha256: v.string(),
		widthPixels: v.number(),
		heightPixels: v.number(),
	}),
	v.object({
		productKind: v.literal("digital_download"),
		kind: v.literal("paid_digital_file"),
		originalFilename: v.string(),
		contentType: v.literal("application/zip"),
		sizeBytes: v.number(),
		sha256: v.string(),
		version: v.optional(v.string()),
	}),
);

const capabilityCommitValidator = v.object({
	value: v.string(),
	digest: v.string(),
	rawFingerprint: v.string(),
	issuedAt: v.number(),
	expiresAt: v.number(),
});

async function requireJournalOperation(
	ctx: QueryCtx | MutationCtx,
	siteUrl: string,
	uploadHandleHash: string,
) {
	const operation = await ctx.db
		.query("catalogPrivateAssetEditorOperations")
		.withIndex("by_siteUrl_and_uploadHandleHash", (q) =>
			q.eq("siteUrl", siteUrl).eq("uploadHandleHash", uploadHandleHash),
		)
		.unique();
	if (!operation || operation.journalVersion !== 1) throw catalogEditorJournalError("gone");
	return operation;
}

function sameJournalDescriptor(
	operation: Doc<"catalogPrivateAssetEditorOperations">,
	descriptor: CatalogEditorJournalDescriptor,
) {
	return operation.productKind === descriptor.productKind
		&& operation.kind === descriptor.kind
		&& operation.originalFilename === descriptor.originalFilename
		&& operation.contentType === descriptor.contentType
		&& operation.sizeBytes === descriptor.sizeBytes
		&& operation.sha256 === descriptor.sha256
		&& (descriptor.kind === "print_source"
			? operation.widthPixels === descriptor.widthPixels
				&& operation.heightPixels === descriptor.heightPixels
				&& operation.version === undefined
			: operation.widthPixels === undefined
				&& operation.heightPixels === undefined
				&& operation.version === descriptor.version);
}

async function journalReservationIsIntact(
	operation: Doc<"catalogPrivateAssetEditorOperations">,
	descriptor: CatalogEditorJournalDescriptor,
) {
	const canonical = canonicalCatalogEditorDeclaration(
		operation.siteUrl,
		operation.operationId,
		descriptor,
	);
	return operation.journalVersion === 1
		&& operation.generation === 1
		&& operation.lifecycle !== undefined
		&& operation.updatedAt !== undefined
		&& operation.uploadOrigin === CATALOG_EDITOR_UPLOAD_ORIGIN
		&& operation.sourceId === `editor-upload:${operation.operationId}`
		&& operation.assetKey === `editor-upload-${operation.operationId}`
		&& operation.privateObjectKey === privateObjectKey(
			operation.siteUrl,
			operation.operationId,
			descriptor.kind,
		)
		&& operation.canonicalDeclaration === canonical
		&& operation.declarationHash === await catalogEditorDeclarationHash(canonical);
}

/** Reserve immutable Worker facts before any external prepare effect. */
export const beginEditorJournal = internalMutation({
	args: {
		siteUrl: v.string(),
		uploadHandleHash: v.string(),
		proposedOperationId: v.string(),
		descriptor: journalDescriptorValidator,
	},
	handler: async (ctx, { siteUrl, uploadHandleHash, proposedOperationId, descriptor }) => {
		const { kind: _kind, ...descriptorInput } = descriptor;
		const normalized = parseCatalogEditorBeginBody({
			uploadHandle: "00000000-0000-4000-8000-000000000000",
			...descriptorInput,
		});
		if (
			siteUrl !== CATALOG_EDITOR_SUPPORTED_SITE
			|| !/^[0-9a-f]{64}$/.test(uploadHandleHash)
			|| !CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN.test(proposedOperationId)
			|| !normalized
			|| normalized.kind !== descriptor.kind
		) throw catalogEditorJournalError("validation");
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) throw catalogEditorJournalError("validation");
		try {
			requireCatalogProductKindEnabled(client, descriptor.productKind);
		} catch {
			throw catalogEditorJournalError("validation");
		}
		const existing = await ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_uploadHandleHash", (q) =>
				q.eq("siteUrl", siteUrl).eq("uploadHandleHash", uploadHandleHash),
			)
			.unique();
		if (existing) {
			if (
				!sameJournalDescriptor(existing, descriptor)
				|| !await journalReservationIsIntact(existing, descriptor)
			) throw catalogEditorJournalError("conflict");
			return {
				replayed: true,
				prepareRequired: existing.prepareCommittedAt === undefined,
				generation: existing.generation ?? 1,
				declarationHash: existing.declarationHash as string,
				workerPrepare: createCatalogEditorWorkerDeclaration(
					siteUrl,
					existing.operationId,
					descriptor,
				),
			};
		}
		const operationCollision = await ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", siteUrl).eq("operationId", proposedOperationId),
			)
			.unique();
		if (operationCollision) {
			if (
				operationCollision.uploadHandleHash === uploadHandleHash
				&& sameJournalDescriptor(operationCollision, descriptor)
				&& await journalReservationIsIntact(operationCollision, descriptor)
			) {
				return {
					replayed: true,
					prepareRequired: operationCollision.prepareCommittedAt === undefined,
					generation: operationCollision.generation ?? 1,
					declarationHash: operationCollision.declarationHash as string,
					workerPrepare: createCatalogEditorWorkerDeclaration(
						siteUrl,
						operationCollision.operationId,
						descriptor,
					),
				};
			}
			throw catalogEditorJournalError("conflict");
		}
		const now = Date.now();
		const canonicalDeclaration = canonicalCatalogEditorDeclaration(
			siteUrl,
			proposedOperationId,
			descriptor,
		);
		const declarationHash = await catalogEditorDeclarationHash(canonicalDeclaration);
		await ctx.db.insert("catalogPrivateAssetEditorOperations", {
			siteUrl,
			operationId: proposedOperationId,
			sourceId: `editor-upload:${proposedOperationId}`,
			kind: descriptor.kind,
			assetKey: `editor-upload-${proposedOperationId}`,
			privateObjectKey: privateObjectKey(siteUrl, proposedOperationId, descriptor.kind),
			createdAt: now,
			journalVersion: 1,
			uploadHandleHash,
			productKind: descriptor.productKind,
			uploadOrigin: CATALOG_EDITOR_UPLOAD_ORIGIN,
			originalFilename: descriptor.originalFilename,
			contentType: descriptor.contentType,
			sizeBytes: descriptor.sizeBytes,
			sha256: descriptor.sha256,
			...(descriptor.kind === "print_source"
				? { widthPixels: descriptor.widthPixels, heightPixels: descriptor.heightPixels }
				: descriptor.version === undefined ? {} : { version: descriptor.version }),
			canonicalDeclaration,
			declarationHash,
			lifecycle: "reserved",
			generation: 1,
			updatedAt: now,
		});
		await ctx.db.insert("catalogPrivateAssetEditorEffects", {
			siteUrl,
			operationId: proposedOperationId,
			kind: "prepare",
			generation: 1,
			state: "queued",
			attempts: 0,
			nextAttemptAt: now,
			createdAt: now,
			updatedAt: now,
		});
		return {
			replayed: false,
			prepareRequired: true,
			generation: 1,
			declarationHash,
			workerPrepare: createCatalogEditorWorkerDeclaration(
				siteUrl,
				proposedOperationId,
				descriptor,
			),
		};
	},
});

/** Atomically commit the first complete purpose-separated Worker generation. */
export const commitEditorPrepare = internalMutation({
	args: {
		siteUrl: v.string(),
		uploadHandleHash: v.string(),
		operationId: v.string(),
		declarationHash: v.string(),
		generation: v.literal(1),
		upload: capabilityCommitValidator,
		storage: capabilityCommitValidator,
		inspection: capabilityCommitValidator,
	},
	handler: async (ctx, args) => {
		const operation = await requireJournalOperation(ctx, args.siteUrl, args.uploadHandleHash);
		const now = Date.now();
		const capabilities = [
			{ purpose: "upload" as const, ...args.upload },
			{ purpose: "storage" as const, ...args.storage },
			{ purpose: "inspection" as const, ...args.inspection },
		];
		if (
			operation.generation !== args.generation
			|| operation.operationId !== args.operationId
			|| operation.declarationHash !== args.declarationHash
			|| operation.canonicalDeclaration === undefined
			|| await catalogEditorDeclarationHash(operation.canonicalDeclaration) !== args.declarationHash
			|| new Set(capabilities.map(({ value }) => value)).size !== capabilities.length
			|| new Set(capabilities.map(({ rawFingerprint }) => rawFingerprint)).size
				!== capabilities.length
			|| capabilities.some((capability) =>
				!isCatalogEditorCapabilityValue(capability.value)
				|| !/^[0-9a-f]{64}$/.test(capability.digest)
				|| !/^[0-9a-f]{64}$/.test(capability.rawFingerprint)
				|| !Number.isSafeInteger(capability.issuedAt)
				|| !Number.isSafeInteger(capability.expiresAt)
				|| capability.issuedAt < operation.createdAt - 60_000
				|| capability.expiresAt <= now
				|| capability.expiresAt - capability.issuedAt !== (
					capability.purpose === "upload"
						? CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS
						: CATALOG_EDITOR_CONTINUATION_TTL_MS
				)
			)
			|| args.upload.issuedAt !== args.storage.issuedAt
			|| args.storage.issuedAt !== args.inspection.issuedAt
		) throw catalogEditorJournalError("validation");
		for (const capability of capabilities) {
			if (
				await catalogEditorCapabilityDigest(capability.purpose, capability.value)
					!== capability.digest
				|| await catalogEditorRawCapabilityFingerprint(capability.value)
					!== capability.rawFingerprint
			) throw catalogEditorJournalError("validation");
		}
		const purposes = ["upload", "storage", "inspection"] as const;
		const [existing, rawOwners, legacyDigestOwners] = await Promise.all([
			Promise.all(capabilities.map(async ({ purpose }) =>
				await ctx.db
					.query("catalogPrivateAssetEditorCapabilities")
					.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
						q.eq("siteUrl", args.siteUrl)
							.eq("operationId", operation.operationId)
							.eq("purpose", purpose),
					)
					.unique()
			)),
			Promise.all(capabilities.map(async ({ rawFingerprint }) =>
				await ctx.db
					.query("catalogPrivateAssetEditorCapabilities")
					.withIndex("by_rawFingerprint", (q) => q.eq("rawFingerprint", rawFingerprint))
					.unique()
			)),
			// Bridge rows written before rawFingerprint existed by checking each
			// candidate under every retained purpose-domain digest.
			Promise.all(capabilities.flatMap(({ value }) => purposes.map(async (purpose) => {
				const digest = await catalogEditorCapabilityDigest(purpose, value);
				return await ctx.db
					.query("catalogPrivateAssetEditorCapabilities")
					.withIndex("by_purpose_and_digest", (q) =>
						q.eq("purpose", purpose).eq("digest", digest),
					)
					.unique();
			}))),
		]);
		if ([...rawOwners, ...legacyDigestOwners].some((row) => row && (
			row.siteUrl !== args.siteUrl || row.operationId !== operation.operationId
		))) throw catalogEditorJournalError("conflict");
		if (existing.some(Boolean)) {
			if (existing.some((row, index) => {
				const expected = capabilities[index];
				return !row || !expected
					|| row.generation !== args.generation
					|| row.digest !== expected.digest
					|| (row.rawFingerprint !== undefined
						&& row.rawFingerprint !== expected.rawFingerprint)
					|| (row.value !== undefined && row.value !== expected.value)
					|| row.issuedAt !== expected.issuedAt
					|| row.expiresAt !== expected.expiresAt;
			})) throw catalogEditorJournalError("conflict");
			for (let index = 0; index < existing.length; index += 1) {
				const row = existing[index];
				const expected = capabilities[index];
				if (row && expected && row.rawFingerprint === undefined) {
					await ctx.db.patch(row._id, { rawFingerprint: expected.rawFingerprint, updatedAt: now });
				}
			}
			return { status: "committed" as const, replayed: true };
		}
		const prepareEffect = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("kind", "prepare"),
			)
			.unique();
		if (!prepareEffect || prepareEffect.generation !== args.generation) {
			throw catalogEditorJournalError("conflict");
		}
		for (const capability of capabilities) {
			const purgeAt = capability.expiresAt + CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS;
			const capabilityId = await ctx.db.insert("catalogPrivateAssetEditorCapabilities", {
				siteUrl: args.siteUrl,
				operationId: operation.operationId,
				purpose: capability.purpose,
				value: capability.value,
				digest: capability.digest,
				rawFingerprint: capability.rawFingerprint,
				issuedAt: capability.issuedAt,
				expiresAt: capability.expiresAt,
				purgeAt,
				generation: args.generation,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.scheduler.runAt(
				purgeAt,
				internal.catalogPrivateAssets.purgeEditorCapability,
				{
					capabilityId,
					purpose: capability.purpose,
					digest: capability.digest,
					generation: args.generation,
					purgeAt,
				},
			);
		}
		await ctx.db.patch(prepareEffect._id, {
			state: "acknowledged",
			lastOutcome: "success",
			updatedAt: now,
			acknowledgedAt: now,
		});
		await ctx.db.insert("catalogPrivateAssetEditorEffects", {
			siteUrl: args.siteUrl,
			operationId: operation.operationId,
			kind: "storage",
			generation: args.generation,
			state: "queued",
			attempts: 0,
			nextAttemptAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(operation._id, {
			lifecycle: "prepared",
			prepareCommittedAt: now,
			updatedAt: now,
		});
		return { status: "committed" as const, replayed: false };
	},
});

/** Identity-checked raw-value purge; digest/generation remain as tombstone. */
export const purgeEditorCapability = internalMutation({
	args: {
		capabilityId: v.id("catalogPrivateAssetEditorCapabilities"),
		purpose: v.union(v.literal("upload"), v.literal("storage"), v.literal("inspection")),
		digest: v.string(),
		generation: v.number(),
		purgeAt: v.number(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.capabilityId);
		if (
			!row
			|| row.purpose !== args.purpose
			|| row.digest !== args.digest
			|| row.generation !== args.generation
			|| row.purgeAt !== args.purgeAt
			|| Date.now() < row.purgeAt
			|| row.value === undefined
		) return { purged: false };
		const now = Date.now();
		if (row.purpose !== "upload") {
			const leasedKind = row.purpose === "storage" ? "storage" : "inspection_dispatch";
			const [leasedEffect, leasedOperation] = await Promise.all([
				ctx.db
					.query("catalogPrivateAssetEditorEffects")
					.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
						q.eq("siteUrl", row.siteUrl)
							.eq("operationId", row.operationId)
							.eq("kind", leasedKind),
					)
					.unique(),
				ctx.db
					.query("catalogPrivateAssetEditorOperations")
					.withIndex("by_siteUrl_and_operationId", (q) =>
						q.eq("siteUrl", row.siteUrl).eq("operationId", row.operationId),
					)
					.unique(),
			]);
			if (
				leasedOperation?.generation === row.generation
				&& leasedEffect?.generation === row.generation
				&& leasedEffect.state === "leased"
				&& leasedEffect.leaseDigest !== undefined
				&& leasedEffect.leaseExpiresAt !== undefined
				&& leasedEffect.leaseExpiresAt > now
				&& row.expiresAt > now
			) {
				await ctx.scheduler.runAt(
					leasedEffect.leaseExpiresAt,
					internal.catalogPrivateAssets.purgeEditorCapability,
					args,
				);
				return { purged: false };
			}
		}
		await ctx.db.patch(row._id, { value: undefined, purgedAt: now, updatedAt: now });
		if (row.purpose !== "upload") {
			const kind = row.purpose === "storage" ? "storage" : "inspection_dispatch";
			const effect = await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
					q.eq("siteUrl", row.siteUrl)
						.eq("operationId", row.operationId)
						.eq("kind", kind),
				)
				.unique();
			const operation = await ctx.db
				.query("catalogPrivateAssetEditorOperations")
				.withIndex("by_siteUrl_and_operationId", (q) =>
					q.eq("siteUrl", row.siteUrl).eq("operationId", row.operationId),
				)
				.unique();
			const stillRequired = operation?.journalVersion === 1
				&& operation.lifecycle !== "verified"
				&& (row.purpose === "inspection" || operation.lifecycle === "prepared");
			if (effect && effect.state !== "acknowledged" && stillRequired) {
				await ctx.db.patch(effect._id, {
					state: "failed",
					lastOutcome: "expired",
					leaseDigest: undefined,
					leaseExpiresAt: undefined,
					updatedAt: now,
				});
			}
			if (operation && stillRequired) {
				await ctx.db.patch(operation._id, { lifecycle: "expired", updatedAt: now });
			}
		}
		return { purged: true };
	},
});

export const getEditorUploadProjection = internalQuery({
	args: { siteUrl: v.string(), uploadHandleHash: v.string() },
	handler: async (ctx, args) => {
		const operation = await requireJournalOperation(ctx, args.siteUrl, args.uploadHandleHash);
		const capability = await ctx.db
			.query("catalogPrivateAssetEditorCapabilities")
			.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("purpose", "upload"),
			)
			.unique();
		if (
			!capability
			|| capability.generation !== operation.generation
			|| capability.value === undefined
			|| capability.expiresAt <= Date.now()
		) throw catalogEditorJournalError("gone");
		return {
			uploadPath: "/v1/catalog-assets/editor-uploads/source",
			uploadToken: capability.value,
			uploadExpiresAt: new Date(capability.expiresAt).toISOString(),
		};
	},
});

async function claimEffect(
	ctx: MutationCtx,
	effect: Doc<"catalogPrivateAssetEditorEffects">,
	purpose: "storage" | "inspection",
	leaseDigest: string,
	now: number,
) {
	if (effect.state === "acknowledged" || effect.state === "failed") {
		throw catalogEditorJournalError("gone");
	}
	if (effect.state === "leased" && (effect.leaseExpiresAt ?? 0) > now) {
		throw catalogEditorJournalError("rate_limited");
	}
	if (effect.nextAttemptAt > now) throw catalogEditorJournalError("rate_limited");
	if (effect.attempts >= CATALOG_EDITOR_MAX_ATTEMPTS) {
		await ctx.db.patch(effect._id, {
			state: "failed",
			lastOutcome: "attempts_exhausted",
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			updatedAt: now,
		});
		return { status: "attempts_exhausted" as const };
	}
	const capability = await ctx.db
		.query("catalogPrivateAssetEditorCapabilities")
		.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
			q.eq("siteUrl", effect.siteUrl)
				.eq("operationId", effect.operationId)
				.eq("purpose", purpose),
		)
		.unique();
	const leaseDuration = purpose === "storage"
		? CATALOG_EDITOR_STORAGE_LEASE_MS
		: CATALOG_EDITOR_INSPECTION_LEASE_MS;
	if (
		!capability
		|| capability.generation !== effect.generation
		|| capability.value === undefined
		|| capability.expiresAt - now < leaseDuration + CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS
	) {
		await ctx.db.patch(effect._id, {
			state: "failed",
			lastOutcome: "expired",
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			updatedAt: now,
		});
		const operation = await ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", effect.siteUrl).eq("operationId", effect.operationId),
			)
			.unique();
		if (operation?.journalVersion === 1 && operation.lifecycle !== "verified") {
			await ctx.db.patch(operation._id, { lifecycle: "expired", updatedAt: now });
		}
		return { status: "capability_expired" as const };
	}
	const leaseExpiresAt = now + leaseDuration;
	await ctx.db.patch(effect._id, {
		state: "leased",
		attempts: effect.attempts + 1,
		nextAttemptAt: leaseExpiresAt,
		leaseDigest,
		leaseExpiresAt,
		lastAckLeaseDigest: undefined,
		lastAckOutcome: undefined,
		lastAckStatus: undefined,
		lastAckRetryAt: undefined,
		updatedAt: now,
	});
	return { capability: capability.value, leaseExpiresAt };
}

export const claimEditorStorage = internalMutation({
	args: {
		siteUrl: v.string(),
		uploadHandleHash: v.string(),
		leaseDigest: v.string(),
	},
	handler: async (ctx, args) => {
		const operation = await requireJournalOperation(ctx, args.siteUrl, args.uploadHandleHash);
		const effect = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("kind", "storage"),
			)
			.unique();
		if (!effect) throw catalogEditorJournalError("gone");
		const claimed = await claimEffect(ctx, effect, "storage", args.leaseDigest, Date.now());
		if ("status" in claimed) return claimed;
		return {
			storageContinuation: claimed.capability,
			leaseExpiresAt: new Date(claimed.leaseExpiresAt).toISOString(),
		};
	},
});

const STALE_INSPECTION_LEASE_RECONCILE_LIMIT = 16;

async function reconcileExpiredInspectionLease(
	ctx: MutationCtx,
	effect: Doc<"catalogPrivateAssetEditorEffects">,
	now: number,
) {
	const [operation, capability] = await Promise.all([
		ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", effect.siteUrl).eq("operationId", effect.operationId),
			)
			.unique(),
		ctx.db
			.query("catalogPrivateAssetEditorCapabilities")
			.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
				q.eq("siteUrl", effect.siteUrl)
					.eq("operationId", effect.operationId)
					.eq("purpose", "inspection"),
			)
			.unique(),
	]);
	const currentGeneration = operation?.journalVersion === 1
		&& operation.generation === effect.generation;
	if (operation && currentGeneration && operation.lifecycle === "verified") {
		// Receipt authority wins even on attempt 8. Retain the lease fence so a
		// success ACK already in flight can still commit through reconciledSuccess.
		await ctx.db.patch(effect._id, {
			state: "acknowledged",
			lastOutcome: "reconciled",
			updatedAt: now,
			acknowledgedAt: now,
		});
		return null;
	}
	if (effect.attempts >= CATALOG_EDITOR_MAX_ATTEMPTS) {
		await ctx.db.patch(effect._id, {
			state: "failed",
			lastOutcome: "attempts_exhausted",
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			updatedAt: now,
		});
		return { claimId: effect._id, status: "attempts_exhausted" as const };
	}
	if (
		!operation
		|| !currentGeneration
		|| operation.lifecycle !== "storage_recorded"
		|| !capability
		|| capability.generation !== effect.generation
		|| capability.value === undefined
		|| capability.expiresAt - now
			< CATALOG_EDITOR_INSPECTION_LEASE_MS + CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS
	) {
		await ctx.db.patch(effect._id, {
			state: "failed",
			lastOutcome: "expired",
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			updatedAt: now,
		});
		if (operation && currentGeneration && operation.lifecycle !== "verified") {
			await ctx.db.patch(operation._id, { lifecycle: "expired", updatedAt: now });
		}
		return { claimId: effect._id, status: "capability_expired" as const };
	}
	await ctx.db.patch(effect._id, {
		state: "queued",
		nextAttemptAt: now,
		leaseDigest: undefined,
		leaseExpiresAt: undefined,
		updatedAt: now,
	});
	return null;
}

export const claimEditorInspection = internalMutation({
	args: { siteUrl: v.string(), leaseDigest: v.string() },
	handler: async (ctx, args) => {
		const now = Date.now();
		// Missing optional index fields sort before numbers, so this tenant-scoped
		// upper range includes both expired leases and legacy rows without expiry.
		const staleLeases = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_kind_and_state_and_leaseExpiresAt", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("kind", "inspection_dispatch")
					.eq("state", "leased")
					.lte("leaseExpiresAt", now),
			)
			.take(STALE_INSPECTION_LEASE_RECONCILE_LIMIT);
		for (const staleLease of staleLeases) {
			const terminal = await reconcileExpiredInspectionLease(ctx, staleLease, now);
			// Stop after one terminal transition so every terminal result is returned
			// exactly once instead of being consumed behind another claim response.
			if (terminal) return terminal;
		}

		const malformedLease = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_kind_and_state_and_leaseExpiresAt", (q) =>
				q.eq("kind", "inspection_dispatch")
					.eq("state", "leased")
					.eq("leaseExpiresAt", undefined),
			)
			.take(1);
		if (malformedLease.length > 0) return { status: "rate_limited" as const };

		// This deployed-Convex empty-range read is the global single-flight gate.
		// Serializable OCC records the index range dependency: a concurrent
		// cross-tenant queued -> leased patch enters the range, invalidates this
		// snapshot, and retries one claimant. convex-test serializes top-level
		// mutations, so tests can cover range membership and final invariants but
		// cannot manufacture overlapping snapshots.
		const activeLease = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_kind_and_state_and_leaseExpiresAt", (q) =>
				q.eq("kind", "inspection_dispatch")
					.eq("state", "leased")
					.gt("leaseExpiresAt", now),
			)
			.take(1);
		if (activeLease.length > 0) return { status: "rate_limited" as const };

		const queued = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_kind_and_state_and_nextAttemptAt", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("kind", "inspection_dispatch")
					.eq("state", "queued")
					.lte("nextAttemptAt", now),
			)
			.take(1);
		const effect = queued[0];
		if (!effect) return { status: "rate_limited" as const };
		const claimed = await claimEffect(ctx, effect, "inspection", args.leaseDigest, now);
		if ("status" in claimed) return { claimId: effect._id, ...claimed };
		return {
			claimId: effect._id,
			inspectionContinuation: claimed.capability,
			leaseExpiresAt: new Date(claimed.leaseExpiresAt).toISOString(),
		};
	},
});

async function acknowledgeEffect(
	ctx: MutationCtx,
	effect: Doc<"catalogPrivateAssetEditorEffects">,
	leaseDigest: string,
	outcome: "success" | "retryable" | "rejected",
) {
	const replayResult = () => {
		if (effect.lastAckStatus === "retry_scheduled" && effect.lastAckRetryAt !== undefined) {
			return {
				status: "retry_scheduled" as const,
				retryAt: new Date(effect.lastAckRetryAt).toISOString(),
			};
		}
		if (effect.lastAckStatus) return { status: effect.lastAckStatus };
		return null;
	};
	if (effect.lastAckLeaseDigest === leaseDigest) {
		if (effect.lastAckOutcome !== outcome) throw catalogEditorJournalError("conflict");
		const replay = replayResult();
		if (!replay) throw catalogEditorJournalError("conflict");
		return replay;
	}
	const now = Date.now();
	const reconciledSuccess = effect.state === "acknowledged"
		&& effect.lastOutcome === "reconciled"
		&& effect.leaseDigest === leaseDigest
		&& outcome === "success";
	if (!reconciledSuccess && (
		effect.state !== "leased"
		|| effect.leaseDigest !== leaseDigest
		|| effect.leaseExpiresAt === undefined
		|| effect.leaseExpiresAt <= now
	)) throw catalogEditorJournalError("conflict");
	if (outcome === "retryable") {
		if (effect.attempts >= CATALOG_EDITOR_MAX_ATTEMPTS) {
			await ctx.db.patch(effect._id, {
				state: "failed",
				lastOutcome: "retryable",
				leaseDigest: undefined,
				leaseExpiresAt: undefined,
				lastAckLeaseDigest: leaseDigest,
				lastAckOutcome: outcome,
				lastAckStatus: "attempts_exhausted",
				lastAckRetryAt: undefined,
				updatedAt: now,
			});
			return { status: "attempts_exhausted" as const };
		}
		const retryAt = now + catalogEditorRetryDelayMs(effect.attempts);
		await ctx.db.patch(effect._id, {
			state: "queued",
			lastOutcome: "retryable",
			nextAttemptAt: retryAt,
			leaseDigest: undefined,
			leaseExpiresAt: undefined,
			lastAckLeaseDigest: leaseDigest,
			lastAckOutcome: outcome,
			lastAckStatus: "retry_scheduled",
			lastAckRetryAt: retryAt,
			updatedAt: now,
		});
		return { status: "retry_scheduled" as const, retryAt: new Date(retryAt).toISOString() };
	}
	const status = outcome === "success" ? "acknowledged" as const : "rejected" as const;
	await ctx.db.patch(effect._id, {
		state: outcome === "success" ? "acknowledged" : "failed",
		lastOutcome: outcome,
		leaseDigest: undefined,
		leaseExpiresAt: undefined,
		lastAckLeaseDigest: leaseDigest,
		lastAckOutcome: outcome,
		lastAckStatus: status,
		lastAckRetryAt: undefined,
		updatedAt: now,
		...(outcome === "success" ? { acknowledgedAt: now } : {}),
	});
	return { status };
}

const effectOutcomeValidator = v.union(
	v.literal("success"),
	v.literal("retryable"),
	v.literal("rejected"),
);

export const ackEditorStorage = internalMutation({
	args: {
		siteUrl: v.string(),
		uploadHandleHash: v.string(),
		leaseDigest: v.string(),
		outcome: effectOutcomeValidator,
	},
	handler: async (ctx, args) => {
		const operation = await requireJournalOperation(ctx, args.siteUrl, args.uploadHandleHash);
		const effect = await ctx.db
			.query("catalogPrivateAssetEditorEffects")
			.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
				q.eq("siteUrl", args.siteUrl)
					.eq("operationId", operation.operationId)
					.eq("kind", "storage"),
			)
			.unique();
		if (!effect) throw catalogEditorJournalError("gone");
		return await acknowledgeEffect(ctx, effect, args.leaseDigest, args.outcome);
	},
});

export const ackEditorInspection = internalMutation({
	args: {
		siteUrl: v.string(),
		claimId: v.string(),
		leaseDigest: v.string(),
		outcome: effectOutcomeValidator,
	},
	handler: async (ctx, args) => {
		const claimId = ctx.db.normalizeId("catalogPrivateAssetEditorEffects", args.claimId);
		if (!claimId) throw catalogEditorJournalError("validation");
		const effect = await ctx.db.get(claimId);
		if (
			!effect
			|| effect.siteUrl !== args.siteUrl
			|| effect.kind !== "inspection_dispatch"
		) throw catalogEditorJournalError("conflict");
		return await acknowledgeEffect(ctx, effect, args.leaseDigest, args.outcome);
	},
});

async function resolveVerifiedEditorBinding(
	ctx: QueryCtx,
	binding: Doc<"catalogPrivateAssetEditorOperations">,
) {
	if (binding.receiptSetId === undefined || binding.assetSetChecksum === undefined) {
		throw new Error("Private catalog editor upload is not verified");
	}
	const coordination = await ctx.db
		.query("catalogPrivateAssetReceiptCoordinations")
		.withIndex("by_siteUrl_and_receiptSetId", (q) =>
			q.eq("siteUrl", binding.siteUrl).eq("receiptSetId", binding.receiptSetId as string),
		)
		.unique();
	if (!coordination || coordination.status !== "verified") {
		throw new Error("Private catalog editor upload is not verified");
	}
	const [storage, inspection] = await Promise.all([
		validateCatalogPrivateEditorStorageReceiptSet(coordination.storageReceiptSet),
		validateCatalogPrivateEditorInspectionReceiptSet(coordination.inspectionReceiptSet),
	]);
	const facts = storage.facts[0];
	const targetResolutionVersion =
		"targetResolutionVersion" in coordination ? coordination.targetResolutionVersion : undefined;
	const targetBindings = "targetBindings" in coordination ? coordination.targetBindings : undefined;
	if (
		!facts
		|| inspection.facts.length !== 1
		|| inspection.facts[0]?.kind !== facts.kind
		|| storage.operation.operationId !== binding.operationId
		|| inspection.operation.operationId !== binding.operationId
		|| storage.operation.sourceId !== binding.sourceId
		|| inspection.operation.sourceId !== binding.sourceId
		|| facts.kind !== binding.kind
		|| facts.assetKey !== binding.assetKey
		|| facts.privateObjectKey !== binding.privateObjectKey
		|| storage.assetSetChecksum !== binding.assetSetChecksum
		|| coordination.receiptSetId !== binding.receiptSetId
		|| targetResolutionVersion !== 1
		|| targetBindings?.length !== 1
	) throw new Error("Private catalog editor upload authority is inconsistent");
	const targets = await requireVerifiedPrivateCatalogTargets(ctx, coordination);
	const target = targets[0];
	if (
		targets.length !== 1
		|| !target
		|| target.kind !== facts.kind
		|| target.assetKey !== facts.assetKey
	) throw new Error("Private catalog editor upload target is inconsistent");
	if (target.kind === "print_source") {
		const asset = await ctx.db.get(target.assetId);
		if (!asset || asset.siteUrl !== binding.siteUrl) {
			throw new Error("Private catalog editor upload target is unavailable");
		}
		return toEditorSafePrivatePrintSourceAsset(asset);
	}
	const asset = await ctx.db.get(target.assetId);
	if (!asset || asset.siteUrl !== binding.siteUrl) {
		throw new Error("Private catalog editor upload target is unavailable");
	}
	return toEditorSafePaidDigitalFileAsset(asset);
}

export const getEditorJournalStatus = internalQuery({
	args: { siteUrl: v.string(), uploadHandleHash: v.string() },
	handler: async (ctx, args) => {
		const operation = await requireJournalOperation(ctx, args.siteUrl, args.uploadHandleHash);
		const capability = async (purpose: "upload" | "storage" | "inspection") =>
			await ctx.db
				.query("catalogPrivateAssetEditorCapabilities")
				.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
					q.eq("siteUrl", args.siteUrl)
						.eq("operationId", operation.operationId)
						.eq("purpose", purpose),
				)
				.unique();
		const effect = async (kind: "storage" | "inspection_dispatch") =>
			await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
					q.eq("siteUrl", args.siteUrl)
						.eq("operationId", operation.operationId)
						.eq("kind", kind),
				)
				.unique();
		const [upload, storage, inspection, storageEffect, inspectionEffect] = await Promise.all([
			capability("upload"),
			capability("storage"),
			capability("inspection"),
			effect("storage"),
			effect("inspection_dispatch"),
		]);
		const failed = storageEffect?.state === "failed" || inspectionEffect?.state === "failed";
		const now = Date.now();
		const capabilityAvailable = (row: typeof upload, minimumRemainingMs = 1) =>
			row !== null
			&& row.generation === operation.generation
			&& row.value !== undefined
			&& row.expiresAt - now >= minimumRemainingMs;
		const recoveryAvailable = (
			row: typeof upload,
			outbox: typeof storageEffect,
			leaseDurationMs: number,
		) => (outbox !== null
			&& outbox.generation === operation.generation
			&& outbox.state === "acknowledged")
			|| (
				capabilityAvailable(row)
				&& outbox !== null
				&& outbox.generation === operation.generation
				&& outbox.state === "leased"
				&& outbox.leaseDigest !== undefined
				&& (outbox.leaseExpiresAt ?? 0) > now
			)
			|| capabilityAvailable(
				row,
				leaseDurationMs + CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS,
			);
		const requiredRecoveryUnavailable = operation.lifecycle === "prepared"
			? !recoveryAvailable(storage, storageEffect, CATALOG_EDITOR_STORAGE_LEASE_MS)
			: operation.lifecycle === "storage_recorded"
				? !recoveryAvailable(
					inspection,
					inspectionEffect,
					CATALOG_EDITOR_INSPECTION_LEASE_MS,
				)
				: false;
		const uploadAvailable = capabilityAvailable(upload);
		const status = operation.lifecycle === "verified"
			? "verified"
			: operation.lifecycle === "expired" || requiredRecoveryUnavailable
				? "expired"
				: failed
					? "failed"
					: !upload
						? "preparing"
						: operation.lifecycle === "storage_recorded"
							? "inspection_pending"
							: uploadAvailable ? "upload_required" : "storage_pending";
		let verifiedAsset;
		if (status === "verified") verifiedAsset = await resolveVerifiedEditorBinding(ctx, operation);
		const retryAt = inspectionEffect?.state === "queued"
			? inspectionEffect.nextAttemptAt
			: storageEffect?.state === "queued" ? storageEffect.nextAttemptAt : undefined;
		return {
			status,
			...(upload ? { uploadExpiresAt: new Date(upload.expiresAt).toISOString() } : {}),
			...(storage ? { storageExpiresAt: new Date(storage.expiresAt).toISOString() } : {}),
			...(inspection ? { inspectionExpiresAt: new Date(inspection.expiresAt).toISOString() } : {}),
			...(retryAt === undefined ? {} : { retryAt: new Date(retryAt).toISOString() }),
			...(verifiedAsset === undefined ? {} : { asset: verifiedAsset }),
		};
	},
});

/** Resolve one verified editor operation to metadata that is already safe for the Editor. */
export const resolveEditorUpload = query({
	args: {
		siteUrl: v.string(),
		operationId: v.string(),
		productKind: catalogProductKindValidator,
	},
	handler: async (ctx, { siteUrl, operationId, productKind }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		requireCatalogProductKindEnabled(client, productKind);
		const expectedKind =
			productKind === "print" || productKind === "print_set"
				? "print_source"
				: productKind === "digital_download"
					? "paid_digital_file"
					: null;
		if (!expectedKind) {
			throw new Error("Catalog product kind does not support private upload resolution");
		}
		if (!CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN.test(operationId)) {
			throw new Error("Private catalog editor upload is not verified");
		}
		const binding = await ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", siteUrl).eq("operationId", operationId),
			)
			.unique();
		if (
			!binding
			|| binding.sourceId !== `editor-upload:${operationId}`
			|| binding.assetKey !== `editor-upload-${operationId}`
			|| binding.kind !== expectedKind
			|| (binding.journalVersion === 1 && binding.productKind !== productKind)
		) throw new Error("Private catalog editor upload is not verified");
		return await resolveVerifiedEditorBinding(ctx, binding);
	},
});
