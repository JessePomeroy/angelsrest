import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
	assertBlogDocument,
	BLOG_SUPPORTING_DOCUMENT_MAX,
	checksumBlogDraft,
	loadBlogRevision,
	requireReadyAuthorPortrait,
} from "./blogContentData";
import { insertBlogRevision } from "./blogContentStore";
import {
	blogContentChecksumInput,
	toPublishedBlogSupportingContent,
} from "./blogContentValidators";
import {
	requireContentSlugAvailable,
	retainPreviousPublishedSlug,
} from "./contentSlugHistory";
import { requireActiveContentDocument } from "./contentLifecycle";
import { requireRestoreOperationId } from "./contentRevisionProvenance";
import {
	assertPostDocument,
	checksumPostSummary,
	loadPostRevision,
	requirePostDraftRelations,
} from "./postContentGraph";
import { insertPostRevision } from "./postContentStore";
import {
	POST_CONTENT_LIMITS,
	toPublishedPostDraft,
} from "./postContentValidators";

const nullableRevisionValidator = v.union(v.id("contentRevisions"), v.null());
const nullableArchiveValidator = v.union(
	v.object({ at: v.number(), by: v.string() }),
	v.null(),
);

export const blogPinnedRestoreEntryValidator = v.object({
	documentId: v.id("contentDocuments"),
	sourceRevisionId: v.id("contentRevisions"),
	expected: v.object({
		slug: v.string(),
		draftRevisionId: nullableRevisionValidator,
		published: v.object({
			revisionId: v.id("contentRevisions"),
			at: v.number(),
			by: v.string(),
		}),
		archived: nullableArchiveValidator,
		updated: v.object({ at: v.number(), by: v.string() }),
	}),
});

export type BlogPinnedRestoreEntry = Infer<
	typeof blogPinnedRestoreEntryValidator
>;

export const BLOG_PINNED_RESTORE_MAX =
	BLOG_SUPPORTING_DOCUMENT_MAX * 2 + POST_CONTENT_LIMITS.documents;
const ACTOR_MAX = 2_048;
const RESTORE_CONFLICT =
	"Blog pinned restore conflict: reload and rebuild the exact restore request";
const RESTORE_OPERATOR_ACTOR = "operator:blog-pinned-restore";

type RestorableDocument = ReturnType<
	typeof assertBlogDocument | typeof assertPostDocument
>;

type PreparedSupportingRestore = {
	entry: BlogPinnedRestoreEntry;
	document: ReturnType<typeof assertBlogDocument>;
	source: NonNullable<Awaited<ReturnType<typeof loadBlogRevision>>>;
	nextSlug: string;
};

type PreparedPostRestore = {
	entry: BlogPinnedRestoreEntry;
	document: ReturnType<typeof assertPostDocument>;
	source: NonNullable<Awaited<ReturnType<typeof loadPostRevision>>>;
	nextSlug: string;
};

function conflict(): never {
	throw new Error(RESTORE_CONFLICT);
}

function validateSafeTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) conflict();
}

function validateActor(value: string) {
	if (!value || value.length > ACTOR_MAX) conflict();
}

function validateRestoreRequest(
	operationId: string,
	entries: BlogPinnedRestoreEntry[],
) {
	requireRestoreOperationId(operationId);
	if (entries.length === 0 || entries.length > BLOG_PINNED_RESTORE_MAX) {
		throw new Error(
			`A Blog pinned restore must contain 1 to ${BLOG_PINNED_RESTORE_MAX} documents`,
		);
	}
	if (new Set(entries.map(({ documentId }) => documentId)).size !== entries.length) {
		throw new Error("Blog pinned restore document IDs must be unique");
	}
	for (const { expected } of entries) {
		validateSafeTimestamp(expected.published.at);
		validateSafeTimestamp(expected.updated.at);
		validateActor(expected.published.by);
		validateActor(expected.updated.by);
		if (expected.archived) {
			validateSafeTimestamp(expected.archived.at);
			validateActor(expected.archived.by);
		}
	}
}

