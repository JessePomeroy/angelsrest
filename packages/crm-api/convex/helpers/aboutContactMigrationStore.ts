import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
	requireAboutHostShape,
	requireContactHostShape,
} from "./aboutContactHostContract";
import { requireReadyAboutAssets } from "./aboutPageData";
import type { AboutPageDraftPayload } from "./aboutPageValidators";
import {
	serializeAboutPagePayload,
	toPublishedAboutPage,
	validateAboutPageDraft,
} from "./aboutPageValidators";
import type { ContactPageDraftPayload } from "./contactPageValidators";
import {
	serializeContactPagePayload,
	toPublishedContactPage,
	validateContactPageDraft,
} from "./contactPageValidators";
import { requireRestoreOperationId } from "./contentRevisionProvenance";
import {
	checksumContentPayload,
	getContentDocument,
	insertSingletonContentRevision,
} from "./contentStore";
import type { ContentRevisionPayload } from "./contentValidators";
import {
	requireSanityAboutContactPlan,
	type SanityAboutContactPlan,
} from "./sanityAboutContactPlan";

const PAGE_KINDS = ["aboutPage", "contactPage"] as const;
type PageKind = (typeof PAGE_KINDS)[number];
type PageDocument = Doc<"contentDocuments"> & { kind: PageKind };

const nullableRevisionValidator = v.union(v.id("contentRevisions"), v.null());

