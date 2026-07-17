import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import {
	BLOG_CONTENT_LIMITS,
	type BlogSupportingKind,
	requireCanonicalBlogSlug,
} from "./blogContentValidators";
import {
	assertBlogDocument,
	listBlogDocuments,
	loadBlogRevision,
	projectPublishedBlogContent,
	toEditorBlogRevision,
} from "./blogContentData";
import { getContentSlugHistoryOwner } from "./contentSlugHistory";
import { isContentDocumentArchived } from "./contentLifecycle";
import { toPublishedBlogSupportingContent } from "./blogContentValidators";

export async function getBlogEditorState(
	ctx: QueryCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertBlogDocument(stored);
	const [draft, published] = await Promise.all([
		loadBlogRevision(ctx, document, document.draftRevisionId),
		loadBlogRevision(ctx, document, document.publishedRevisionId),
	]);
	return {
		documentId: document._id,
		documentKey: document.documentKey,
		kind: document.kind,
		slug: document.slug ?? null,
		rank: document.rank,
		draft: toEditorBlogRevision(draft),
		published: toEditorBlogRevision(published),
		updatedAt: document.updatedAt,
		publishedAt: document.publishedAt ?? null,
		archivedAt: document.archivedAt ?? null,
	};
}

export async function listBlogEditorDocuments(
	ctx: QueryCtx,
	siteUrl: string,
	kind: BlogSupportingKind,
) {
	const { client } = await requireSiteAdmin(ctx, siteUrl);
	const documents = await listBlogDocuments(ctx, client.siteUrl, kind);
	return await Promise.all(
		documents.filter((document) => !isContentDocumentArchived(document)).map(async (document) => {
			const [draft, published] = await Promise.all([
				loadBlogRevision(ctx, document, document.draftRevisionId),
				loadBlogRevision(ctx, document, document.publishedRevisionId),
			]);
			const selected = draft?.draft ?? published?.draft;
			return {
				documentId: document._id,
				documentKey: document.documentKey,
				kind: document.kind,
				slug: document.slug ?? null,
				rank: document.rank,
				label: selected
					? selected.kind === "author"
						? selected.name ?? ""
						: selected.title ?? ""
					: "",
				draftRevisionId: draft?.revision._id ?? null,
				publishedRevisionId: published?.revision._id ?? null,
				updatedAt: document.updatedAt,
				archivedAt: document.archivedAt ?? null,
			};
		}),
	);
}

export async function getPublishedBlogBySlug(
	ctx: QueryCtx,
	args: { siteUrl: string; kind: BlogSupportingKind; slug: string },
) {
	let slug: string;
	try {
		slug = requireCanonicalBlogSlug(
			args.slug,
			args.kind === "author" ? "Author slug" : "Category slug",
			args.kind === "author"
				? BLOG_CONTENT_LIMITS.authorSlug
				: BLOG_CONTENT_LIMITS.categorySlug,
		);
	} catch {
		return null;
	}
	const document = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_slug", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("kind", args.kind).eq("slug", slug),
		)
		.unique();
	if (!document?.publishedRevisionId || isContentDocumentArchived(document)) return null;
	const validatedDocument = assertBlogDocument(document, args.kind);
	const loaded = await loadBlogRevision(
		ctx,
		validatedDocument,
		validatedDocument.publishedRevisionId,
	);
	if (!loaded) throw new Error("Published Blog supporting revision not found");
	return {
		revisionId: loaded.revision._id,
		publishedAt: validatedDocument.publishedAt ?? loaded.revision.createdAt,
		payload: await projectPublishedBlogContent(ctx, validatedDocument, loaded),
	};
}

async function requirePublishedBlogSlug(
	ctx: QueryCtx,
	document: ReturnType<typeof assertBlogDocument>,
) {
	if (!document.publishedRevisionId || !document.slug) return null;
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
	return published.slug;
}

/** Resolve a current public slug or one retained historical hop without exposing content. */
export async function resolvePublishedBlogSlug(
	ctx: QueryCtx,
	args: { siteUrl: string; kind: BlogSupportingKind; slug: string },
) {
	let slug: string;
	try {
		slug = requireCanonicalBlogSlug(
			args.slug,
			args.kind === "author" ? "Author slug" : "Category slug",
			args.kind === "author"
				? BLOG_CONTENT_LIMITS.authorSlug
				: BLOG_CONTENT_LIMITS.categorySlug,
		);
	} catch {
		return null;
	}
	const current = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_slug", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("kind", args.kind).eq("slug", slug),
		)
		.unique();
	if (current) {
		const document = assertBlogDocument(current, args.kind);
		if (isContentDocumentArchived(document)) return null;
		const currentSlug = await requirePublishedBlogSlug(ctx, document);
		return currentSlug
			? { status: "current" as const, kind: args.kind, slug: currentSlug }
			: null;
	}
	const retained = await getContentSlugHistoryOwner(ctx, {
		siteUrl: args.siteUrl,
		kind: args.kind,
		slug,
	});
	if (!retained) return null;
	const stored = await ctx.db.get(retained.documentId);
	if (!stored || stored.siteUrl !== args.siteUrl) {
		throw new Error("Retained Blog slug ownership mismatch");
	}
	const document = assertBlogDocument(stored, args.kind);
	if (isContentDocumentArchived(document)) return null;
	const currentSlug = await requirePublishedBlogSlug(ctx, document);
	if (!currentSlug) return null;
	if (currentSlug === slug) throw new Error("Retained Blog slug points to itself");
	return { status: "redirect" as const, kind: args.kind, slug: currentSlug };
}

export async function listPublishedBlogDocuments(
	ctx: QueryCtx,
	siteUrl: string,
	kind: BlogSupportingKind,
) {
	const documents = await listBlogDocuments(ctx, siteUrl, kind);
	return await Promise.all(
		documents
			.filter(
				(document) =>
					document.publishedRevisionId !== undefined
					&& !isContentDocumentArchived(document),
			)
			.map(async (document) => {
				const loaded = await loadBlogRevision(
					ctx,
					document,
					document.publishedRevisionId,
				);
				if (!loaded) {
					throw new Error("Published Blog supporting revision not found");
				}
				return {
					revisionId: loaded.revision._id,
					rank: document.rank,
					publishedAt: document.publishedAt ?? loaded.revision.createdAt,
					payload: await projectPublishedBlogContent(ctx, document, loaded),
				};
			}),
	);
}
