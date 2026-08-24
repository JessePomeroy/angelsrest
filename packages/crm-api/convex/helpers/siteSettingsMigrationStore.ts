import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireRestoreOperationId } from "./contentRevisionProvenance";
import {
	checksumContentPayload,
	getContentDocument,
	insertSingletonContentRevision,
} from "./contentStore";
import {
	type ContentRevisionPayload,
	type SiteSettingsDraftPayload,
	serializeSiteSettingsPayload,
	toPublishedSiteSettings,
	validateSiteSettingsDraft,
} from "./contentValidators";
import { requireReadySiteSettingsOgImage } from "./siteSettingsData";
import {
	parseSanitySiteSettingsImageReference,
	requireSanitySiteSettingsPlan,
	type SanitySiteSettingsPlan,
} from "./sanitySiteSettingsPlan";

const SITE_SETTINGS_KIND = "siteSettings" as const;
const IMPORT_ACTOR_PREFIX = "sanityImport:site-settings:";
const MEDIA_ATTESTATION_ACTOR_PREFIX = "sanityImport:site-settings-media:";
const RESTORE_ACTOR = "operator:site-settings-pinned-restore";
const RESTORE_CONFLICT =
	"Site Settings pinned restore conflict: reload and rebuild the exact restore request";
const ACTOR_MAX = 2_048;

type SiteSettingsDocument = Doc<"contentDocuments"> & {
	kind: typeof SITE_SETTINGS_KIND;
};

const nullableRevisionValidator = v.union(v.id("contentRevisions"), v.null());

export const siteSettingsPinnedRestoreEntryValidator = v.object({
	documentId: v.id("contentDocuments"),
	sourceRevisionId: v.id("contentRevisions"),
	expected: v.object({
		draftRevisionId: nullableRevisionValidator,
		publishedRevisionId: v.id("contentRevisions"),
		publishedAt: v.number(),
		publishedBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
	}),
});

export type SiteSettingsPinnedRestoreEntry = Infer<
	typeof siteSettingsPinnedRestoreEntryValidator
>;

type PreparedPayload = {
	payload: SiteSettingsDraftPayload;
	serialized: string;
	checksum: string;
};