async function requestDigest(
	siteUrl: string,
	operationId: string,
	entries: BlogPinnedRestoreEntry[],
) {
	const serialized = JSON.stringify({
		siteUrl,
		operationId,
		entries: entries.map(({ documentId, sourceRevisionId, expected }) => ({
			documentId,
			sourceRevisionId,
			expected: {
				slug: expected.slug,
				draftRevisionId: expected.draftRevisionId,
				published: expected.published,
				archived: expected.archived,
				updated: expected.updated,
			},
		})),
	});
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function assertExactCas(
	document: Doc<"contentDocuments">,
	entry: BlogPinnedRestoreEntry,
) {
	const { expected } = entry;
	const archivedMatches = expected.archived
		? document.archivedAt === expected.archived.at
			&& document.archivedBy === expected.archived.by
		: document.archivedAt === undefined && document.archivedBy === undefined;
	if (
		document.slug !== expected.slug
		|| document.draftRevisionId !== (expected.draftRevisionId ?? undefined)
		|| document.publishedRevisionId !== expected.published.revisionId
		|| document.publishedAt !== expected.published.at
		|| document.publishedBy !== expected.published.by
		|| !archivedMatches
		|| document.updatedAt !== expected.updated.at
		|| document.updatedBy !== expected.updated.by
	) conflict();
}

async function requireVerifiedBlogRevision(
	ctx: MutationCtx,
	document: ReturnType<typeof assertBlogDocument>,
	revisionId: Id<"contentRevisions">,
) {
	const loaded = await loadBlogRevision(ctx, document, revisionId);
	if (!loaded) throw new Error("Blog supporting revision not found");
	const checksum = await checksumBlogDraft(
		blogContentChecksumInput(loaded.draft),
	);
	if (loaded.revision.checksum !== checksum) {
		throw new Error("Blog supporting revision checksum mismatch");
	}
	return loaded;
}

async function requireCurrentPublicationIntegrity(
	ctx: MutationCtx,
	document: RestorableDocument,
) {
	if (!document.publishedRevisionId) conflict();
	if (document.kind === "post") {
		const loaded = await loadPostRevision(
			ctx,
			document,
			document.publishedRevisionId,
		);
		if (!loaded) throw new Error("Published Post revision not found");
		const published = toPublishedPostDraft(loaded.draft);
		if (published.slug !== document.slug) {
			throw new Error("Published Post slug mismatch");
		}
		const { targets } = await requirePostDraftRelations(
			ctx,
			document.siteUrl,
			published,
			true,
		);
		if (targets.some((target) => target.archivedAt !== undefined)) {
			throw new Error("Published Post references an archived supporting document");
		}
		return;
	}
	const loaded = await requireVerifiedBlogRevision(
		ctx,
		document,
		document.publishedRevisionId,
	);
	const published = toPublishedBlogSupportingContent(loaded.draft);
	if (published.slug !== document.slug) {
		throw new Error("Published Blog supporting slug mismatch");
	}
	await requireReadyAuthorPortrait(ctx, document.siteUrl, loaded.draft);
}

async function loadOperatorDocuments(
	ctx: MutationCtx,
	siteUrl: string,
	entries: BlogPinnedRestoreEntry[],
) {
	const documents = [] as Array<{
		entry: BlogPinnedRestoreEntry;
		document: RestorableDocument;
	}>;
	const client = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!client) throw new Error("Blog pinned restore site is not registered");
	for (const entry of entries) {
		const stored = await ctx.db.get(entry.documentId);
		if (!stored) throw new Error("Blog pinned restore document not found");
		if (stored.siteUrl !== siteUrl) {
			throw new Error("Blog pinned restore documents must belong to the pinned site");
		}
		const document = stored.kind === "post"
			? assertPostDocument(stored)
			: assertBlogDocument(stored);
		documents.push({ entry, document });
	}
	return documents;
}

async function loadCompletePublishedModuleInventory(
	ctx: MutationCtx,
	siteUrl: string,
) {
	const [authors, categories, posts] = await Promise.all([
		ctx.db
			.query("contentDocuments")
			.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
				q.eq("siteUrl", siteUrl).eq("kind", "author"),
			)
			.take(BLOG_SUPPORTING_DOCUMENT_MAX + 1),
		ctx.db
			.query("contentDocuments")
			.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
				q.eq("siteUrl", siteUrl).eq("kind", "category"),
			)
			.take(BLOG_SUPPORTING_DOCUMENT_MAX + 1),
		ctx.db
			.query("contentDocuments")
			.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
				q.eq("siteUrl", siteUrl).eq("kind", "post"),
			)
			.take(POST_CONTENT_LIMITS.documents + 1),
	]);
	if (
		authors.length > BLOG_SUPPORTING_DOCUMENT_MAX
		|| categories.length > BLOG_SUPPORTING_DOCUMENT_MAX
		|| posts.length > POST_CONTENT_LIMITS.documents
	) {
		throw new Error("Published Blog module inventory exceeds its domain bounds");
	}
	return [
		...authors.map((document) => assertBlogDocument(document, "author")),
		...categories.map((document) => assertBlogDocument(document, "category")),
		...posts.map(assertPostDocument),
	].filter(
		(document) =>
			document.archivedAt === undefined
			&& document.publishedRevisionId !== undefined,
	);
}

async function requireCompletePublishedModuleManifest(
	ctx: MutationCtx,
	siteUrl: string,
	entries: BlogPinnedRestoreEntry[],
) {
	const inventory = await loadCompletePublishedModuleInventory(ctx, siteUrl);
	const manifestIds = new Set(entries.map(({ documentId }) => documentId));
	if (
		inventory.length !== entries.length
		|| inventory.some((document) => !manifestIds.has(document._id))
	) {
		throw new Error(
			"Blog pinned restore manifest must exactly match the complete published module",
		);
	}
	return manifestIds;
}

