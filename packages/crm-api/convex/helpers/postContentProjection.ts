import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
	assertBlogDocument,
	loadBlogRevision,
	projectPublishedBlogContent,
} from "./blogContentData";
import {
	asPostRevisionPayload,
	assertPostRevisionOwnership,
	checksumPostSummaryIntegrity,
	getReadyPostAssets,
	loadPostRevision,
	requirePostDraftRelations,
} from "./postContentGraph";
import type { PostSummaryIntegrityInput } from "./postContentIntegrity";
import {
	POST_CONTENT_LIMITS,
	toPublishedPostDraft,
	toPublishedPostHeader,
} from "./postContentValidators";

function projectPublicAsset(asset: Doc<"mediaAssets">) {
	return {
		assetId: asset.assetId,
		source: { width: asset.source.width, height: asset.source.height },
		derivatives: asset.derivatives,
	};
}

async function projectSupportingDocument(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	expectedKind: "author" | "category",
) {
	const validated = assertBlogDocument(document, expectedKind);
	if (!validated.publishedRevisionId) {
		throw new Error(`Published Post ${expectedKind} reference is not published`);
	}
	const loaded = await loadBlogRevision(
		ctx,
		validated,
		validated.publishedRevisionId,
	);
	if (!loaded) throw new Error(`Published Post ${expectedKind} revision not found`);
	return await projectPublishedBlogContent(ctx, validated, loaded);
}

async function projectPostReferences(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	authorDocumentId: Id<"contentDocuments">,
	categoryDocumentIds: Id<"contentDocuments">[],
) {
	const documents = await Promise.all(
		[authorDocumentId, ...categoryDocumentIds].map((id) => ctx.db.get(id)),
	);
	const authorDocument = documents[0];
	if (!authorDocument || authorDocument.siteUrl !== document.siteUrl) {
		throw new Error("Published Post author reference is invalid");
	}
	const author = await projectSupportingDocument(ctx, authorDocument, "author");
	if (author.kind !== "author") throw new Error("Published Post author projection mismatch");
	const categories = await Promise.all(
		documents.slice(1).map(async (categoryDocument) => {
			if (!categoryDocument || categoryDocument.siteUrl !== document.siteUrl) {
				throw new Error("Published Post category reference is invalid");
			}
			const category = await projectSupportingDocument(
				ctx,
				categoryDocument,
				"category",
			);
			if (category.kind !== "category") {
				throw new Error("Published Post category projection mismatch");
			}
			return category;
		}),
	);
	return { author, categories };
}

export async function projectPublishedPostDetail(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	revisionId: Id<"contentRevisions">,
) {
	const loaded = await loadPostRevision(ctx, document, revisionId);
	if (!loaded) throw new Error("Published Post revision not found");
	const published = toPublishedPostDraft(loaded.draft);
	if (document.slug !== published.slug) throw new Error("Published Post slug mismatch");
	const { assets } = await requirePostDraftRelations(
		ctx,
		document.siteUrl,
		published,
		true,
	);
	const references = await projectPostReferences(
		ctx,
		document,
		published.authorDocumentId,
		published.categories.map((category) => category.documentId),
	);
	return {
		revisionId: loaded.revision._id,
		publishedAt: document.publishedAt ?? loaded.revision.createdAt,
		payload: {
			kind: "post" as const,
			title: published.title,
			slug: published.slug,
			format: published.format,
			presentation: published.presentation,
			displayPublishedAt: published.displayPublishedAt,
			summary: published.summary,
			excerpt: loaded.payload.excerpt,
			...(published.seoTitle?.trim()
				? { seoTitle: published.seoTitle.trim() }
				: {}),
			...(published.seoDescription?.trim()
				? { seoDescription: published.seoDescription.trim() }
				: {}),
			...(published.brief?.trim() ? { brief: published.brief.trim() } : {}),
			...(published.approach?.trim()
				? { approach: published.approach.trim() }
				: {}),
			...(published.outcome?.trim() ? { outcome: published.outcome.trim() } : {}),
			...(published.credits?.trim() ? { credits: published.credits.trim() } : {}),
			equipment: published.equipment,
			materials: published.materials,
			author: references.author,
			categories: references.categories,
			...(published.mainImage
				? {
					mainImage: {
						key: published.mainImage.key,
						altText: published.mainImage.altText?.trim() ?? "",
						...(published.mainImage.caption?.trim()
							? { caption: published.mainImage.caption.trim() }
							: {}),
						asset: projectPublicAsset(
							assets.get(published.mainImage.assetId)
								?? (() => {
									throw new Error("Published Post main asset not found");
								})(),
						),
					},
				}
				: {}),
			body: {
				version: 1 as const,
				blocks: published.body.blocks.map((block) => {
					if (block.type !== "image") return block;
					const asset = assets.get(block.assetId as Id<"mediaAssets">);
					if (!asset) throw new Error("Published Post body asset not found");
					return {
						type: "image" as const,
						key: block.key,
						altText: block.altText?.trim() ?? "",
						...(block.caption?.trim() ? { caption: block.caption.trim() } : {}),
						asset: projectPublicAsset(asset),
					};
				}),
			},
		},
	};
}