function requireSha256(value: string, label: string) {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid`);
}

function mediaAttestationActor(attestationDigest: string) {
	requireSha256(attestationDigest, "Site Settings media attestation digest");
	return `${MEDIA_ATTESTATION_ACTOR_PREFIX}${attestationDigest}`;
}

export async function digestSiteSettingsMediaAttestation(args: {
	siteUrl: string;
	mediaAssetId: Id<"mediaAssets">;
	workerAssetId: string;
	sourceAssetRef: string;
	sourceSha256: string;
	receiptDigest: string;
}) {
	parseSanitySiteSettingsImageReference(args.sourceAssetRef);
	requireSha256(args.sourceSha256, "Site Settings media source SHA-256");
	requireSha256(args.receiptDigest, "Site Settings media receipt digest");
	return await checksumContentPayload(JSON.stringify({
		siteUrl: args.siteUrl,
		mediaAssetId: args.mediaAssetId,
		workerAssetId: args.workerAssetId,
		sourceAssetRef: args.sourceAssetRef,
		sourceSha256: args.sourceSha256,
		receiptDigest: args.receiptDigest,
	}));
}

/** One-way receipt-bound attestation for the transferred source image. */
export async function attestSiteSettingsMediaSource(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		mediaAssetId: Id<"mediaAssets">;
		workerAssetId: string;
		sourceAssetRef: string;
		sourceSha256: string;
		receiptDigest: string;
	},
) {
	const actor = mediaAttestationActor(await digestSiteSettingsMediaAttestation(args));
	const source = parseSanitySiteSettingsImageReference(args.sourceAssetRef);
	await requireTenant(ctx, args.siteUrl);
	const asset = await ctx.db.get(args.mediaAssetId);
	if (
		!asset
		|| asset.siteUrl !== args.siteUrl
		|| asset.assetId !== args.workerAssetId
		|| asset.intent !== "web"
		|| asset.status !== "ready"
		|| asset.source.contentType !== source.contentType
		|| asset.source.width !== source.width
		|| asset.source.height !== source.height
	) throw new Error("Site Settings media attestation target does not match the receipt");
	if (asset.source.sha256 !== undefined && asset.source.sha256 !== args.sourceSha256) {
		throw new Error("Site Settings media source SHA-256 conflicts with the receipt");
	}
	if (
		asset.updatedBy.startsWith(MEDIA_ATTESTATION_ACTOR_PREFIX)
		&& asset.updatedBy !== actor
	) throw new Error("Site Settings media asset already has a different immutable attestation");
	if (asset.source.sha256 === args.sourceSha256 && asset.updatedBy === actor) {
		return { status: "identical-replay" as const, mediaAssetId: asset._id };
	}
	await ctx.db.patch(asset._id, {
		source: { ...asset.source, sha256: args.sourceSha256 },
		updatedAt: Date.now(),
		updatedBy: actor,
	});
	return { status: "attested" as const, mediaAssetId: asset._id };
}

function conflict(): never {
	throw new Error(RESTORE_CONFLICT);
}

function asSiteSettingsDocument(
	document: Doc<"contentDocuments">,
): SiteSettingsDocument {
	if (document.kind !== SITE_SETTINGS_KIND) {
		throw new Error("Site Settings content kind mismatch");
	}
	return document as SiteSettingsDocument;
}

function preparePayload(payload: ContentRevisionPayload) {
	const narrowed = payload as SiteSettingsDraftPayload;
	validateSiteSettingsDraft(narrowed);
	toPublishedSiteSettings(narrowed);
	return {
		payload: narrowed,
		serialized: serializeSiteSettingsPayload(narrowed),
	};
}

async function preparePlan(
	ctx: MutationCtx,
	plan: SanitySiteSettingsPlan,
): Promise<PreparedPayload> {
	const prepared = preparePayload(plan.payload);
	const image = plan.decisionSet.seoImage;
	if (image.action === "extend-target-and-transfer-exact-source") {
		const asset = await requireReadySiteSettingsOgImage(
			ctx,
			plan.siteUrl,
			plan.payload.seoOgImageAssetId,
		);
		const attestationDigest = await digestSiteSettingsMediaAttestation({
			siteUrl: plan.siteUrl,
			mediaAssetId: image.targetMediaAssetId,
			workerAssetId: image.targetWorkerAssetId,
			sourceAssetRef: image.sourceAssetRef,
			sourceSha256: image.sourceSha256,
			receiptDigest: image.targetReceiptSha256,
		});
		if (
			!asset
			|| asset._id !== image.targetMediaAssetId
			|| asset.assetId !== image.targetWorkerAssetId
			|| asset.source.sha256 !== image.sourceSha256
			|| asset.source.width !== image.sourceWidth
			|| asset.source.height !== image.sourceHeight
			|| asset.source.contentType !== image.sourceContentType
			|| asset.updatedBy !== mediaAttestationActor(attestationDigest)
		) throw new Error("Site Settings SEO image receipt does not match the approved source");
	}
	return {
		...prepared,
		checksum: await checksumContentPayload(prepared.serialized),
	};
}

async function requireTenant(ctx: MutationCtx, siteUrl: string) {
	const tenant = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!tenant) throw new Error("Site Settings migration tenant does not exist");
}

export function isInitialSanitySiteSettingsImport(
	document: Doc<"contentDocuments"> | null,
) {
	return Boolean(
		document
		&& document.kind === SITE_SETTINGS_KIND
		&& document.createdBy.startsWith(IMPORT_ACTOR_PREFIX)
		&& !document.publishedRevisionId,
	);
}

async function requireImportRevision(
	ctx: MutationCtx,
	document: SiteSettingsDocument,
	args: { actor: string; checksum: string; serialized: string },
) {
	if (
		document.documentKey !== undefined
		|| document.slug !== undefined
		|| document.rank !== undefined
		|| document.archivedAt !== undefined
		|| document.archivedBy !== undefined
		|| document.createdBy !== args.actor
	) throw new Error("Existing Site Settings import identity changed");
	const revisions = await ctx.db
		.query("contentRevisions")
		.withIndex("by_documentId_and_createdAt", (q) => q.eq("documentId", document._id))
		.take(2);
	if (revisions.length !== 1) {
		throw new Error("Existing Site Settings import revision history changed");
	}
	const revision = revisions[0];
	if (
		!revision
		|| revision.siteUrl !== document.siteUrl
		|| revision.documentId !== document._id
		|| revision.kind !== SITE_SETTINGS_KIND
		|| revision.schemaVersion !== 1
		|| revision.source !== "sanityImport"
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
		|| revision.createdAt !== document.createdAt
		|| revision.createdBy !== args.actor
		|| revision.checksum !== args.checksum
	) throw new Error("Existing Site Settings import provenance changed");
	const stored = preparePayload(revision.payload);
	if (
		stored.serialized !== args.serialized
		|| (await checksumContentPayload(stored.serialized)) !== args.checksum
	) throw new Error("Existing Site Settings import payload changed");
	return revision;
}

/** Import or exactly replay one fixed unpublished Site Settings singleton. */
export async function importSanitySiteSettingsDraft(
	ctx: MutationCtx,
	args: { plan: SanitySiteSettingsPlan; digest: string },
) {
	const digest = await requireSanitySiteSettingsPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	const prepared = await preparePlan(ctx, args.plan);
	const actor = `${IMPORT_ACTOR_PREFIX}${digest}`;
	const existing = await getContentDocument(ctx, args.plan.siteUrl, SITE_SETTINGS_KIND);
	if (existing) {
		const document = asSiteSettingsDocument(existing);
		if (
			!document.draftRevisionId
			|| document.publishedRevisionId !== undefined
			|| document.publishedAt !== undefined
			|| document.publishedBy !== undefined
			|| document.updatedBy !== actor
			|| document.createdAt !== document.updatedAt
		) throw new Error("Existing Site Settings import is not an untouched draft");
		const revision = await requireImportRevision(ctx, document, {
			actor,
			checksum: prepared.checksum,
			serialized: prepared.serialized,
		});
		if (document.draftRevisionId !== revision._id) {
			throw new Error("Existing Site Settings import draft pointer changed");
		}
		return {
			status: "identical-replay" as const,
			digest,
			documentId: document._id,
			revisionId: revision._id,
		};
	}

	const now = Date.now();
	const documentId = await ctx.db.insert("contentDocuments", {
		siteUrl: args.plan.siteUrl,
		kind: SITE_SETTINGS_KIND,
		createdAt: now,
		createdBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	const stored = await ctx.db.get(documentId);
	if (!stored) throw new Error("Site Settings document creation failed");
	const document = asSiteSettingsDocument(stored);
	const revisionId = await insertSingletonContentRevision(ctx, {
		document,
		kind: SITE_SETTINGS_KIND,
		payload: prepared.payload,
		checksum: prepared.checksum,
		writer: { actor, now, source: "sanityImport" },
	});
	await ctx.db.patch(documentId, { draftRevisionId: revisionId });
	return { status: "imported" as const, digest, documentId, revisionId };
}

/** Publish or exactly replay the one fixed imported Site Settings revision. */
export async function publishSanitySiteSettingsDraft(
	ctx: MutationCtx,
	args: { plan: SanitySiteSettingsPlan; digest: string },
) {
	const digest = await requireSanitySiteSettingsPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	const prepared = await preparePlan(ctx, args.plan);
	const actor = `${IMPORT_ACTOR_PREFIX}${digest}`;
	const publishActor = `sanityPublish:site-settings:${digest}`;
	const stored = await getContentDocument(ctx, args.plan.siteUrl, SITE_SETTINGS_KIND);
	if (!stored) throw new Error("Site Settings publication requires the exact import");
	const document = asSiteSettingsDocument(stored);
	const revision = await requireImportRevision(ctx, document, {
		actor,
		checksum: prepared.checksum,
		serialized: prepared.serialized,
	});

	if (
		document.draftRevisionId === undefined
		&& document.publishedRevisionId === revision._id
		&& document.publishedAt !== undefined
		&& document.publishedBy === publishActor
		&& document.updatedAt === document.publishedAt
		&& document.updatedBy === publishActor
	) {
		return {
			status: "identical-replay" as const,
			digest,
			publishedAt: document.publishedAt,
			documentId: document._id,
			revisionId: revision._id,
		};
	}
	if (
		document.draftRevisionId !== revision._id
		|| document.publishedRevisionId !== undefined
		|| document.publishedAt !== undefined
		|| document.publishedBy !== undefined
		|| document.updatedAt !== document.createdAt
		|| document.updatedBy !== actor
	) throw new Error("Site Settings publication target changed");

	const publishedAt = Date.now();
	await ctx.db.patch(document._id, {
		draftRevisionId: undefined,
		publishedRevisionId: revision._id,
		publishedAt,
		publishedBy: publishActor,
		updatedAt: publishedAt,
		updatedBy: publishActor,
	});
	return {
		status: "published" as const,
		digest,
		publishedAt,
		documentId: document._id,
		revisionId: revision._id,
	};
}

function validateTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) conflict();
}

function validateActor(value: string) {
	if (!value || value.length > ACTOR_MAX) conflict();
}

function validateRestoreEntry(entry: SiteSettingsPinnedRestoreEntry) {
	if (entry.expected.draftRevisionId === entry.sourceRevisionId) conflict();
	validateTimestamp(entry.expected.publishedAt);
	validateTimestamp(entry.expected.updatedAt);
	validateActor(entry.expected.publishedBy);
	validateActor(entry.expected.updatedBy);
	return entry;
}

export async function digestSiteSettingsRestoreRequest(
	siteUrl: string,
	operationId: string,
	entry: SiteSettingsPinnedRestoreEntry,
) {
	return await checksumContentPayload(
		JSON.stringify({
			siteUrl,
			operationId,
			entry: {
				documentId: entry.documentId,
				sourceRevisionId: entry.sourceRevisionId,
				expected: {
					draftRevisionId: entry.expected.draftRevisionId,
					publishedRevisionId: entry.expected.publishedRevisionId,
					publishedAt: entry.expected.publishedAt,
					publishedBy: entry.expected.publishedBy,
					updatedAt: entry.expected.updatedAt,
					updatedBy: entry.expected.updatedBy,
				},
			},
		}),
	);
}

async function loadRestoreDocument(
	ctx: MutationCtx,
	siteUrl: string,
	entry: SiteSettingsPinnedRestoreEntry,
) {
	await requireTenant(ctx, siteUrl);
	const [stored, singleton] = await Promise.all([
		ctx.db.get(entry.documentId),
		getContentDocument(ctx, siteUrl, SITE_SETTINGS_KIND),
	]);
	if (!stored || !singleton || singleton._id !== stored._id) {
		throw new Error("Site Settings pinned restore document not found");
	}
	if (stored.siteUrl !== siteUrl || stored.kind !== SITE_SETTINGS_KIND) {
		throw new Error("Site Settings pinned restore ownership mismatch");
	}
	return asSiteSettingsDocument(stored);
}

function assertExactCas(
	document: SiteSettingsDocument,
	entry: SiteSettingsPinnedRestoreEntry,
) {
	const expected = entry.expected;
	if (
		document.draftRevisionId !== (expected.draftRevisionId ?? undefined)
		|| document.publishedRevisionId !== expected.publishedRevisionId
		|| document.publishedAt !== expected.publishedAt
		|| document.publishedBy !== expected.publishedBy
		|| document.updatedAt !== expected.updatedAt
		|| document.updatedBy !== expected.updatedBy
		|| document.archivedAt !== undefined
		|| document.archivedBy !== undefined
	) conflict();
}

async function requirePublishableRevision(
	ctx: MutationCtx,
	document: SiteSettingsDocument,
	revisionId: Id<"contentRevisions">,
) {
	const revision = await ctx.db.get(revisionId);
	if (
		!revision
		|| revision.siteUrl !== document.siteUrl
		|| revision.documentId !== document._id
		|| revision.kind !== SITE_SETTINGS_KIND
		|| revision.schemaVersion !== 1
	) throw new Error("Site Settings revision ownership mismatch");
	const prepared = preparePayload(revision.payload);
	if (
		revision.checksum !== await checksumContentPayload(prepared.serialized)
	) throw new Error("Site Settings revision checksum mismatch");
	await requireReadySiteSettingsOgImage(
		ctx,
		document.siteUrl,
		prepared.payload.seoOgImageAssetId,
	);
	return { revision, prepared };
}

async function exactRestoreReplay(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		digest: string;
		entry: SiteSettingsPinnedRestoreEntry;
		document: SiteSettingsDocument;
	},
) {
	const rows = await ctx.db
		.query("contentRevisions")
		.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("restoreOperationId", args.operationId),
		)
		.take(2);
	if (rows.length === 0) return null;
	if (rows.length !== 1) conflict();
	const row = rows[0];
	if (
		!row
		|| row.documentId !== args.document._id
		|| row.kind !== SITE_SETTINGS_KIND
		|| row.source !== "restore"
		|| row.createdBy !== RESTORE_ACTOR
		|| row.restoredFromRevisionId !== args.entry.sourceRevisionId
		|| row.restoreOperationId !== args.operationId
		|| row.restoreRequestDigest !== args.digest
		|| args.document.draftRevisionId !== (args.entry.expected.draftRevisionId ?? undefined)
		|| args.document.publishedRevisionId !== row._id
		|| args.document.publishedAt !== row.createdAt
		|| args.document.publishedBy !== RESTORE_ACTOR
		|| args.document.updatedAt !== row.createdAt
		|| args.document.updatedBy !== RESTORE_ACTOR
		|| args.document.archivedAt !== undefined
		|| args.document.archivedBy !== undefined
	) conflict();
	const [source, restored] = await Promise.all([
		requirePublishableRevision(ctx, args.document, args.entry.sourceRevisionId),
		requirePublishableRevision(ctx, args.document, row._id),
	]);
	if (
		source.revision.checksum !== row.checksum
		|| source.prepared.serialized !== restored.prepared.serialized
	) conflict();
	return {
		status: "identical-replay" as const,
		operationId: args.operationId,
		restoredAt: row.createdAt,
		documentId: args.document._id,
		sourceRevisionId: args.entry.sourceRevisionId,
		restoredRevisionId: row._id,
	};
}

/** Republish a new immutable revision from one exact pinned singleton. */
export async function restorePinnedSiteSettingsRevision(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		entry: SiteSettingsPinnedRestoreEntry;
	},
) {
	requireRestoreOperationId(args.operationId);
	const entry = validateRestoreEntry(args.entry);
	const document = await loadRestoreDocument(ctx, args.siteUrl, entry);
	const digest = await digestSiteSettingsRestoreRequest(
		args.siteUrl,
		args.operationId,
		entry,
	);
	const replay = await exactRestoreReplay(ctx, {
		...args,
		digest,
		entry,
		document,
	});
	if (replay) return replay;

	assertExactCas(document, entry);
	await requirePublishableRevision(ctx, document, entry.expected.publishedRevisionId);
	const source = await requirePublishableRevision(ctx, document, entry.sourceRevisionId);
	const latest = Math.max(entry.expected.updatedAt, entry.expected.publishedAt);
	const restoredAt = Math.max(Date.now(), latest + 1);
	validateTimestamp(restoredAt);
	if (restoredAt <= latest) conflict();
	const restoredRevisionId = await insertSingletonContentRevision(ctx, {
		document,
		kind: SITE_SETTINGS_KIND,
		payload: source.prepared.payload,
		checksum: source.revision.checksum,
		writer: {
			actor: RESTORE_ACTOR,
			now: restoredAt,
			source: "restore",
			restoredFromRevisionId: source.revision._id,
			restoreOperationId: args.operationId,
			restoreRequestDigest: digest,
		},
	});
	await ctx.db.patch(document._id, {
		draftRevisionId: entry.expected.draftRevisionId ?? undefined,
		publishedRevisionId: restoredRevisionId,
		publishedAt: restoredAt,
		publishedBy: RESTORE_ACTOR,
		updatedAt: restoredAt,
		updatedBy: RESTORE_ACTOR,
	});
	return {
		status: "restored" as const,
		operationId: args.operationId,
		restoredAt,
		documentId: document._id,
		sourceRevisionId: source.revision._id,
		restoredRevisionId,
	};
}