export const aboutContactPinnedRestoreEntryValidator = v.object({
	kind: v.union(v.literal("aboutPage"), v.literal("contactPage")),
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

export type AboutContactPinnedRestoreEntry = Infer<
	typeof aboutContactPinnedRestoreEntryValidator
>;

type PreparedPayload = {
	payload: ContentRevisionPayload;
	serialized: string;
};

type LoadedDocument = {
	entry: AboutContactPinnedRestoreEntry;
	document: PageDocument;
};

const IMPORT_ACTOR_PREFIX = "sanityImport:about-contact:";
const MEDIA_ATTESTATION_ACTOR_PREFIX = "sanityImport:about-contact-media:";
const RESTORE_ACTOR = "operator:about-contact-pinned-restore";
const RESTORE_CONFLICT =
	"About and Contact pinned restore conflict: reload and rebuild the exact restore request";
const ACTOR_MAX = 2_048;

function conflict(): never {
	throw new Error(RESTORE_CONFLICT);
}

function requireSha256(value: string, label: string) {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid`);
}

function mediaAttestationActor(attestationDigest: string) {
	requireSha256(attestationDigest, "About media attestation digest");
	return `${MEDIA_ATTESTATION_ACTOR_PREFIX}${attestationDigest}`;
}

export async function digestAboutContactMediaAttestation(args: {
	siteUrl: string;
	mediaAssetId: Id<"mediaAssets">;
	workerAssetId: string;
	sourceSha256: string;
	sourceWidth: number;
	sourceHeight: number;
	receiptDigest: string;
}) {
	requireSha256(args.sourceSha256, "About media source SHA-256");
	requireSha256(args.receiptDigest, "About media receipt digest");
	return await checksumContentPayload(JSON.stringify({
		siteUrl: args.siteUrl,
		mediaAssetId: args.mediaAssetId,
		workerAssetId: args.workerAssetId,
		sourceSha256: args.sourceSha256,
		sourceWidth: args.sourceWidth,
		sourceHeight: args.sourceHeight,
		receiptDigest: args.receiptDigest,
	}));
}

/** One-way receipt-bound attestation for a ready asset created by the media worker. */
export async function attestAboutContactMediaSource(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		mediaAssetId: Id<"mediaAssets">;
		workerAssetId: string;
		sourceSha256: string;
		sourceWidth: number;
		sourceHeight: number;
		receiptDigest: string;
	},
) {
	const actor = mediaAttestationActor(await digestAboutContactMediaAttestation(args));
	await requireTenant(ctx, args.siteUrl);
	const asset = await ctx.db.get(args.mediaAssetId);
	if (
		!asset
		|| asset.siteUrl !== args.siteUrl
		|| asset.assetId !== args.workerAssetId
		|| asset.intent !== "web"
		|| asset.status !== "ready"
		|| asset.source.width !== args.sourceWidth
		|| asset.source.height !== args.sourceHeight
	) throw new Error("About media attestation target does not match the receipt");
	if (asset.source.sha256 !== undefined && asset.source.sha256 !== args.sourceSha256) {
		throw new Error("About media source SHA-256 conflicts with the receipt");
	}
	if (
		asset.updatedBy.startsWith(MEDIA_ATTESTATION_ACTOR_PREFIX)
		&& asset.updatedBy !== actor
	) throw new Error("About media asset already has a different immutable attestation");
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

function asPageDocument(
	document: Doc<"contentDocuments">,
	kind: PageKind,
): PageDocument {
	if (document.kind !== kind) {
		throw new Error("About and Contact content kind mismatch");
	}
	return document as PageDocument;
}

function preparePayload(
	kind: PageKind,
	payload: ContentRevisionPayload,
): PreparedPayload {
	if (kind === "aboutPage") {
		const about = payload as AboutPageDraftPayload;
		validateAboutPageDraft(about);
		return { payload: about, serialized: serializeAboutPagePayload(about) };
	}
	const contact = payload as ContactPageDraftPayload;
	validateContactPageDraft(contact);
	return { payload: contact, serialized: serializeContactPagePayload(contact) };
}

async function requireTenant(ctx: MutationCtx, siteUrl: string) {
	const tenant = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!tenant) throw new Error("About and Contact migration tenant does not exist");
}

async function prepareImportEntry(
	ctx: MutationCtx,
	siteUrl: string,
	entry: SanityAboutContactPlan["entries"][number],
	portraitDecision: SanityAboutContactPlan["decisionSet"]["aboutPortrait"],
) {
	const prepared = preparePayload(entry.kind, entry.payload);
	if (entry.kind === "aboutPage") {
		const assets = await requireReadyAboutAssets(
			ctx,
			siteUrl,
			(entry.payload as AboutPageDraftPayload).portraits ?? [],
		);
		const asset = assets.get(portraitDecision.targetMediaAssetId);
		const expectedSha =
			portraitDecision.action === "use-local-portrait-owner-approved"
				? portraitDecision.localSha256
				: portraitDecision.sourceSha256;
		const expectedWidth =
			portraitDecision.action === "use-local-portrait-owner-approved"
				? portraitDecision.localWidth
				: portraitDecision.sourceWidth;
		const expectedHeight =
			portraitDecision.action === "use-local-portrait-owner-approved"
				? portraitDecision.localHeight
				: portraitDecision.sourceHeight;
		const attestationDigest = await digestAboutContactMediaAttestation({
			siteUrl,
			mediaAssetId: portraitDecision.targetMediaAssetId,
			workerAssetId: portraitDecision.targetWorkerAssetId,
			sourceSha256: expectedSha,
			sourceWidth: expectedWidth,
			sourceHeight: expectedHeight,
			receiptDigest: portraitDecision.targetReceiptSha256,
		});
		if (
			!asset
			|| asset.assetId !== portraitDecision.targetWorkerAssetId
			|| asset.source.sha256 !== expectedSha
			|| asset.source.width !== expectedWidth
			|| asset.source.height !== expectedHeight
			|| asset.updatedBy !== mediaAttestationActor(attestationDigest)
		) {
			throw new Error("About portrait media receipt does not match the approved source");
		}
	}
	return {
		...entry,
		...prepared,
		checksum: await checksumContentPayload(prepared.serialized),
	};
}

async function requireImportRevision(
	ctx: MutationCtx,
	document: PageDocument,
	args: {
		actor: string;
		checksum: string;
		serialized: string;
	},
) {
	if (
		document.documentKey !== undefined
		|| document.slug !== undefined
		|| document.rank !== undefined
		|| document.archivedAt !== undefined
		|| document.archivedBy !== undefined
		|| document.createdBy !== args.actor
	) {
		throw new Error("Existing About and Contact import identity changed");
	}
	const revisions = await ctx.db
		.query("contentRevisions")
		.withIndex("by_documentId_and_createdAt", (q) =>
			q.eq("documentId", document._id),
		)
		.take(2);
	if (revisions.length !== 1) {
		throw new Error("Existing About and Contact import revision history changed");
	}
	const revision = revisions[0];
	if (
		revision.siteUrl !== document.siteUrl
		|| revision.documentId !== document._id
		|| revision.kind !== document.kind
		|| revision.schemaVersion !== 1
		|| revision.source !== "sanityImport"
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
		|| revision.createdAt !== document.createdAt
		|| revision.createdBy !== args.actor
		|| revision.checksum !== args.checksum
	) {
		throw new Error("Existing About and Contact import provenance changed");
	}
	const stored = preparePayload(document.kind, revision.payload);
	if (
		stored.serialized !== args.serialized
		|| (await checksumContentPayload(stored.serialized)) !== args.checksum
	) {
		throw new Error("Existing About and Contact import payload changed");
	}
	return revision;
}

async function requireOnlyImportRevision(
	ctx: MutationCtx,
	document: PageDocument,
	args: {
		actor: string;
		checksum: string;
		serialized: string;
	},
) {
	if (
		!document.draftRevisionId
		|| document.publishedRevisionId !== undefined
		|| document.publishedAt !== undefined
		|| document.publishedBy !== undefined
		|| document.updatedBy !== args.actor
		|| document.createdAt !== document.updatedAt
	) {
		throw new Error("Existing About and Contact import is not an untouched draft pair");
	}
	const revision = await requireImportRevision(ctx, document, args);
	if (revision._id !== document.draftRevisionId) {
		throw new Error("Existing About and Contact import draft pointer changed");
	}
	return revision;
}

/** Execute or exactly replay one fixed, atomic, unpublished About/Contact pair. */
export async function importSanityAboutContactDrafts(
	ctx: MutationCtx,
	args: {
		plan: SanityAboutContactPlan;
		digest: string;
	},
) {
	const digest = await requireSanityAboutContactPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	const prepared = await Promise.all(
		args.plan.entries.map((entry) =>
			prepareImportEntry(
				ctx,
				args.plan.siteUrl,
				entry,
				args.plan.decisionSet.aboutPortrait,
			),
		),
	);
	const existing = await Promise.all(
		PAGE_KINDS.map((kind) =>
			getContentDocument(ctx, args.plan.siteUrl, kind),
		),
	);
	const existingCount = existing.filter(Boolean).length;
	if (existingCount > 0 && existingCount < PAGE_KINDS.length) {
		throw new Error("About and Contact import target is in a partial state");
	}
	const actor = `${IMPORT_ACTOR_PREFIX}${digest}`;

	if (existingCount === PAGE_KINDS.length) {
		const documents = [];
		for (const [index, stored] of existing.entries()) {
			const item = prepared[index];
			if (!stored || !item || item.kind !== PAGE_KINDS[index]) {
				throw new Error("About and Contact import pair is malformed");
			}
			const document = asPageDocument(stored, item.kind);
			const revision = await requireOnlyImportRevision(ctx, document, {
				actor,
				checksum: item.checksum,
				serialized: item.serialized,
			});
			documents.push({
				kind: item.kind,
				documentId: document._id,
				revisionId: revision._id,
			});
		}
		if (existing[0]?.createdAt !== existing[1]?.createdAt) {
			throw new Error("Existing About and Contact import was not atomic");
		}
		return { status: "identical-replay" as const, digest, documents };
	}

	const now = Date.now();
	const documents = [];
	for (const item of prepared) {
		const documentId = await ctx.db.insert("contentDocuments", {
			siteUrl: args.plan.siteUrl,
			kind: item.kind,
			createdAt: now,
			createdBy: actor,
			updatedAt: now,
			updatedBy: actor,
		});
		const stored = await ctx.db.get(documentId);
		if (!stored) throw new Error("About and Contact document creation failed");
		const document = asPageDocument(stored, item.kind);
		const revisionId = await insertSingletonContentRevision(ctx, {
			document,
			kind: item.kind,
			payload: item.payload,
			checksum: item.checksum,
			writer: { actor, now, source: "sanityImport" },
		});
		await ctx.db.patch(documentId, { draftRevisionId: revisionId });
		documents.push({ kind: item.kind, documentId, revisionId });
	}
	return { status: "imported" as const, digest, documents };
}

/** Atomically publish or exactly replay one fixed imported About/Contact pair. */
export async function publishSanityAboutContactDrafts(
	ctx: MutationCtx,
	args: {
		plan: SanityAboutContactPlan;
		digest: string;
	},
) {
	const digest = await requireSanityAboutContactPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	const prepared = await Promise.all(
		args.plan.entries.map((entry) =>
			prepareImportEntry(
				ctx,
				args.plan.siteUrl,
				entry,
				args.plan.decisionSet.aboutPortrait,
			),
		),
	);
	const actor = `${IMPORT_ACTOR_PREFIX}${digest}`;
	const publishActor = `sanityPublish:about-contact:${digest}`;
	const loaded = [];
	for (const [index, kind] of PAGE_KINDS.entries()) {
		const stored = await getContentDocument(ctx, args.plan.siteUrl, kind);
		const item = prepared[index];
		if (!stored || !item || item.kind !== kind) {
			throw new Error("About and Contact publication requires the exact imported pair");
		}
		const document = asPageDocument(stored, kind);
		const revision = await requireImportRevision(ctx, document, {
			actor,
			checksum: item.checksum,
			serialized: item.serialized,
		});
		if (kind === "aboutPage") {
			toPublishedAboutPage(item.payload as AboutPageDraftPayload);
		} else {
			toPublishedContactPage(item.payload as ContactPageDraftPayload);
		}
		loaded.push({ document, revision });
	}

	const states = loaded.map(({ document, revision }) => {
		if (
			document.draftRevisionId === revision._id
			&& document.publishedRevisionId === undefined
			&& document.publishedAt === undefined
			&& document.publishedBy === undefined
			&& document.updatedAt === document.createdAt
			&& document.updatedBy === actor
		) return "draft" as const;
		if (
			document.draftRevisionId === undefined
			&& document.publishedRevisionId === revision._id
			&& document.publishedAt !== undefined
			&& document.publishedBy === publishActor
			&& document.updatedAt === document.publishedAt
			&& document.updatedBy === publishActor
		) return "published" as const;
		throw new Error("About and Contact publication target changed");
	});
	if (states[0] !== states[1]) {
		throw new Error("About and Contact publication target is in a partial state");
	}
	if (states[0] === "published") {
		const publishedAt = loaded[0]?.document.publishedAt;
		if (publishedAt === undefined || loaded[1]?.document.publishedAt !== publishedAt) {
			throw new Error("About and Contact publication was not atomic");
		}
		return {
			status: "identical-replay" as const,
			digest,
			publishedAt,
			documents: loaded.map(({ document, revision }) => ({
				kind: document.kind,
				documentId: document._id,
				revisionId: revision._id,
			})),
		};
	}

	const publishedAt = Date.now();
	const documents = [];
	for (const { document, revision } of loaded) {
		await ctx.db.patch(document._id, {
			draftRevisionId: undefined,
			publishedRevisionId: revision._id,
			publishedAt,
			publishedBy: publishActor,
			updatedAt: publishedAt,
			updatedBy: publishActor,
		});
		documents.push({
			kind: document.kind,
			documentId: document._id,
			revisionId: revision._id,
		});
	}
	return { status: "published" as const, digest, publishedAt, documents };
}

function validateTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) conflict();
}

function validateActor(value: string) {
	if (!value || value.length > ACTOR_MAX) conflict();
}

function canonicalRestoreEntries(entries: AboutContactPinnedRestoreEntry[]) {
	if (entries.length !== PAGE_KINDS.length) {
		throw new Error("About and Contact pinned restore requires exactly two documents");
	}
	if (
		new Set(entries.map(({ kind }) => kind)).size !== PAGE_KINDS.length
		|| new Set(entries.map(({ documentId }) => documentId)).size !==
			PAGE_KINDS.length
	) {
		throw new Error("About and Contact pinned restore requires one unique document per kind");
	}
	const canonical = PAGE_KINDS.map((kind) =>
		entries.find((entry) => entry.kind === kind),
	);
	if (canonical.some((entry) => entry === undefined)) {
		throw new Error("About and Contact pinned restore manifest is incomplete");
	}
	for (const entry of canonical) {
		if (!entry) conflict();
		if (entry.expected.draftRevisionId === entry.sourceRevisionId) conflict();
		validateTimestamp(entry.expected.publishedAt);
		validateTimestamp(entry.expected.updatedAt);
		validateActor(entry.expected.publishedBy);
		validateActor(entry.expected.updatedBy);
	}
	return canonical as [
		AboutContactPinnedRestoreEntry,
		AboutContactPinnedRestoreEntry,
	];
}

export async function digestAboutContactRestoreRequest(
	siteUrl: string,
	operationId: string,
	entries: AboutContactPinnedRestoreEntry[],
) {
	const canonical = [...entries].sort(
		(left, right) => PAGE_KINDS.indexOf(left.kind) - PAGE_KINDS.indexOf(right.kind),
	);
	return await checksumContentPayload(
		JSON.stringify({
			siteUrl,
			operationId,
			entries: canonical.map(
				({ kind, documentId, sourceRevisionId, expected }) => ({
					kind,
					documentId,
					sourceRevisionId,
					expected: {
						draftRevisionId: expected.draftRevisionId,
						publishedRevisionId: expected.publishedRevisionId,
						publishedAt: expected.publishedAt,
						publishedBy: expected.publishedBy,
						updatedAt: expected.updatedAt,
						updatedBy: expected.updatedBy,
					},
				}),
			),
		}),
	);
}

async function loadRestoreDocuments(
	ctx: MutationCtx,
	siteUrl: string,
	entries: AboutContactPinnedRestoreEntry[],
) {
	await requireTenant(ctx, siteUrl);
	const loaded: LoadedDocument[] = [];
	for (const entry of entries) {
		const [stored, singleton] = await Promise.all([
			ctx.db.get(entry.documentId),
			getContentDocument(ctx, siteUrl, entry.kind),
		]);
		if (!stored || !singleton || singleton._id !== stored._id) {
			throw new Error("About and Contact pinned restore document not found");
		}
		if (stored.siteUrl !== siteUrl || stored.kind !== entry.kind) {
			throw new Error("About and Contact pinned restore ownership mismatch");
		}
		loaded.push({ entry, document: asPageDocument(stored, entry.kind) });
	}
	return loaded;
}

function assertExactCas({
	entry,
	document,
}: LoadedDocument) {
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
	document: PageDocument,
	revisionId: Id<"contentRevisions">,
) {
	const revision = await ctx.db.get(revisionId);
	if (
		!revision
		|| revision.siteUrl !== document.siteUrl
		|| revision.documentId !== document._id
		|| revision.kind !== document.kind
		|| revision.schemaVersion !== 1
	) {
		throw new Error("About and Contact revision ownership mismatch");
	}
	const prepared = preparePayload(document.kind, revision.payload);
	const checksum = await checksumContentPayload(prepared.serialized);
	if (revision.checksum !== checksum) {
		throw new Error("About and Contact revision checksum mismatch");
	}
	if (document.kind === "aboutPage") {
		requireAboutHostShape(prepared.payload as AboutPageDraftPayload);
		const published = toPublishedAboutPage(
			prepared.payload as AboutPageDraftPayload,
		);
		await requireReadyAboutAssets(
			ctx,
			document.siteUrl,
			published.portraits,
		);
	} else {
		requireContactHostShape(prepared.payload as ContactPageDraftPayload);
		toPublishedContactPage(prepared.payload as ContactPageDraftPayload);
	}
	return { revision, prepared };
}

async function exactRestoreReplay(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		digest: string;
		loaded: LoadedDocument[];
	},
) {
	const rows = await ctx.db
		.query("contentRevisions")
		.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
			q
				.eq("siteUrl", args.siteUrl)
				.eq("restoreOperationId", args.operationId),
		)
		.take(PAGE_KINDS.length + 1);
	if (rows.length === 0) return null;
	if (rows.length !== PAGE_KINDS.length) conflict();
	const byDocument = new Map(rows.map((row) => [row.documentId, row]));
	if (byDocument.size !== PAGE_KINDS.length) conflict();
	let restoredAt: number | undefined;
	const documents = [];
	for (const { entry, document } of args.loaded) {
		const row = byDocument.get(document._id);
		if (
			!row
			|| row.kind !== entry.kind
			|| row.source !== "restore"
			|| row.createdBy !== RESTORE_ACTOR
			|| row.restoredFromRevisionId !== entry.sourceRevisionId
			|| row.restoreOperationId !== args.operationId
			|| row.restoreRequestDigest !== args.digest
			|| document.draftRevisionId !== (entry.expected.draftRevisionId ?? undefined)
			|| document.publishedRevisionId !== row._id
			|| document.publishedAt !== row.createdAt
			|| document.publishedBy !== RESTORE_ACTOR
			|| document.updatedAt !== row.createdAt
			|| document.updatedBy !== RESTORE_ACTOR
			|| document.archivedAt !== undefined
			|| document.archivedBy !== undefined
			|| (restoredAt !== undefined && restoredAt !== row.createdAt)
		) conflict();
		const [source, restored] = await Promise.all([
			requirePublishableRevision(ctx, document, entry.sourceRevisionId),
			requirePublishableRevision(ctx, document, row._id),
		]);
		if (
			source.revision.checksum !== row.checksum
			|| restored.prepared.serialized !== source.prepared.serialized
		) conflict();
		restoredAt = row.createdAt;
		documents.push({
			kind: entry.kind,
			documentId: document._id,
			sourceRevisionId: entry.sourceRevisionId,
			restoredRevisionId: row._id,
		});
	}
	if (restoredAt === undefined) conflict();
	return {
		status: "identical-replay" as const,
		operationId: args.operationId,
		restoredAt,
		documents,
	};
}

/** Atomically republish new immutable revisions from one exact pinned pair. */
export async function restorePinnedAboutContactRevisions(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		entries: AboutContactPinnedRestoreEntry[];
	},
) {
	requireRestoreOperationId(args.operationId);
	const entries = canonicalRestoreEntries(args.entries);
	const loaded = await loadRestoreDocuments(ctx, args.siteUrl, entries);
	const digest = await digestAboutContactRestoreRequest(
		args.siteUrl,
		args.operationId,
		entries,
	);
	const replay = await exactRestoreReplay(ctx, {
		siteUrl: args.siteUrl,
		operationId: args.operationId,
		digest,
		loaded,
	});
	if (replay) return replay;

	const prepared = [];
	for (const item of loaded) {
		assertExactCas(item);
		await requirePublishableRevision(
			ctx,
			item.document,
			item.entry.expected.publishedRevisionId,
		);
		prepared.push({
			...item,
			source: await requirePublishableRevision(
				ctx,
				item.document,
				item.entry.sourceRevisionId,
			),
		});
	}
	const latest = entries.reduce(
		(maximum, entry) =>
			Math.max(
				maximum,
				entry.expected.updatedAt,
				entry.expected.publishedAt,
			),
		0,
	);
	const restoredAt = Math.max(Date.now(), latest + 1);
	validateTimestamp(restoredAt);
	if (restoredAt <= latest) conflict();

	const documents = [];
	for (const item of prepared) {
		const restoredRevisionId = await insertSingletonContentRevision(ctx, {
			document: item.document,
			kind: item.entry.kind,
			payload: item.source.prepared.payload,
			checksum: item.source.revision.checksum,
			writer: {
				actor: RESTORE_ACTOR,
				now: restoredAt,
				source: "restore",
				restoredFromRevisionId: item.source.revision._id,
				restoreOperationId: args.operationId,
				restoreRequestDigest: digest,
			},
		});
		await ctx.db.patch(item.document._id, {
			draftRevisionId: item.entry.expected.draftRevisionId ?? undefined,
			publishedRevisionId: restoredRevisionId,
			publishedAt: restoredAt,
			publishedBy: RESTORE_ACTOR,
			updatedAt: restoredAt,
			updatedBy: RESTORE_ACTOR,
		});
		documents.push({
			kind: item.entry.kind,
			documentId: item.document._id,
			sourceRevisionId: item.source.revision._id,
			restoredRevisionId,
		});
	}
	return {
		status: "restored" as const,
		operationId: args.operationId,
		restoredAt,
		documents,
	};
}