async function getSummaryRows(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	revision: Doc<"contentRevisions">,
) {
	const [mainMedia, authorReferences, categoryReferences] = await Promise.all([
		ctx.db
			.query("contentMediaPlacements")
			.withIndex("by_revisionId_and_role_and_order", (q) =>
				q.eq("revisionId", revision._id).eq("role", "main"),
			)
			.take(2),
		ctx.db
			.query("contentReferences")
			.withIndex("by_fromRevisionId_and_field_and_order", (q) =>
				q.eq("fromRevisionId", revision._id).eq("field", "author"),
			)
			.take(2),
		ctx.db
			.query("contentReferences")
			.withIndex("by_fromRevisionId_and_field_and_order", (q) =>
				q.eq("fromRevisionId", revision._id).eq("field", "category"),
			)
			.take(POST_CONTENT_LIMITS.categories + 1),
	]);
	if (
		mainMedia.length > 1
		|| authorReferences.length > 1
		|| categoryReferences.length > POST_CONTENT_LIMITS.categories
	) throw new Error("Published Post summary graph exceeds its limit");
	if (
		mainMedia.some(
			(row) =>
				row.siteUrl !== document.siteUrl
				|| row.documentId !== document._id
				|| row.revisionId !== revision._id,
		)
		|| [...authorReferences, ...categoryReferences].some(
			(row) =>
				row.siteUrl !== document.siteUrl
				|| row.fromDocumentId !== document._id
				|| row.fromRevisionId !== revision._id,
		)
	) throw new Error("Published Post summary graph ownership mismatch");
	if (
		mainMedia.some((row, index) => row.order !== index)
		|| authorReferences.some((row, index) => row.order !== index)
		|| categoryReferences.some((row, index) => row.order !== index)
	) throw new Error("Published Post summary graph order is invalid");
	if (authorReferences.some((reference) => reference.referenceKey !== "author")) {
		throw new Error("Published Post author reference key mismatch");
	}
	if (
		new Set(categoryReferences.map((reference) => reference.referenceKey)).size
			!== categoryReferences.length
		|| new Set(categoryReferences.map((reference) => reference.toDocumentId)).size
			!== categoryReferences.length
	) throw new Error("Published Post category references must be unique");
	return { mainMedia, authorReferences, categoryReferences };
}

export async function projectPublishedPostSummary(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	revision: Doc<"contentRevisions">,
) {
	assertPostRevisionOwnership(revision, document);
	const payload = asPostRevisionPayload(revision.payload);
	const header = toPublishedPostHeader(payload);
	if (document.slug !== header.slug) throw new Error("Published Post slug mismatch");
	const { mainMedia, authorReferences, categoryReferences } = await getSummaryRows(
		ctx,
		document,
		revision,
	);
	if (
		authorReferences.length !== 1
		|| categoryReferences.length !== header.categoryCount
		|| mainMedia.length !== (header.hasMainImage ? 1 : 0)
		|| header.referenceCount !== authorReferences.length + categoryReferences.length
	) throw new Error("Published Post summary graph count mismatch");
	if (mainMedia[0] && !mainMedia[0].altText?.trim()) {
		throw new Error("Published Post main image alt text is missing");
	}
	const authorDocumentId = authorReferences[0]?.toDocumentId;
	if (!authorDocumentId) throw new Error("Published Post author reference is missing");
	const { summaryChecksum, ...summaryPayload } = payload;
	const summaryIntegrity: PostSummaryIntegrityInput = {
		...summaryPayload,
		authorDocumentId,
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
	};
	if (await checksumPostSummaryIntegrity(summaryIntegrity) !== summaryChecksum) {
		throw new Error("Published Post summary checksum mismatch");
	}
	const references = await projectPostReferences(
		ctx,
		document,
		authorDocumentId,
		categoryReferences.map((reference) => reference.toDocumentId),
	);
	const mainAsset = mainMedia[0]
		? (
			await getReadyPostAssets(ctx, document.siteUrl, [mainMedia[0].assetId])
		).get(mainMedia[0].assetId)
		: undefined;
	if (mainMedia[0] && !mainAsset) throw new Error("Published Post main asset not found");
	return {
		revisionId: revision._id,
		rank: document.rank,
		publishedAt: document.publishedAt ?? revision.createdAt,
		payload: {
			kind: "post" as const,
			title: header.title,
			slug: header.slug,
			format: header.format,
			presentation: header.presentation,
			displayPublishedAt: header.displayPublishedAt,
			summary: header.summary,
			excerpt: header.excerpt,
			...(header.seoTitle?.trim()
				? { seoTitle: header.seoTitle.trim() }
				: {}),
			...(header.seoDescription?.trim()
				? { seoDescription: header.seoDescription.trim() }
				: {}),
			author: { name: references.author.name, slug: references.author.slug },
			categories: references.categories.map((category) => ({
				title: category.title,
				slug: category.slug,
			})),
			...(mainMedia[0] && mainAsset
				? {
					mainImage: {
						key: mainMedia[0].placementKey,
						altText: mainMedia[0].altText?.trim() ?? "",
						...(mainMedia[0].caption?.trim()
							? { caption: mainMedia[0].caption.trim() }
							: {}),
						asset: projectPublicAsset(mainAsset),
					},
				}
				: {}),
		},
	};
}