async function exactReplayResult(
	ctx: MutationCtx,
	args: {
		operationId: string;
		digest: string;
		entries: BlogPinnedRestoreEntry[];
		documents: RestorableDocument[];
		siteUrl: string;
	},
) {
	const rows = await ctx.db
		.query("contentRevisions")
		.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
			q
				.eq("siteUrl", args.siteUrl)
				.eq("restoreOperationId", args.operationId),
		)
		.take(BLOG_PINNED_RESTORE_MAX + 1);
	if (rows.length === 0) return null;
	if (rows.length !== args.entries.length) conflict();
	const byDocument = new Map(rows.map((row) => [row.documentId, row]));
	if (byDocument.size !== rows.length) conflict();
	let restoredAt: number | undefined;
	for (const [index, entry] of args.entries.entries()) {
		const document = args.documents[index];
		const row = byDocument.get(entry.documentId);
		if (
			!document
			|| !row
			|| row.kind !== document.kind
			|| row.source !== "restore"
			|| row.createdBy !== RESTORE_OPERATOR_ACTOR
			|| row.restoredFromRevisionId !== entry.sourceRevisionId
			|| row.restoreOperationId !== args.operationId
			|| row.restoreRequestDigest !== args.digest
			|| document.publishedRevisionId !== row._id
			|| document.draftRevisionId !== undefined
			|| document.archivedAt !== undefined
			|| document.archivedBy !== undefined
			|| document.publishedAt !== row.createdAt
			|| document.publishedBy !== row.createdBy
			|| document.updatedAt !== row.createdAt
			|| document.updatedBy !== row.createdBy
			|| (restoredAt !== undefined && restoredAt !== row.createdAt)
		) conflict();
		restoredAt = row.createdAt;
		const source = document.kind === "post"
			? await loadPostRevision(ctx, document, entry.sourceRevisionId)
			: await requireVerifiedBlogRevision(
				ctx,
				document,
				entry.sourceRevisionId,
			);
		if (!source || source.revision.checksum !== row.checksum) conflict();
		await requireCurrentPublicationIntegrity(ctx, document);
	}
	if (restoredAt === undefined) conflict();
	return {
		operationId: args.operationId,
		restoredAt,
		documents: args.entries.map((entry) => {
			const restored = byDocument.get(entry.documentId);
			if (!restored) return conflict();
			return {
				documentId: entry.documentId,
				sourceRevisionId: entry.sourceRevisionId,
				restoredRevisionId: restored._id,
			};
		}),
	};
}

async function prepareRestoreSources(
	ctx: MutationCtx,
	authorized: Array<{
		entry: BlogPinnedRestoreEntry;
		document: RestorableDocument;
	}>,
	manifestIds: ReadonlySet<Id<"contentDocuments">>,
) {
	const supporting: PreparedSupportingRestore[] = [];
	const posts: PreparedPostRestore[] = [];
	for (const { entry, document } of authorized) {
		assertExactCas(document, entry);
		requireActiveContentDocument(document, "Blog restore document");
		await requireCurrentPublicationIntegrity(ctx, document);
		if (document.kind === "post") {
			const source = await loadPostRevision(
				ctx,
				document,
				entry.sourceRevisionId,
			);
			if (!source) throw new Error("Pinned Post source revision not found");
			const published = toPublishedPostDraft(source.draft);
			const relationIds = [
				published.authorDocumentId,
				...published.categories.map(({ documentId }) => documentId),
			];
			if (relationIds.some((documentId) => !manifestIds.has(documentId))) {
				throw new Error(
					"Blog pinned restore manifest is not closed over Post relationships",
				);
			}
			const { targets } = await requirePostDraftRelations(
				ctx,
				document.siteUrl,
				published,
				false,
			);
			if (targets.some((target) => target.archivedAt !== undefined)) {
				throw new Error("Pinned Post source references an archived supporting document");
			}
			await requireContentSlugAvailable(ctx, {
				siteUrl: document.siteUrl,
				kind: "post",
				slug: published.slug,
				documentId: document._id,
			});
			posts.push({ entry, document, source, nextSlug: published.slug });
			continue;
		}
		const source = await requireVerifiedBlogRevision(
			ctx,
			document,
			entry.sourceRevisionId,
		);
		const published = toPublishedBlogSupportingContent(source.draft);
		await requireReadyAuthorPortrait(ctx, document.siteUrl, source.draft);
		await requireContentSlugAvailable(ctx, {
			siteUrl: document.siteUrl,
			kind: document.kind,
			slug: published.slug,
			documentId: document._id,
		});
		supporting.push({ entry, document, source, nextSlug: published.slug });
	}
	return { supporting, posts };
}

