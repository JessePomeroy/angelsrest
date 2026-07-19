import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import {
	BLOG_CONTENT_LIMITS,
	blogContentChecksumInput,
	type BlogSupportingDraft,
	type BlogSupportingKind,
	requireCanonicalBlogSlug,
	toPublishedBlogSupportingContent,
	validateBlogSupportingDraft,
} from "./blogContentValidators";
import {
	assertBlogDocument,
	assertExpectedBlogDraft,
	BLOG_SUPPORTING_DOCUMENT_MAX,
	checksumBlogDraft,
	listBlogDocuments,
	loadBlogRevision,
	requireReadyAuthorPortrait,
	validateBlogDocumentKey,
} from "./blogContentData";
import {
	requireContentSlugAvailable,
	requirePublishedSlugChangeIntent,
	requireValidPublishedSlugChangeRetry,
	retainPreviousPublishedSlug,
} from "./contentSlugHistory";
import {
	archiveContentDocument,
	requireActiveContentDocument,
	requireNoActivePostReferences,
	restoreContentDocument,
	unpublishContentDocument,
} from "./contentLifecycle";
import type { PublishedSlugChange } from "./contentValidators";

export type BlogDraftWriter = {
	actor: string;
	source: "admin" | "sanityImport";
	now: number;
};

function canonicalDraftSlug(draft: BlogSupportingDraft) {
	if (draft.slug === undefined || !draft.slug.trim()) return undefined;
	try {
		return requireCanonicalBlogSlug(
			draft.slug,
			draft.kind === "author" ? "Author slug" : "Category slug",
			draft.kind === "author"
				? BLOG_CONTENT_LIMITS.authorSlug
				: BLOG_CONTENT_LIMITS.categorySlug,
		);
	} catch {
		return undefined;
	}
}

async function getDocumentByKey(
	ctx: MutationCtx,
	siteUrl: string,
	kind: BlogSupportingKind,
	documentKey: string,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_documentKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind).eq("documentKey", documentKey),
		)
		.unique();
}

async function insertRevision(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	draft: BlogSupportingDraft,
	checksum: string,
	writer: BlogDraftWriter,
) {
	return await ctx.db.insert("contentRevisions", {
		siteUrl: document.siteUrl,
		documentId: document._id,
		kind: draft.kind,
		schemaVersion: 1,
		payload: draft,
		source: writer.source,
		checksum,
		createdAt: writer.now,
		createdBy: writer.actor,
	});
}

async function requireCurrentPublishedBlogSlug(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
) {
	if (!document.publishedRevisionId) return;
	const loaded = await loadBlogRevision(
		ctx,
		document,
		document.publishedRevisionId,
	);
	if (!loaded) throw new Error("Published Blog supporting revision not found");
	const published = toPublishedBlogSupportingContent(loaded.draft);
	if (published.slug !== document.slug) {
		throw new Error("Published Blog supporting slug mismatch");
	}
}

