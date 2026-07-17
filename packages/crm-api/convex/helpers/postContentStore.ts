import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import {
	assertExpectedPostDraft,
	asPostRevisionPayload,
	assertPostDocument,
	assertPostRevisionOwnership,
	checksumPostDraft,
	checksumPostSummary,
	listPostDocuments,
	loadPostRevision,
	normalizePostDraftIds,
	requirePostDraftRelations,
	validatePostDocumentKey,
} from "./postContentGraph";
import {
	POST_CONTENT_LIMITS,
	postRevisionPayloadFromDraft,
	requireCanonicalPostSlug,
	toPublishedPostDraft,
	toPublishedPostHeader,
	type PostDraft,
} from "./postContentValidators";
import {
	requireContentSlugAvailable,
	requirePublishedSlugChangeIntent,
	requireValidPublishedSlugChangeRetry,
	retainPreviousPublishedSlug,
} from "./contentSlugHistory";
import {
	archiveContentDocument,
	requireActiveContentDocument,
	restoreContentDocument,
	unpublishContentDocument,
} from "./contentLifecycle";
import type { PublishedSlugChange } from "./contentValidators";

function canonicalDraftSlug(draft: PostDraft) {
	if (draft.slug === undefined || !draft.slug.trim()) return undefined;
	try {
		return requireCanonicalPostSlug(draft.slug);
	} catch {
		return undefined;
	}
}

async function getDocumentByKey(
	ctx: MutationCtx,
	siteUrl: string,
	documentKey: string,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_documentKey", (q) =>
			q
				.eq("siteUrl", siteUrl)
				.eq("kind", "post")
				.eq("documentKey", documentKey),
		)
		.unique();
}

async function insertPostRevision(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	draft: PostDraft,
	checksum: string,
	summaryChecksum: string,
	actor: string,
	now: number,
) {
	const payload = postRevisionPayloadFromDraft(draft, summaryChecksum);
	const revisionId = await ctx.db.insert("contentRevisions", {
		siteUrl: document.siteUrl,
		documentId: document._id,
		kind: "post",
		schemaVersion: 1,
		payload,
		source: "admin",
		checksum,
		createdAt: now,
		createdBy: actor,
	});

	let bodyMediaOrder = 0;
	for (const [order, block] of draft.body.blocks.entries()) {
		if (block.type === "image") {
			await ctx.db.insert("contentBlocks", {
				siteUrl: document.siteUrl,
				documentId: document._id,
				revisionId,
				blockKey: block.key,
				order,
				block: {
					type: "image",
					key: block.key,
					placementKey: block.key,
				},
			});
			await ctx.db.insert("contentMediaPlacements", {
				siteUrl: document.siteUrl,
				documentId: document._id,
				revisionId,
				assetId: block.assetId as Id<"mediaAssets">,
				placementKey: block.key,
				role: "body",
				order: bodyMediaOrder,
				altText: block.altText,
				caption: block.caption,
			});
			bodyMediaOrder += 1;
			continue;
		}
		await ctx.db.insert("contentBlocks", {
			siteUrl: document.siteUrl,
			documentId: document._id,
			revisionId,
			blockKey: block.key,
			order,
			block,
		});
	}
	if (draft.mainImage) {
		await ctx.db.insert("contentMediaPlacements", {
			siteUrl: document.siteUrl,
			documentId: document._id,
			revisionId,
			assetId: draft.mainImage.assetId,
			placementKey: draft.mainImage.key,
			role: "main",
			order: 0,
			altText: draft.mainImage.altText,
			caption: draft.mainImage.caption,
		});
	}
	if (draft.authorDocumentId) {
		await ctx.db.insert("contentReferences", {
			siteUrl: document.siteUrl,
			fromDocumentId: document._id,
			fromRevisionId: revisionId,
			toDocumentId: draft.authorDocumentId,
			field: "author",
			referenceKey: "author",
			order: 0,
		});
	}
	for (const [order, category] of draft.categories.entries()) {
		await ctx.db.insert("contentReferences", {
			siteUrl: document.siteUrl,
			fromDocumentId: document._id,
			fromRevisionId: revisionId,
			toDocumentId: category.documentId,
			field: "category",
			referenceKey: category.key,
			order,
		});
	}
	for (const [field, items] of [
		["equipment", draft.equipment],
		["material", draft.materials],
	] as const) {
		for (const [order, item] of items.entries()) {
			await ctx.db.insert("contentPostTechnicalItems", {
				siteUrl: document.siteUrl,
				documentId: document._id,
				revisionId,
				field,
				itemKey: item.key,
				order,
				label: item.label,
				details: item.details,
			});
		}
	}
	return revisionId;
}