function requireUniquePreparedSlugs(prepared: {
	supporting: PreparedSupportingRestore[];
	posts: PreparedPostRestore[];
}) {
	const keys = [
		...prepared.supporting.map(({ document, nextSlug }) => `${document.kind}:${nextSlug}`),
		...prepared.posts.map(({ nextSlug }) => `post:${nextSlug}`),
	];
	if (new Set(keys).size !== keys.length) {
		throw new Error("Blog pinned restore final slugs must be unique within each content kind");
	}
}

function nextRestoreTimestamp(documents: RestorableDocument[]) {
	const latest = documents.reduce(
		(maximum, document) => Math.max(maximum, document.updatedAt),
		0,
	);
	const timestamp = Math.max(Date.now(), latest + 1);
	validateSafeTimestamp(timestamp);
	if (timestamp <= latest) conflict();
	return timestamp;
}

/**
 * Atomically republish a pinned Blog module snapshot by cloning every source
 * revision. Historical revisions are never repointed or modified.
 */
export async function restorePinnedBlogRevisions(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		entries: BlogPinnedRestoreEntry[];
	},
) {
	validateRestoreRequest(args.operationId, args.entries);
	const authorized = await loadOperatorDocuments(
		ctx,
		args.siteUrl,
		args.entries,
	);
	const manifestIds = await requireCompletePublishedModuleManifest(
		ctx,
		args.siteUrl,
		args.entries,
	);
	const digest = await requestDigest(
		args.siteUrl,
		args.operationId,
		args.entries,
	);
	const documents = authorized.map(({ document }) => document);
	const replay = await exactReplayResult(ctx, {
		operationId: args.operationId,
		digest,
		entries: args.entries,
		documents,
		siteUrl: args.siteUrl,
	});
	if (replay) return replay;

	const prepared = await prepareRestoreSources(ctx, authorized, manifestIds);
	requireUniquePreparedSlugs(prepared);
	const restoredAt = nextRestoreTimestamp(documents);
	const actor = RESTORE_OPERATOR_ACTOR;
	const restoredByDocument = new Map<
		Id<"contentDocuments">,
		Id<"contentRevisions">
	>();
	const writer = {
		actor,
		source: "restore" as const,
		now: restoredAt,
		restoreOperationId: args.operationId,
		restoreRequestDigest: digest,
	};

	for (const item of prepared.supporting) {
		await retainPreviousPublishedSlug(ctx, {
			document: item.document,
			kind: item.document.kind,
			nextSlug: item.nextSlug,
			actor,
			now: restoredAt,
		});
		const restoredRevisionId = await insertBlogRevision(
			ctx,
			item.document,
			item.source.draft,
			item.source.revision.checksum,
			{
				...writer,
				restoredFromRevisionId: item.source.revision._id,
			},
		);
		await ctx.db.patch(item.document._id, {
			slug: item.nextSlug,
			draftRevisionId: undefined,
			publishedRevisionId: restoredRevisionId,
			publishedAt: restoredAt,
			publishedBy: actor,
			updatedAt: restoredAt,
			updatedBy: actor,
		});
		restoredByDocument.set(item.document._id, restoredRevisionId);
	}

	for (const item of prepared.posts) {
		const published = toPublishedPostDraft(item.source.draft);
		const { targets } = await requirePostDraftRelations(
			ctx,
			item.document.siteUrl,
			published,
			true,
		);
		if (targets.some((target) => target.archivedAt !== undefined)) {
			throw new Error("Pinned Post source references an archived supporting document");
		}
		await retainPreviousPublishedSlug(ctx, {
			document: item.document,
			kind: "post",
			nextSlug: item.nextSlug,
			actor,
			now: restoredAt,
		});
		const restoredRevisionId = await insertPostRevision(
			ctx,
			item.document,
			item.source.draft,
			item.source.revision.checksum,
			await checksumPostSummary(item.source.draft),
			{
				...writer,
				restoredFromRevisionId: item.source.revision._id,
			},
		);
		await ctx.db.patch(item.document._id, {
			slug: item.nextSlug,
			draftRevisionId: undefined,
			publishedRevisionId: restoredRevisionId,
			publishedAt: restoredAt,
			publishedBy: actor,
			updatedAt: restoredAt,
			updatedBy: actor,
		});
		restoredByDocument.set(item.document._id, restoredRevisionId);
	}

	return {
		operationId: args.operationId,
		restoredAt,
		documents: args.entries.map((entry) => {
			const restoredRevisionId = restoredByDocument.get(entry.documentId);
			if (!restoredRevisionId) return conflict();
			return {
				documentId: entry.documentId,
				sourceRevisionId: entry.sourceRevisionId,
				restoredRevisionId,
			};
		}),
	};
}