export async function createBlogDraftForSite(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		documentKey: string;
		draft: BlogSupportingDraft;
		writer: BlogDraftWriter;
	},
) {
	validateBlogDocumentKey(args.documentKey);
	validateBlogSupportingDraft(args.draft);
	const checksum = await checksumBlogDraft(blogContentChecksumInput(args.draft));
	const existing = await getDocumentByKey(
		ctx,
		args.siteUrl,
		args.draft.kind,
		args.documentKey,
	);
	if (existing) {
		const document = assertBlogDocument(existing, args.draft.kind);
		const currentDraft = await loadBlogRevision(ctx, document, document.draftRevisionId);
		if (
			currentDraft?.revision.checksum === checksum &&
			currentDraft.revision.source === args.writer.source
		) {
			return {
				documentId: document._id,
				revisionId: currentDraft.revision._id,
				created: false,
			};
		}
		throw new Error("Blog document key already exists");
	}

	const documents = await listBlogDocuments(ctx, args.siteUrl, args.draft.kind);
	if (documents.length >= BLOG_SUPPORTING_DOCUMENT_MAX) {
		throw new Error(
			`A site cannot exceed ${BLOG_SUPPORTING_DOCUMENT_MAX} ${args.draft.kind} documents`,
		);
	}
	const slug = canonicalDraftSlug(args.draft);
	await requireContentSlugAvailable(ctx, {
		siteUrl: args.siteUrl,
		kind: args.draft.kind,
		slug,
	});
	await requireReadyAuthorPortrait(ctx, args.siteUrl, args.draft);

	const { actor, now } = args.writer;
	const documentId = await ctx.db.insert("contentDocuments", {
		siteUrl: args.siteUrl,
		kind: args.draft.kind,
		documentKey: args.documentKey,
		slug,
		rank: documents.reduce(
			(maximum, document) => Math.max(maximum, document.rank),
			-1,
		) + 1,
		createdAt: now,
		createdBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	const document = await ctx.db.get(documentId);
	if (!document) throw new Error("Blog supporting document creation failed");
	const revisionId = await insertRevision(
		ctx,
		document,
		args.draft,
		checksum,
		args.writer,
	);
	await ctx.db.patch(documentId, { draftRevisionId: revisionId });
	return { documentId, revisionId, created: true };
}

export async function createBlogDraft(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		documentKey: string;
		draft: BlogSupportingDraft;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	const { documentId, revisionId } = await createBlogDraftForSite(ctx, {
		siteUrl: client.siteUrl,
		documentKey: args.documentKey,
		draft: args.draft,
		writer: {
			actor: identity.tokenIdentifier,
			source: "admin",
			now: Date.now(),
		},
	});
	return { documentId, revisionId };
}

export async function saveBlogDraft(
	ctx: MutationCtx,
	args: {
		documentId: Id<"contentDocuments">;
		expectedDraftRevisionId?: Id<"contentRevisions">;
		draft: BlogSupportingDraft;
	},
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		args.documentId,
	);
	const document = assertBlogDocument(stored, args.draft.kind);
	requireActiveContentDocument(document, "Blog supporting document");
	validateBlogSupportingDraft(args.draft);
	const checksum = await checksumBlogDraft(blogContentChecksumInput(args.draft));
	const currentDraft = await loadBlogRevision(ctx, document, document.draftRevisionId);
	if (currentDraft?.revision.checksum === checksum) {
		return { documentId: document._id, revisionId: currentDraft.revision._id };
	}
	assertExpectedBlogDraft(document, args.expectedDraftRevisionId);

	const slug = canonicalDraftSlug(args.draft);
	await requireContentSlugAvailable(ctx, {
		siteUrl: document.siteUrl,
		kind: document.kind,
		slug,
		documentId: document._id,
	});
	await requireReadyAuthorPortrait(ctx, document.siteUrl, args.draft);

	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const now = Date.now();
	const revisionId = await insertRevision(
		ctx,
		document,
		args.draft,
		checksum,
		{
			actor: identity.tokenIdentifier,
			source: "admin",
			now,
		},
	);
	await ctx.db.patch(document._id, {
		...(document.publishedRevisionId ? {} : { slug }),
		draftRevisionId: revisionId,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
	});
	return { documentId: document._id, revisionId };
}

export async function publishBlogDraft(
	ctx: MutationCtx,
	args: {
		documentId: Id<"contentDocuments">;
		draftRevisionId: Id<"contentRevisions">;
		publishedSlugChange?: PublishedSlugChange;
	},
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		args.documentId,
	);
	const document = assertBlogDocument(stored);
	requireActiveContentDocument(document, "Blog supporting document");
	if (
		document.publishedRevisionId === args.draftRevisionId
		&& document.draftRevisionId === undefined
	) {
		const publishedRetry = await loadBlogRevision(
			ctx,
			document,
			args.draftRevisionId,
		);
		if (!publishedRetry) {
			throw new Error("Published Blog supporting revision not found");
		}
		const published = toPublishedBlogSupportingContent(publishedRetry.draft);
		if (published.slug !== document.slug) {
			throw new Error("Published Blog supporting slug mismatch");
		}
		await requireValidPublishedSlugChangeRetry(ctx, {
			document,
			kind: document.kind,
			intent: args.publishedSlugChange,
		});
		await requireContentSlugAvailable(ctx, {
			siteUrl: document.siteUrl,
			kind: document.kind,
			slug: published.slug,
			documentId: document._id,
		});
		await requireReadyAuthorPortrait(
			ctx,
			document.siteUrl,
			publishedRetry.draft,
		);
		return { documentId: document._id, revisionId: args.draftRevisionId };
	}
	assertExpectedBlogDraft(document, args.draftRevisionId);
	const loaded = await loadBlogRevision(ctx, document, args.draftRevisionId);
	if (!loaded) throw new Error("Blog draft revision not found");
	const published = toPublishedBlogSupportingContent(loaded.draft);
	await requireCurrentPublishedBlogSlug(ctx, document);
	requirePublishedSlugChangeIntent({
		document,
		nextSlug: published.slug,
		intent: args.publishedSlugChange,
	});
	await requireContentSlugAvailable(ctx, {
		siteUrl: document.siteUrl,
		kind: document.kind,
		slug: published.slug,
		documentId: document._id,
	});
	await requireReadyAuthorPortrait(ctx, document.siteUrl, loaded.draft);

	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const now = Date.now();
	await retainPreviousPublishedSlug(ctx, {
		document,
		kind: document.kind,
		nextSlug: published.slug,
		actor: identity.tokenIdentifier,
		now,
	});
	await ctx.db.patch(document._id, {
		slug: published.slug,
		publishedRevisionId: loaded.revision._id,
		draftRevisionId: undefined,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
		publishedAt: now,
		publishedBy: identity.tokenIdentifier,
	});
	return { documentId: document._id, revisionId: loaded.revision._id };
}

export async function discardBlogDraft(
	ctx: MutationCtx,
	args: {
		documentId: Id<"contentDocuments">;
		draftRevisionId: Id<"contentRevisions">;
	},
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		args.documentId,
	);
	const document = assertBlogDocument(stored);
	requireActiveContentDocument(document, "Blog supporting document");
	if (!document.draftRevisionId) {
		const discarded = await loadBlogRevision(ctx, document, args.draftRevisionId);
		if (!discarded) throw new Error("Blog draft revision not found");
		return null;
	}
	assertExpectedBlogDraft(document, args.draftRevisionId);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	await ctx.db.patch(document._id, {
		draftRevisionId: undefined,
		...(document.publishedRevisionId ? {} : { slug: undefined }),
		updatedAt: Date.now(),
		updatedBy: identity.tokenIdentifier,
	});
	return null;
}

export async function unpublishBlogDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertBlogDocument(stored);
	await requireNoActivePostReferences(ctx, document, {
		publishedOnly: true,
		label: "Blog supporting document",
	});
	return await unpublishContentDocument(ctx, document, "Blog supporting document");
}

export async function archiveBlogDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertBlogDocument(stored);
	await requireNoActivePostReferences(ctx, document, {
		publishedOnly: false,
		label: "Blog supporting document",
	});
	return await archiveContentDocument(ctx, document);
}

export async function restoreBlogDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertBlogDocument(stored);
	return await restoreContentDocument(ctx, document);
}
