import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	assertBlogDocument,
	loadBlogRevision,
	requireReadyAuthorPortrait,
} from "./blogContentData";
import { toPublishedBlogSupportingContent } from "./blogContentValidators";
import type { ContentRevisionPayload } from "./contentValidators";
import {
	postChecksumInput,
	postSummaryChecksumInput,
	postSummaryIntegrityFromDraft,
	type PostSummaryIntegrityInput,
} from "./postContentIntegrity";
import {
	POST_CONTENT_LIMITS,
	postRevisionPayloadFromDraft,
	serializePostRevisionPayload,
	type PostDraft,
	type PostRevisionPayload,
	validatePostDraft,
	validatePostRevisionPayload,
} from "./postContentValidators";

type PostCtx = QueryCtx | MutationCtx;

const DOCUMENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function validatePostDocumentKey(documentKey: string) {
	if (
		!documentKey
		|| documentKey.length > POST_CONTENT_LIMITS.documentKey
		|| documentKey !== documentKey.trim()
		|| !DOCUMENT_KEY_PATTERN.test(documentKey)
	) {
		throw new Error(
			`Post document keys must be ${POST_CONTENT_LIMITS.documentKey} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
	}
	return documentKey;
}

export function assertPostDocument(document: Doc<"contentDocuments">) {
	if (document.kind !== "post") throw new Error("Post document kind mismatch");
	if (
		!document.documentKey
		|| !Number.isSafeInteger(document.rank)
		|| (document.rank ?? -1) < 0
	) throw new Error("Post document identity is invalid");
	validatePostDocumentKey(document.documentKey);
	return document as Doc<"contentDocuments"> & {
		kind: "post";
		documentKey: string;
		rank: number;
	};
}

export function asPostRevisionPayload(payload: ContentRevisionPayload) {
	const candidate = payload as PostRevisionPayload;
	if (candidate.kind !== "post") throw new Error("Post revision payload kind mismatch");
	return validatePostRevisionPayload(candidate);
}

export function assertPostRevisionOwnership(
	revision: Doc<"contentRevisions">,
	document: Doc<"contentDocuments">,
) {
	if (
		revision.documentId !== document._id
		|| revision.siteUrl !== document.siteUrl
		|| revision.kind !== "post"
		|| document.kind !== "post"
	) throw new Error("Post revision ownership mismatch");
}

export function assertExpectedPostDraft(
	document: Doc<"contentDocuments">,
	expectedDraftRevisionId: Id<"contentRevisions"> | undefined,
) {
	if (document.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Post draft conflict: reload before saving or publishing");
	}
}

async function checksumInput(input: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function checksumPostDraft(draft: PostDraft) {
	return await checksumInput(postChecksumInput(draft));
}

export async function checksumPostSummary(draft: PostDraft) {
	return await checksumPostSummaryIntegrity(postSummaryIntegrityFromDraft(draft));
}

export async function checksumPostSummaryIntegrity(
	input: PostSummaryIntegrityInput,
) {
	return await checksumInput(postSummaryChecksumInput(input));
}

/** Canonicalize every relation ID before checksumming or storing a graph. */
export function normalizePostDraftIds(ctx: PostCtx, draft: PostDraft) {
	const validated = validatePostDraft(draft);
	const normalizeDocumentId = (id: string) => {
		const normalized = ctx.db.normalizeId("contentDocuments", id);
		if (!normalized) throw new Error("Post content reference ID is invalid");
		return normalized;
	};
	const normalizeAssetId = (id: string) => {
		const normalized = ctx.db.normalizeId("mediaAssets", id);
		if (!normalized) throw new Error("Post media asset ID is invalid");
		return normalized;
	};
	return validatePostDraft({
		...validated,
		authorDocumentId: validated.authorDocumentId
			? normalizeDocumentId(validated.authorDocumentId)
			: undefined,
		categories: validated.categories.map((category) => ({
			...category,
			documentId: normalizeDocumentId(category.documentId),
		})),
		mainImage: validated.mainImage
			? {
				...validated.mainImage,
				assetId: normalizeAssetId(validated.mainImage.assetId),
			}
			: undefined,
		body: {
			version: 1,
			blocks: validated.body.blocks.map((block) =>
				block.type === "image"
					? { ...block, assetId: normalizeAssetId(block.assetId) }
					: block,
			),
		},
	});
}

export async function listPostDocuments(ctx: PostCtx, siteUrl: string) {
	const documents = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", "post"),
		)
		.order("asc")
		.take(POST_CONTENT_LIMITS.documents + 1);
	if (documents.length > POST_CONTENT_LIMITS.documents) {
		throw new Error(
			`A site cannot exceed ${POST_CONTENT_LIMITS.documents} Post documents`,
		);
	}
	return documents.map(assertPostDocument);
}

function assertRowsOwned(
	rows: Array<{ siteUrl: string; documentId: Id<"contentDocuments">; revisionId: Id<"contentRevisions"> }>,
	document: Doc<"contentDocuments">,
	revision: Doc<"contentRevisions">,
	label: string,
) {
	if (
		rows.some(
			(row) =>
				row.siteUrl !== document.siteUrl
				|| row.documentId !== document._id
				|| row.revisionId !== revision._id,
		)
	) throw new Error(`${label} ownership mismatch`);
}

function assertContiguousOrder(rows: Array<{ order: number }>, label: string) {
	if (rows.some((row, index) => row.order !== index)) {
		throw new Error(`${label} order is not contiguous`);
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) {
		throw new Error(`${label} keys must be unique`);
	}
}

async function getPostBlocks(ctx: PostCtx, revisionId: Id<"contentRevisions">) {
	const rows = await ctx.db
		.query("contentBlocks")
		.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId))
		.take(POST_CONTENT_LIMITS.bodyBlocks + 1);
	if (rows.length > POST_CONTENT_LIMITS.bodyBlocks) {
		throw new Error("Post body block limit exceeded");
	}
	return rows;
}

async function getPostMedia(
	ctx: PostCtx,
	revisionId: Id<"contentRevisions">,
	role: "main" | "body",
) {
	const maximum = role === "main" ? 1 : POST_CONTENT_LIMITS.bodyImages;
	const rows = await ctx.db
		.query("contentMediaPlacements")
		.withIndex("by_revisionId_and_role_and_order", (q) =>
			q.eq("revisionId", revisionId).eq("role", role),
		)
		.take(maximum + 1);
	if (rows.length > maximum) throw new Error(`Post ${role} media limit exceeded`);
	return rows;
}

async function getPostReferences(
	ctx: PostCtx,
	revisionId: Id<"contentRevisions">,
	field: "author" | "category",
) {
	const maximum = field === "author" ? 1 : POST_CONTENT_LIMITS.categories;
	const rows = await ctx.db
		.query("contentReferences")
		.withIndex("by_fromRevisionId_and_field_and_order", (q) =>
			q.eq("fromRevisionId", revisionId).eq("field", field),
		)
		.take(maximum + 1);
	if (rows.length > maximum) throw new Error(`Post ${field} reference limit exceeded`);
	return rows;
}

async function getPostTechnicalItems(
	ctx: PostCtx,
	revisionId: Id<"contentRevisions">,
	field: "equipment" | "material",
) {
	const rows = await ctx.db
		.query("contentPostTechnicalItems")
		.withIndex("by_revisionId_and_field_and_order", (q) =>
			q.eq("revisionId", revisionId).eq("field", field),
		)
		.take(POST_CONTENT_LIMITS.technicalItems + 1);
	if (rows.length > POST_CONTENT_LIMITS.technicalItems) {
		throw new Error(`Post ${field} item limit exceeded`);
	}
	return rows;
}

export async function getReadyPostAssets(
	ctx: PostCtx,
	siteUrl: string,
	assetIds: readonly Id<"mediaAssets">[],
) {
	const ids = [...new Set(assetIds)];
	const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
	const byId = new Map<Id<"mediaAssets">, Doc<"mediaAssets">>();
	for (const [index, asset] of assets.entries()) {
		if (!asset || asset.siteUrl !== siteUrl || asset.status !== "ready") {
			throw new Error("Post images require ready media assets from the same site");
		}
		byId.set(ids[index], asset);
	}
	return byId;
}

export async function getPostReferenceTargets(
	ctx: PostCtx,
	siteUrl: string,
	args: {
		authorDocumentId?: Id<"contentDocuments">;
		categoryDocumentIds: readonly Id<"contentDocuments">[];
		requirePublished: boolean;
	},
) {
	const ids = [
		...(args.authorDocumentId ? [args.authorDocumentId] : []),
		...args.categoryDocumentIds,
	];
	const documents = await Promise.all(ids.map((id) => ctx.db.get(id)));
	for (const [index, document] of documents.entries()) {
		const expectedKind = args.authorDocumentId && index === 0 ? "author" : "category";
		if (
			!document
			|| document.siteUrl !== siteUrl
			|| document.kind !== expectedKind
		) throw new Error(`Post ${expectedKind} references must target the same site`);
		if (args.requirePublished && !document.publishedRevisionId) {
			throw new Error(`Post ${expectedKind} references must be published`);
		}
		if (args.requirePublished) {
			const supportingDocument = assertBlogDocument(document, expectedKind);
			const loaded = await loadBlogRevision(
				ctx,
				supportingDocument,
				supportingDocument.publishedRevisionId,
			);
			if (!loaded) throw new Error(`Published Post ${expectedKind} revision not found`);
			const published = toPublishedBlogSupportingContent(loaded.draft);
			if (supportingDocument.slug !== published.slug) {
				throw new Error(`Published Post ${expectedKind} slug mismatch`);
			}
			await requireReadyAuthorPortrait(ctx, siteUrl, loaded.draft);
		}
	}
	return documents as Doc<"contentDocuments">[];
}

export async function requirePostDraftRelations(
	ctx: PostCtx,
	siteUrl: string,
	draft: PostDraft,
	requirePublished: boolean,
) {
	const bodyAssetIds = draft.body.blocks
		.filter((block) => block.type === "image")
		.map((block) => {
			const assetId = ctx.db.normalizeId("mediaAssets", block.assetId);
			if (!assetId) throw new Error("Post body image asset ID is invalid");
			return assetId;
		});
	const assets = await getReadyPostAssets(ctx, siteUrl, [
		...(draft.mainImage ? [draft.mainImage.assetId] : []),
		...bodyAssetIds,
	]);
	const targets = await getPostReferenceTargets(ctx, siteUrl, {
		authorDocumentId: draft.authorDocumentId,
		categoryDocumentIds: draft.categories.map((category) => category.documentId),
		requirePublished,
	});
	return { assets, targets };
}

export type LoadedPostRevision = Awaited<ReturnType<typeof loadPostRevision>>;

export async function loadPostRevision(
	ctx: PostCtx,
	document: Doc<"contentDocuments">,
	revisionId: Id<"contentRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Post revision not found");
	assertPostRevisionOwnership(revision, document);
	const payload = asPostRevisionPayload(revision.payload);
	const [
		blocks,
		mainMedia,
		bodyMedia,
		authorReferences,
		categoryReferences,
		equipmentRows,
		materialRows,
	] =
		await Promise.all([
			getPostBlocks(ctx, revision._id),
			getPostMedia(ctx, revision._id, "main"),
			getPostMedia(ctx, revision._id, "body"),
			getPostReferences(ctx, revision._id, "author"),
			getPostReferences(ctx, revision._id, "category"),
			getPostTechnicalItems(ctx, revision._id, "equipment"),
			getPostTechnicalItems(ctx, revision._id, "material"),
		]);
	assertRowsOwned(blocks, document, revision, "Post body block");
	assertRowsOwned(mainMedia, document, revision, "Post main media");
	assertRowsOwned(bodyMedia, document, revision, "Post body media");
	assertRowsOwned(equipmentRows, document, revision, "Post equipment item");
	assertRowsOwned(materialRows, document, revision, "Post material item");
	if (
		[...authorReferences, ...categoryReferences].some(
			(row) =>
				row.siteUrl !== document.siteUrl
				|| row.fromDocumentId !== document._id
				|| row.fromRevisionId !== revision._id,
		)
	) throw new Error("Post reference ownership mismatch");
	assertContiguousOrder(blocks, "Post body block");
	assertContiguousOrder(mainMedia, "Post main media");
	assertContiguousOrder(bodyMedia, "Post body media");
	assertContiguousOrder(authorReferences, "Post author reference");
	assertContiguousOrder(categoryReferences, "Post category reference");
	assertContiguousOrder(equipmentRows, "Post equipment item");
	assertContiguousOrder(materialRows, "Post material item");
	assertUnique(blocks.map((row) => row.blockKey), "Post body block");
	assertUnique(bodyMedia.map((row) => row.placementKey), "Post body media");
	assertUnique(categoryReferences.map((row) => row.referenceKey), "Post category reference");
	assertUnique(equipmentRows.map((row) => row.itemKey), "Post equipment item");
	assertUnique(materialRows.map((row) => row.itemKey), "Post material item");
	if (new Set(categoryReferences.map((row) => row.toDocumentId)).size !== categoryReferences.length) {
		throw new Error("Post category references must target unique documents");
	}
	if (blocks.some((row) => row.block.key !== row.blockKey)) {
		throw new Error("Post body block key mismatch");
	}
	if (authorReferences.some((row) => row.referenceKey !== "author")) {
		throw new Error("Post author reference key mismatch");
	}

	const bodyMediaByKey = new Map(bodyMedia.map((row) => [row.placementKey, row]));
	const usedBodyMedia = new Set<string>();
	let expectedBodyMediaOrder = 0;
	const bodyBlocks = blocks.map((row) => {
		if (row.block.type !== "image") return row.block;
		if (row.block.placementKey !== row.blockKey) {
			throw new Error("Post image block placement key mismatch");
		}
		const placement = bodyMediaByKey.get(row.block.placementKey);
		if (!placement) throw new Error("Post image block has no media placement");
		if (placement.order !== expectedBodyMediaOrder) {
			throw new Error("Post body media order does not match image block order");
		}
		expectedBodyMediaOrder += 1;
		usedBodyMedia.add(placement.placementKey);
		return {
			type: "image" as const,
			key: row.block.key,
			assetId: placement.assetId,
			altText: placement.altText,
			caption: placement.caption,
		};
	});
	if (usedBodyMedia.size !== bodyMedia.length) {
		throw new Error("Post body media contains an orphan placement");
	}

	const draft: PostDraft = {
		kind: "post",
		title: payload.title,
		slug: payload.slug,
		format: payload.format,
		presentation: payload.presentation,
		displayPublishedAt: payload.displayPublishedAt,
		summary: payload.summary,
		seoTitle: payload.seoTitle,
		seoDescription: payload.seoDescription,
		brief: payload.brief,
		approach: payload.approach,
		outcome: payload.outcome,
		credits: payload.credits,
		equipment: equipmentRows.map((row) => ({
			key: row.itemKey,
			label: row.label,
			details: row.details,
		})),
		materials: materialRows.map((row) => ({
			key: row.itemKey,
			label: row.label,
			details: row.details,
		})),
		authorDocumentId: authorReferences[0]?.toDocumentId,
		categories: categoryReferences.map((reference) => ({
			key: reference.referenceKey,
			documentId: reference.toDocumentId,
		})),
		mainImage: mainMedia[0]
			? {
				key: mainMedia[0].placementKey,
				assetId: mainMedia[0].assetId,
				altText: mainMedia[0].altText,
				caption: mainMedia[0].caption,
			}
			: undefined,
		body: { version: 1, blocks: bodyBlocks },
	};
	validatePostDraft(draft);
	const summaryChecksum = await checksumPostSummary(draft);
	if (summaryChecksum !== payload.summaryChecksum) {
		throw new Error("Post revision summary checksum mismatch");
	}
	const derived = postRevisionPayloadFromDraft(draft, summaryChecksum);
	if (
		serializePostRevisionPayload(derived)
		!== serializePostRevisionPayload(payload)
	) {
		throw new Error("Post revision payload does not match its graph");
	}
	const checksum = await checksumPostDraft(draft);
	if (checksum !== revision.checksum) {
		throw new Error("Post revision checksum mismatch");
	}
	return {
		revision,
		payload,
		draft,
		blocks,
		mainMedia,
		bodyMedia,
		authorReferences,
		categoryReferences,
		equipmentRows,
		materialRows,
	};
}
