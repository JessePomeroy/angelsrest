import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateAssetTargetBinding,
	CatalogPrivateAssetTargetMapping,
	CatalogPrivateAssetTargetPlan,
} from "./catalogPrivateAssetReceiptContract";
import {
	privateCatalogRegistrationTarget,
	validateCatalogPrivateInspectionReceiptSet,
	validateCatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptValidation";
import {
	type PaidDigitalFileAsset,
	type PrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";

const STORAGE_ACTOR = "cms-catalog-storage-receipt:v1";
const VERIFICATION_ACTOR = "cms-catalog-evidence-match:v1";

type Coordination = Doc<"catalogPrivateAssetReceiptCoordinations">;
type VerifiedCoordination = Extract<Coordination, { status: "verified" }>;
type PendingCoordination = Exclude<Coordination, { status: "verified" }>;
type Authority = Doc<"catalogPrivateAssetTargetAuthorities">;
type PrivateCatalogReadCtx = Pick<QueryCtx, "db">;

function isSafeTimestamp(value: number) {
	return Number.isSafeInteger(value) && value >= 0;
}

export function requirePendingPrivateCatalogCoordination(
	coordination: PendingCoordination,
) {
	const receivedAt = coordination.status === "pending_inspection"
		? coordination.storageReceivedAt
		: coordination.inspectionReceivedAt;
	if (
		!isSafeTimestamp(coordination.createdAt)
		|| !isSafeTimestamp(coordination.updatedAt)
		|| !isSafeTimestamp(receivedAt)
		|| coordination.createdAt !== receivedAt
		|| coordination.updatedAt !== receivedAt
	) throw new Error("Private catalog pending coordination audit is corrupt");
}

function requireVerifiedCoordinationAudit(coordination: VerifiedCoordination) {
	const timestamps = [
		coordination.createdAt,
		coordination.updatedAt,
		coordination.storageReceivedAt,
		coordination.inspectionReceivedAt,
		coordination.verifiedAt,
	];
	if (
		timestamps.some((value) => !isSafeTimestamp(value))
		|| coordination.createdAt !== Math.min(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.verifiedAt < Math.max(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.updatedAt !== coordination.verifiedAt
	) throw new Error("Private catalog verified coordination audit is corrupt");
}

function printAssetValue(asset: Doc<"catalogPrintSourceAssets">): PrivatePrintSourceAsset {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		widthPixels: asset.widthPixels,
		heightPixels: asset.heightPixels,
		sha256: asset.sha256,
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

function paidAssetValue(asset: Doc<"catalogDigitalFileAssets">): PaidDigitalFileAsset {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		sha256: asset.sha256,
		...(asset.version === undefined ? {} : { version: asset.version }),
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

function canonicalProvenance(provenance: CatalogPrivateAssetFacts["provenance"]) {
	return provenance.provider === "sanity"
		? {
				provider: provenance.provider,
				sourceId: provenance.sourceId,
				sourceRevision: provenance.sourceRevision,
			}
		: { provider: provenance.provider, sourceId: provenance.sourceId };
}

function canonicalAsset(asset: PrivatePrintSourceAsset | PaidDigitalFileAsset) {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		...(asset.mimeType === "application/zip"
			? { version: asset.version ?? null }
			: { widthPixels: asset.widthPixels, heightPixels: asset.heightPixels }),
		sha256: asset.sha256,
		provenance: canonicalProvenance(asset.provenance),
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

function canonicalImmutableFacts(facts: CatalogPrivateAssetFacts) {
	return {
		kind: facts.kind,
		assetKey: facts.assetKey,
		privateObjectKey: facts.privateObjectKey,
		originalFilename: facts.originalFilename,
		mimeType: facts.mimeType,
		sizeBytes: facts.sizeBytes,
		...(facts.kind === "print_source"
			? { widthPixels: facts.widthPixels, heightPixels: facts.heightPixels }
			: { version: facts.version ?? null }),
		sha256: facts.sha256,
		provenance: canonicalProvenance(facts.provenance),
	};
}

function sameAsset(
	left: PrivatePrintSourceAsset | PaidDigitalFileAsset,
	right: PrivatePrintSourceAsset | PaidDigitalFileAsset,
) {
	return JSON.stringify(canonicalAsset(left)) === JSON.stringify(canonicalAsset(right));
}

function sameImmutableFacts(left: CatalogPrivateAssetFacts, right: CatalogPrivateAssetFacts) {
	return JSON.stringify(canonicalImmutableFacts(left))
		=== JSON.stringify(canonicalImmutableFacts(right));
}

async function authorityByKey(
	ctx: PrivateCatalogReadCtx,
	siteUrl: string,
	kind: CatalogPrivateAssetFacts["kind"],
	assetKey: string,
) {
	return await ctx.db.query("catalogPrivateAssetTargetAuthorities")
		.withIndex("by_siteUrl_and_kind_and_assetKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind).eq("assetKey", assetKey)
		)
		.unique();
}

async function authorityByAssetId(
	ctx: PrivateCatalogReadCtx,
	siteUrl: string,
	kind: CatalogPrivateAssetFacts["kind"],
	assetId: Id<"catalogPrintSourceAssets"> | Id<"catalogDigitalFileAssets">,
) {
	const [siteAuthority, globalAuthority] = await Promise.all([
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_siteUrl_and_kind_and_assetId", (q) =>
				q.eq("siteUrl", siteUrl).eq("kind", kind).eq("assetId", assetId)
			)
			.unique(),
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_kind_and_assetId", (q) =>
				q.eq("kind", kind).eq("assetId", assetId)
			)
			.unique(),
	]);
	if (
		(siteAuthority && !globalAuthority)
		|| (!siteAuthority && globalAuthority)
		|| (siteAuthority && globalAuthority && siteAuthority._id !== globalAuthority._id)
	) throw new Error("Private catalog target authority tenant is conflicting");
	return siteAuthority;
}

function requireAuthorityFields(
	authority: Authority,
	expected: {
		siteUrl: string;
		kind: CatalogPrivateAssetFacts["kind"];
		assetKey: string;
		assetId: Id<"catalogPrintSourceAssets"> | Id<"catalogDigitalFileAssets">;
		originCoordinationId: Id<"catalogPrivateAssetReceiptCoordinations">;
		originReceiptSetId: string;
		originSchemaVersion: 1 | 2;
	},
) {
	if (
		authority.siteUrl !== expected.siteUrl
		|| authority.kind !== expected.kind
		|| authority.assetKey !== expected.assetKey
		|| authority.assetId !== expected.assetId
		|| authority.originCoordinationId !== expected.originCoordinationId
		|| authority.originReceiptSetId !== expected.originReceiptSetId
		|| authority.originSchemaVersion !== expected.originSchemaVersion
		|| !isSafeTimestamp(authority.indexedAt)
	) throw new Error("Private catalog target authority is missing or corrupt");
}

async function requireIndexedAuthority(
	ctx: PrivateCatalogReadCtx,
	authorityId: Id<"catalogPrivateAssetTargetAuthorities">,
	expected: Parameters<typeof requireAuthorityFields>[1],
) {
	const [authority, byKey, byId] = await Promise.all([
		ctx.db.get(authorityId),
		authorityByKey(ctx, expected.siteUrl, expected.kind, expected.assetKey),
		authorityByAssetId(ctx, expected.siteUrl, expected.kind, expected.assetId),
	]);
	if (!authority || !byKey || !byId || byKey._id !== authorityId || byId._id !== authorityId) {
		throw new Error("Private catalog target authority index is missing or conflicting");
	}
	requireAuthorityFields(authority, expected);
	return authority;
}

async function printTargetByKey(ctx: PrivateCatalogReadCtx, siteUrl: string, assetKey: string) {
	return await ctx.db.query("catalogPrintSourceAssets")
		.withIndex("by_siteUrl_and_assetKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("assetKey", assetKey)
		)
		.unique();
}

async function paidTargetByKey(ctx: PrivateCatalogReadCtx, siteUrl: string, assetKey: string) {
	return await ctx.db.query("catalogDigitalFileAssets")
		.withIndex("by_siteUrl_and_assetKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("assetKey", assetKey)
		)
		.unique();
}

async function requireNoOppositeKindTargetState(
	ctx: PrivateCatalogReadCtx,
	siteUrl: string,
	kind: CatalogPrivateAssetFacts["kind"],
	assetKey: string,
) {
	const [target, authority] = kind === "print_source"
		? await Promise.all([
				paidTargetByKey(ctx, siteUrl, assetKey),
				authorityByKey(ctx, siteUrl, "paid_digital_file", assetKey),
			])
		: await Promise.all([
				printTargetByKey(ctx, siteUrl, assetKey),
				authorityByKey(ctx, siteUrl, "print_source", assetKey),
			]);
	if (target || authority) {
		throw new Error("Private catalog target kind is conflicting or rebound");
	}
}

export async function requireNoPrivateCatalogTargetRows(
	ctx: PrivateCatalogReadCtx,
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	for (const asset of facts) {
		// V1 identity was table-scoped, so an opposite-kind key is not a conflict.
		const [target, authority] = asset.kind === "print_source"
			? await Promise.all([
					printTargetByKey(ctx, siteUrl, asset.assetKey),
					authorityByKey(ctx, siteUrl, asset.kind, asset.assetKey),
				])
			: await Promise.all([
					paidTargetByKey(ctx, siteUrl, asset.assetKey),
					authorityByKey(ctx, siteUrl, asset.kind, asset.assetKey),
				]);
		if (target || authority) {
			throw new Error("Private catalog registry contains uncoordinated target state");
		}
	}
}

async function insertAuthority(
	ctx: MutationCtx,
	mapping: CatalogPrivateAssetTargetMapping,
	origin: {
		siteUrl: string;
		coordinationId: Id<"catalogPrivateAssetReceiptCoordinations">;
		receiptSetId: string;
		schemaVersion: 1 | 2;
		indexedAt: number;
	},
) {
	const common = {
		siteUrl: origin.siteUrl,
		assetKey: mapping.assetKey,
		originCoordinationId: origin.coordinationId,
		originReceiptSetId: origin.receiptSetId,
		originSchemaVersion: origin.schemaVersion,
		indexedAt: origin.indexedAt,
	};
	if (mapping.kind === "print_source") {
		return await ctx.db.insert("catalogPrivateAssetTargetAuthorities", {
			...common,
			kind: mapping.kind,
			assetId: mapping.assetId,
		});
	}
	return await ctx.db.insert("catalogPrivateAssetTargetAuthorities", {
		...common,
		kind: mapping.kind,
		assetId: mapping.assetId,
	});
}

export async function insertPrivateCatalogTargetRows(
	ctx: MutationCtx,
	coordination: Coordination,
	facts: readonly CatalogPrivateAssetFacts[],
	storageReceivedAt: number,
	verifiedAt: number,
) {
	const targets: CatalogPrivateAssetTargetMapping[] = [];
	for (const item of facts) {
		const target = privateCatalogRegistrationTarget(coordination.siteUrl, item, {
			createdAt: storageReceivedAt,
			createdBy: STORAGE_ACTOR,
			verifiedAt,
			verifiedBy: VERIFICATION_ACTOR,
		});
		let mapping: CatalogPrivateAssetTargetMapping;
		if (target.kind === "print_source") {
			const assetId = await ctx.db.insert("catalogPrintSourceAssets", target.asset);
			mapping = { kind: target.kind, assetKey: item.assetKey, assetId };
		} else {
			const assetId = await ctx.db.insert("catalogDigitalFileAssets", target.asset);
			mapping = { kind: target.kind, assetKey: item.assetKey, assetId };
		}
		await insertAuthority(ctx, mapping, {
			siteUrl: coordination.siteUrl,
			coordinationId: coordination._id,
			receiptSetId: coordination.receiptSetId,
			schemaVersion: coordination.status === "pending_inspection"
				? coordination.storageReceiptSet.schemaVersion
				: coordination.inspectionReceiptSet.schemaVersion,
			indexedAt: verifiedAt,
		});
		targets.push(mapping);
	}
	return targets;
}

async function requireClassicTarget(
	ctx: PrivateCatalogReadCtx,
	coordination: VerifiedCoordination,
	facts: CatalogPrivateAssetFacts,
	mapping: CatalogPrivateAssetTargetMapping,
) {
	const expected = privateCatalogRegistrationTarget(coordination.siteUrl, facts, {
		createdAt: coordination.storageReceivedAt,
		createdBy: STORAGE_ACTOR,
		verifiedAt: coordination.verifiedAt,
		verifiedBy: VERIFICATION_ACTOR,
	});
	if (facts.kind === "print_source" && mapping.kind === "print_source") {
		const [row, indexed] = await Promise.all([
			ctx.db.get(mapping.assetId),
			printTargetByKey(ctx, coordination.siteUrl, facts.assetKey),
		]);
		if (!row || !indexed || indexed._id !== mapping.assetId
			|| expected.kind !== "print_source") {
			throw new Error("Private catalog verified print source is missing or corrupt");
		}
		const value = printAssetValue(row);
		validatePrivatePrintSourceAsset(value);
		if (!sameAsset(value, expected.asset)) {
			throw new Error("Private catalog verified print source has drifted");
		}
		return;
	}
	if (facts.kind === "paid_digital_file" && mapping.kind === "paid_digital_file") {
		const [row, indexed] = await Promise.all([
			ctx.db.get(mapping.assetId),
			paidTargetByKey(ctx, coordination.siteUrl, facts.assetKey),
		]);
		if (!row || !indexed || indexed._id !== mapping.assetId
			|| expected.kind !== "paid_digital_file") {
			throw new Error("Private catalog verified paid file is missing or corrupt");
		}
		const value = paidAssetValue(row);
		validatePaidDigitalFileAsset(value);
		if (!sameAsset(value, expected.asset)) {
			throw new Error("Private catalog verified paid file has drifted");
		}
		return;
	}
	throw new Error("Private catalog verified target kind is corrupt");
}

async function requireVerifiedCoordinationEvidence(coordination: VerifiedCoordination) {
	requireVerifiedCoordinationAudit(coordination);
	const [storage, inspection] = await Promise.all([
		validateCatalogPrivateStorageReceiptSet(coordination.storageReceiptSet),
		validateCatalogPrivateInspectionReceiptSet(coordination.inspectionReceiptSet),
	]);
	if (
		coordination.storageReceiptSet.schemaVersion
			!== coordination.inspectionReceiptSet.schemaVersion
		|| storage.assetSetChecksum !== coordination.assetSetChecksum
		|| storage.roleChecksum !== coordination.storageReceiptChecksum
		|| inspection.assetSetChecksum !== coordination.assetSetChecksum
		|| inspection.roleChecksum !== coordination.inspectionReceiptChecksum
		|| storage.assetCanonical !== inspection.assetCanonical
		|| coordination.storageReceiptSet.siteUrl !== coordination.siteUrl
		|| coordination.inspectionReceiptSet.siteUrl !== coordination.siteUrl
		|| coordination.storageReceiptSet.receiptSetId !== coordination.receiptSetId
		|| coordination.inspectionReceiptSet.receiptSetId !== coordination.receiptSetId
		|| storage.facts.length !== coordination.targets.length
	) throw new Error("Private catalog verified coordination is corrupt");
	return storage.facts;
}

function requireMappingMatchesFacts(
	facts: CatalogPrivateAssetFacts,
	mapping: CatalogPrivateAssetTargetMapping,
) {
	if (facts.kind !== mapping.kind || facts.assetKey !== mapping.assetKey) {
		throw new Error("Private catalog verified target mapping is corrupt");
	}
}

type ValidatedV1Origin = {
	coordination: VerifiedCoordination;
	facts: CatalogPrivateAssetFacts[];
};

async function requireV1Origin(
	ctx: PrivateCatalogReadCtx,
	authority: Authority,
	incomingSiteUrl: string,
	incomingFacts: CatalogPrivateAssetFacts,
	expectedAssetId: Id<"catalogPrintSourceAssets"> | Id<"catalogDigitalFileAssets">,
	cached?: ValidatedV1Origin,
): Promise<ValidatedV1Origin> {
	if (authority.originSchemaVersion !== 1 || authority.siteUrl !== incomingSiteUrl) {
		throw new Error("Private catalog targets may only be re-attested from verified V1 authority");
	}
	const origin = await ctx.db.get(authority.originCoordinationId);
	if (
		!origin
		|| origin.status !== "verified"
		|| origin.siteUrl !== incomingSiteUrl
		|| origin.receiptSetId !== authority.originReceiptSetId
		|| origin.storageReceiptSet.schemaVersion !== 1
		|| origin.inspectionReceiptSet.schemaVersion !== 1
	) throw new Error("Private catalog V1 target authority origin is missing or corrupt");
	let originFacts: CatalogPrivateAssetFacts[];
	if (cached) {
		if (cached.coordination._id !== origin._id) {
			throw new Error("Private catalog V2 reuse must have one V1 source coordination");
		}
		originFacts = cached.facts;
	} else {
		originFacts = await requireVerifiedCoordinationEvidence(origin);
		for (let index = 0; index < originFacts.length; index += 1) {
			const facts = originFacts[index];
			const mapping = origin.targets[index];
			if (!facts || !mapping) {
				throw new Error("Private catalog V1 target authority origin is incomplete");
			}
			requireMappingMatchesFacts(facts, mapping);
			await requireClassicTarget(ctx, origin, facts, mapping);
		}
	}
	const memberIndex = origin.targets.findIndex((mapping) =>
		mapping.kind === incomingFacts.kind
		&& mapping.assetKey === incomingFacts.assetKey
		&& mapping.assetId === expectedAssetId
	);
	const sourceFacts = originFacts[memberIndex];
	if (memberIndex < 0 || !sourceFacts || !sameImmutableFacts(sourceFacts, incomingFacts)) {
		throw new Error("Private catalog V2 facts do not match the V1 target authority");
	}
	return { coordination: origin, facts: originFacts };
}

export async function resolvePrivateCatalogV2TargetPlan(
	ctx: PrivateCatalogReadCtx,
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	const plan: CatalogPrivateAssetTargetPlan[] = [];
	let sharedOrigin: ValidatedV1Origin | undefined;
	for (const item of facts) {
		const [printTarget, paidTarget, printAuthority, paidAuthority] = await Promise.all([
			printTargetByKey(ctx, siteUrl, item.assetKey),
			paidTargetByKey(ctx, siteUrl, item.assetKey),
			authorityByKey(ctx, siteUrl, "print_source", item.assetKey),
			authorityByKey(ctx, siteUrl, "paid_digital_file", item.assetKey),
		]);
		const target = item.kind === "print_source" ? printTarget : paidTarget;
		const oppositeTarget = item.kind === "print_source" ? paidTarget : printTarget;
		const authority = item.kind === "print_source" ? printAuthority : paidAuthority;
		const oppositeAuthority = item.kind === "print_source" ? paidAuthority : printAuthority;
		if (oppositeTarget || oppositeAuthority) {
			throw new Error("Private catalog target kind is conflicting or rebound");
		}
		if (!target) {
			if (authority) {
				throw new Error("Private catalog target authority has no matching target");
			}
			plan.push({ kind: item.kind, assetKey: item.assetKey, resolution: "create" });
			continue;
		}
		if (!authority || authority.kind !== item.kind || authority.assetId !== target._id) {
			throw new Error("Private catalog registry contains uncoordinated target state");
		}
		const indexedById = await authorityByAssetId(ctx, siteUrl, item.kind, target._id);
		if (!indexedById || indexedById._id !== authority._id) {
			throw new Error("Private catalog target authority index is missing or conflicting");
		}
		requireAuthorityFields(authority, {
			siteUrl,
			kind: item.kind,
			assetKey: item.assetKey,
			assetId: target._id,
			originCoordinationId: authority.originCoordinationId,
			originReceiptSetId: authority.originReceiptSetId,
			originSchemaVersion: 1,
		});
		const validatedOrigin = await requireV1Origin(
			ctx,
			authority,
			siteUrl,
			item,
			target._id,
			sharedOrigin,
		);
		sharedOrigin = validatedOrigin;
		const origin = validatedOrigin.coordination;
		if (
			item.kind === "print_source"
			&& authority.kind === "print_source"
			&& printTarget
			&& target._id === printTarget._id
		) {
			plan.push({
				kind: item.kind,
				assetKey: item.assetKey,
				assetId: printTarget._id,
				resolution: "reuse_v1",
				authorityId: authority._id,
				originCoordinationId: origin._id,
				originReceiptSetId: origin.receiptSetId,
			});
		} else if (
			item.kind === "paid_digital_file"
			&& authority.kind === "paid_digital_file"
			&& paidTarget
			&& target._id === paidTarget._id
		) {
			plan.push({
				kind: item.kind,
				assetKey: item.assetKey,
				assetId: paidTarget._id,
				resolution: "reuse_v1",
				authorityId: authority._id,
				originCoordinationId: origin._id,
				originReceiptSetId: origin.receiptSetId,
			});
		} else {
			throw new Error("Private catalog target authority kind is corrupt");
		}
	}
	return plan;
}

function sameTargetPlan(
	left: readonly CatalogPrivateAssetTargetPlan[],
	right: readonly CatalogPrivateAssetTargetPlan[],
) {
	return left.length === right.length && left.every((entry, index) => {
		const other = right[index];
		if (
			!other
			|| entry.kind !== other.kind
			|| entry.assetKey !== other.assetKey
			|| entry.resolution !== other.resolution
		) return false;
		if (entry.resolution === "create" && other.resolution === "create") return true;
		return entry.resolution === "reuse_v1"
			&& other.resolution === "reuse_v1"
			&& entry.assetId === other.assetId
			&& entry.authorityId === other.authorityId
			&& entry.originCoordinationId === other.originCoordinationId
			&& entry.originReceiptSetId === other.originReceiptSetId;
	});
}

export function requireStoredV2TargetPlan(
	coordination: PendingCoordination,
	recomputed: readonly CatalogPrivateAssetTargetPlan[],
) {
	const targetResolutionVersion = "targetResolutionVersion" in coordination
		? coordination.targetResolutionVersion
		: undefined;
	const targetPlan = "targetPlan" in coordination ? coordination.targetPlan : undefined;
	if (targetResolutionVersion === undefined && targetPlan === undefined) {
		if (recomputed.some((entry) => entry.resolution !== "create")) {
			throw new Error("Legacy V2 coordination cannot acquire a reuse plan");
		}
		return [...recomputed];
	}
	if (
		targetResolutionVersion !== 1
		|| !targetPlan
		|| !sameTargetPlan(targetPlan, recomputed)
	) throw new Error("Private catalog V2 target resolution has drifted");
	return targetPlan;
}

export async function materializePrivateCatalogV2Targets(
	ctx: MutationCtx,
	coordination: PendingCoordination,
	facts: readonly CatalogPrivateAssetFacts[],
	plan: readonly CatalogPrivateAssetTargetPlan[],
	storageReceivedAt: number,
	verifiedAt: number,
) {
	if (facts.length !== plan.length) {
		throw new Error("Private catalog V2 target plan is incomplete");
	}
	const targets: CatalogPrivateAssetTargetMapping[] = [];
	const targetBindings: CatalogPrivateAssetTargetBinding[] = [];
	for (let index = 0; index < facts.length; index += 1) {
		const item = facts[index];
		const entry = plan[index];
		if (!item || !entry || item.kind !== entry.kind || item.assetKey !== entry.assetKey) {
			throw new Error("Private catalog V2 target plan is corrupt");
		}
		if (entry.resolution === "reuse_v1") {
			const mapping = entry.kind === "print_source"
				? { kind: entry.kind, assetKey: entry.assetKey, assetId: entry.assetId }
				: { kind: entry.kind, assetKey: entry.assetKey, assetId: entry.assetId };
			targets.push(mapping);
			targetBindings.push({
				...mapping,
				resolution: "reused_v1",
				authorityId: entry.authorityId,
				originCoordinationId: entry.originCoordinationId,
				originReceiptSetId: entry.originReceiptSetId,
			});
			continue;
		}
		const target = privateCatalogRegistrationTarget(coordination.siteUrl, item, {
			createdAt: storageReceivedAt,
			createdBy: STORAGE_ACTOR,
			verifiedAt,
			verifiedBy: VERIFICATION_ACTOR,
		});
		let mapping: CatalogPrivateAssetTargetMapping;
		if (target.kind === "print_source") {
			const assetId = await ctx.db.insert("catalogPrintSourceAssets", target.asset);
			mapping = { kind: target.kind, assetKey: item.assetKey, assetId };
		} else {
			const assetId = await ctx.db.insert("catalogDigitalFileAssets", target.asset);
			mapping = { kind: target.kind, assetKey: item.assetKey, assetId };
		}
		const authorityId = await insertAuthority(ctx, mapping, {
			siteUrl: coordination.siteUrl,
			coordinationId: coordination._id,
			receiptSetId: coordination.receiptSetId,
			schemaVersion: 2,
			indexedAt: verifiedAt,
		});
		targets.push(mapping);
		targetBindings.push({ ...mapping, resolution: "created", authorityId });
	}
	return { targets, targetBindings };
}

async function requireNewV2Targets(
	ctx: PrivateCatalogReadCtx,
	coordination: Extract<VerifiedCoordination, { storageReceiptSet: { schemaVersion: 2 } }>,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	if (
		coordination.targetResolutionVersion !== 1
		|| !coordination.targetBindings
		|| coordination.targetBindings.length !== facts.length
	) throw new Error("Private catalog V2 target bindings are missing or corrupt");
	let sharedOrigin: ValidatedV1Origin | undefined;
	for (let index = 0; index < facts.length; index += 1) {
		const item = facts[index];
		const mapping = coordination.targets[index];
		const binding = coordination.targetBindings[index];
		if (
			!item
			|| !mapping
			|| !binding
			|| item.kind !== mapping.kind
			|| item.assetKey !== mapping.assetKey
			|| binding.kind !== mapping.kind
			|| binding.assetKey !== mapping.assetKey
			|| binding.assetId !== mapping.assetId
		) throw new Error("Private catalog V2 target binding is corrupt");
		await requireNoOppositeKindTargetState(
			ctx,
			coordination.siteUrl,
			item.kind,
			item.assetKey,
		);
		if (binding.resolution === "created") {
			await requireClassicTarget(ctx, coordination, item, mapping);
			await requireIndexedAuthority(ctx, binding.authorityId, {
				siteUrl: coordination.siteUrl,
				kind: binding.kind,
				assetKey: binding.assetKey,
				assetId: binding.assetId,
				originCoordinationId: coordination._id,
				originReceiptSetId: coordination.receiptSetId,
				originSchemaVersion: 2,
			});
			continue;
		}
		const authority = await requireIndexedAuthority(ctx, binding.authorityId, {
			siteUrl: coordination.siteUrl,
			kind: binding.kind,
			assetKey: binding.assetKey,
			assetId: binding.assetId,
			originCoordinationId: binding.originCoordinationId,
			originReceiptSetId: binding.originReceiptSetId,
			originSchemaVersion: 1,
		});
		sharedOrigin = await requireV1Origin(
			ctx,
			authority,
			coordination.siteUrl,
			item,
			binding.assetId,
			sharedOrigin,
		);
	}
}

export async function requireVerifiedPrivateCatalogTargets(
	ctx: PrivateCatalogReadCtx,
	coordination: VerifiedCoordination,
) {
	const facts = await requireVerifiedCoordinationEvidence(coordination);
	if (
		"targetResolutionVersion" in coordination
		|| "targetBindings" in coordination
	) {
		if (
			coordination.storageReceiptSet.schemaVersion !== 2
			|| coordination.inspectionReceiptSet.schemaVersion !== 2
		) throw new Error("Private catalog verified coordination schema is corrupt");
		await requireNewV2Targets(ctx, coordination, facts);
		return coordination.targets;
	}
	for (let index = 0; index < facts.length; index += 1) {
		const item = facts[index];
		const mapping = coordination.targets[index];
		if (!item || !mapping) {
			throw new Error("Private catalog verified target mapping is corrupt");
		}
		requireMappingMatchesFacts(item, mapping);
		await requireClassicTarget(ctx, coordination, item, mapping);
	}
	return coordination.targets;
}

export async function backfillPrivateCatalogTargetAuthorities(
	ctx: MutationCtx,
	siteUrl: string,
	receiptSetId: string,
) {
	const coordination = await ctx.db.query("catalogPrivateAssetReceiptCoordinations")
		.withIndex("by_siteUrl_and_receiptSetId", (q) =>
			q.eq("siteUrl", siteUrl).eq("receiptSetId", receiptSetId)
		)
		.unique();
	if (
		!coordination
		|| coordination.status !== "verified"
		|| coordination.storageReceiptSet.schemaVersion !== 1
		|| coordination.inspectionReceiptSet.schemaVersion !== 1
	) throw new Error("Private catalog authority backfill requires one verified V1 coordination");
	const targets = await requireVerifiedPrivateCatalogTargets(ctx, coordination);
	let inserted = 0;
	const indexedAt = Date.now();
	for (const mapping of targets) {
		const [byKey, byId] = await Promise.all([
			authorityByKey(ctx, siteUrl, mapping.kind, mapping.assetKey),
			authorityByAssetId(ctx, siteUrl, mapping.kind, mapping.assetId),
		]);
		if (!byKey && !byId) {
			await insertAuthority(ctx, mapping, {
				siteUrl,
				coordinationId: coordination._id,
				receiptSetId,
				schemaVersion: 1,
				indexedAt,
			});
			inserted += 1;
			continue;
		}
		if (!byKey || !byId || byKey._id !== byId._id) {
			throw new Error("Private catalog target authority backfill conflicts");
		}
		requireAuthorityFields(byKey, {
			siteUrl,
			kind: mapping.kind,
			assetKey: mapping.assetKey,
			assetId: mapping.assetId,
			originCoordinationId: coordination._id,
			originReceiptSetId: receiptSetId,
			originSchemaVersion: 1,
		});
	}
	return { replayed: inserted === 0, targetCount: targets.length };
}