async function requireExactCurrentRevision(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	revisionId: Id<"contentRevisions"> | undefined,
	checksum: string,
) {
	if (!revisionId) return null;
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Post revision not found");
	assertPostRevisionOwnership(revision, document);
	if (revision.checksum !== checksum) return null;
	const loaded = await loadPostRevision(ctx, document, revisionId);
	if (!loaded) throw new Error("Post revision not found");
	return loaded;
}

async function requireCurrentPublishedPostSlug(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
) {
	if (!document.publishedRevisionId) return;
	const revision = await ctx.db.get(document.publishedRevisionId);
	if (!revision) throw new Error("Published Post revision not found");
	assertPostRevisionOwnership(revision, document);
	const published = toPublishedPostHeader(asPostRevisionPayload(revision.payload));
	if (published.slug !== document.slug) throw new Error("Published Post slug mismatch");
}

export async function createPostDraft(
	ctx: MutationCtx,
	args: { siteUrl: string; documentKey: string; draft: PostDraft },
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	validatePostDocumentKey(args.documentKey);
	const draft = normalizePostDraftIds(ctx, args.draft);
	const checksum = await checksumPostDraft(draft);
	const summaryChecksum = await checksumPostSummary(draft);
	const existing = await getDocumentByKey(ctx, client.siteUrl, args.documentKey);
	if (existing) {
		const document = assertPostDocument(existing);
		const current = await requireExactCurrentRevision(
			ctx,
			document,
			document.draftRevisionId,
			checksum,
		);
		if (current) return { documentId: document._id, revisionId: current.revision._id };
		throw new Error("Post document key already exists");
	}
	const documents = await listPostDocuments(ctx, client.siteUrl);
	if (documents.length >= POST_CONTENT_LIMITS.documents) {
		throw new Error(
			`A site cannot exceed ${POST_CONTENT_LIMITS.documents} Post documents`,
		);
	}
	const slug = canonicalDraftSlug(draft);
	await requireContentSlugAvailable(ctx, {
		siteUrl: client.siteUrl,
		kind: "post",
		slug,
	});
	await requirePostDraftRelations(ctx, client.siteUrl, draft, false);

	const now = Date.now();
	const actor = identity.tokenIdentifier;
	const documentId = await ctx.db.insert("contentDocuments", {
		siteUrl: client.siteUrl,
		kind: "post",
		documentKey: args.documentKey,
		slug,
		rank:
			documents.reduce(
				(maximum, document) => Math.max(maximum, document.rank),
				-1,
			) + 1,
		createdAt: now,
		createdBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	const document = await ctx.db.get(documentId);
	if (!document) throw new Error("Post document creation failed");
	const revisionId = await insertPostRevision(
		ctx,
		document,
		draft,
		checksum,
		summaryChecksum,
		actor,
		now,
	);
	await ctx.db.patch(documentId, { draftRevisionId: revisionId });
	return { documentId, revisionId };
}

export async function savePostDraft(
	ctx: MutationCtx,
	args: {
		documentId: Id<"contentDocuments">;
		expectedDraftRevisionId?: Id<"contentRevisions">;
		draft: PostDraft;
	},
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		args.documentId,
	);
	const document = assertPostDocument(stored);
	requireActiveContentDocument(document, "Post document");
	const draft = normalizePostDraftIds(ctx, args.draft);
	const checksum = await checksumPostDraft(draft);
	const summaryChecksum = await checksumPostSummary(draft);
	const current = await requireExactCurrentRevision(
		ctx,
		document,
		document.draftRevisionId,
		checksum,
	);
	if (current) return { documentId: document._id, revisionId: current.revision._id };
	assertExpectedPostDraft(document, args.expectedDraftRevisionId);

	const slug = canonicalDraftSlug(draft);
	await requireContentSlugAvailable(ctx, {
		siteUrl: document.siteUrl,
		kind: "post",
		slug,
		documentId: document._id,
	});
	await requirePostDraftRelations(ctx, document.siteUrl, draft, false);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const now = Date.now();
	const revisionId = await insertPostRevision(
		ctx,
		document,
		draft,
		checksum,
		summaryChecksum,
		identity.tokenIdentifier,
		now,
	);
	await ctx.db.patch(document._id, {
		...(document.publishedRevisionId ? {} : { slug }),
		draftRevisionId: revisionId,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
	});
	return { documentId: document._id, revisionId };
}

export async function publishPostDraft(
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
	const document = assertPostDocument(stored);
	requireActiveContentDocument(document, "Post document");
	if (
		document.publishedRevisionId === args.draftRevisionId
		&& document.draftRevisionId === undefined
	) {
		const retry = await loadPostRevision(ctx, document, args.draftRevisionId);
		if (!retry) throw new Error("Published Post revision not found");
		const published = toPublishedPostDraft(retry.draft);
		if (published.slug !== document.slug) throw new Error("Published Post slug mismatch");
		await requireValidPublishedSlugChangeRetry(ctx, {
			document,
			kind: "post",
			intent: args.publishedSlugChange,
		});
		await requireContentSlugAvailable(ctx, {
			siteUrl: document.siteUrl,
			kind: "post",
			slug: published.slug,
			documentId: document._id,
		});
		await requirePostDraftRelations(ctx, document.siteUrl, published, true);
		return { documentId: document._id, revisionId: retry.revision._id };
	}
	assertExpectedPostDraft(document, args.draftRevisionId);
	const loaded = await loadPostRevision(ctx, document, args.draftRevisionId);
	if (!loaded) throw new Error("Post draft revision not found");
	const published = toPublishedPostDraft(loaded.draft);
	await requireCurrentPublishedPostSlug(ctx, document);
	requirePublishedSlugChangeIntent({
		document,
		nextSlug: published.slug,
		intent: args.publishedSlugChange,
	});
	await requireContentSlugAvailable(ctx, {
		siteUrl: document.siteUrl,
		kind: "post",
		slug: published.slug,
		documentId: document._id,
	});
	await requirePostDraftRelations(ctx, document.siteUrl, published, true);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const now = Date.now();
	await retainPreviousPublishedSlug(ctx, {
		document,
		kind: "post",
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

export async function discardPostDraft(
	ctx: MutationCtx,
	args: { documentId: Id<"contentDocuments">; draftRevisionId: Id<"contentRevisions"> },
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		args.documentId,
	);
	const document = assertPostDocument(stored);
	requireActiveContentDocument(document, "Post document");
	if (!document.draftRevisionId) {
		const discarded = await loadPostRevision(ctx, document, args.draftRevisionId);
		if (!discarded) throw new Error("Post draft revision not found");
		return null;
	}
	assertExpectedPostDraft(document, args.draftRevisionId);
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

export async function unpublishPostDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertPostDocument(stored);
	return await unpublishContentDocument(ctx, document, "Post document");
}

export async function archivePostDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertPostDocument(stored);
	return await archiveContentDocument(ctx, document);
}

export async function restorePostDocument(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertPostDocument(stored);
	return await restoreContentDocument(ctx, document);
}
