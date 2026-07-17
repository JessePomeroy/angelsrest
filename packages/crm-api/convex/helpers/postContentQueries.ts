import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import {
	asPostRevisionPayload,
	assertPostDocument,
	assertPostRevisionOwnership,
	listPostDocuments,
	loadPostRevision,
} from "./postContentGraph";
import {
	projectPublishedPostDetail,
	projectPublishedPostSummary,
} from "./postContentProjection";
import {
	requireCanonicalPostSlug,
	toPublishedPostHeader,
} from "./postContentValidators";

// A detail page may resolve up to twenty supporting records. Keeping the
// first public index page to twelve protects the function's read budget until
// cursor pagination is introduced with the Blog host workflow.
export const POST_PUBLIC_LIST_MAX = 12;

function toEditorRevision(
	loaded: Awaited<ReturnType<typeof loadPostRevision>>,
) {
	if (!loaded) return null;
	return {
		revisionId: loaded.revision._id,
		schemaVersion: loaded.revision.schemaVersion,
		draft: loaded.draft,
		source: loaded.revision.source,
		createdAt: loaded.revision.createdAt,
	};
}

export async function getPostEditorState(
	ctx: QueryCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId,
	);
	const document = assertPostDocument(stored);
	const [draft, published] = await Promise.all([
		loadPostRevision(ctx, document, document.draftRevisionId),
		loadPostRevision(ctx, document, document.publishedRevisionId),
	]);
	return {
		documentId: document._id,
		documentKey: document.documentKey,
		kind: "post" as const,
		slug: document.slug ?? null,
		rank: document.rank,
		draft: toEditorRevision(draft),
		published: toEditorRevision(published),
		updatedAt: document.updatedAt,
		publishedAt: document.publishedAt ?? null,
	};
}

async function getRevisionHeader(
	ctx: QueryCtx,
	document: ReturnType<typeof assertPostDocument>,
	revisionId: Id<"contentRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Post revision not found");
	assertPostRevisionOwnership(revision, document);
	const payload = asPostRevisionPayload(revision.payload);
	return {
		revisionId: revision._id,
		title: payload.title ?? "",
		format: payload.format ?? null,
		presentation: payload.presentation ?? null,
		displayPublishedAt: payload.displayPublishedAt ?? null,
	};
}

export async function listPostEditorDocuments(ctx: QueryCtx, siteUrl: string) {
	const { client } = await requireSiteAdmin(ctx, siteUrl);
	const documents = await listPostDocuments(ctx, client.siteUrl);
	return await Promise.all(
		documents.map(async (document) => ({
			documentId: document._id,
			documentKey: document.documentKey,
			kind: "post" as const,
			slug: document.slug ?? null,
			rank: document.rank,
			draft: await getRevisionHeader(ctx, document, document.draftRevisionId),
			published: await getRevisionHeader(
				ctx,
				document,
				document.publishedRevisionId,
			),
			updatedAt: document.updatedAt,
		})),
	);
}

export async function getPublishedPostBySlug(
	ctx: QueryCtx,
	args: { siteUrl: string; slug: string },
) {
	let slug: string;
	try {
		slug = requireCanonicalPostSlug(args.slug);
	} catch {
		return null;
	}
	const stored = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_slug", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("kind", "post").eq("slug", slug),
		)
		.unique();
	if (!stored?.publishedRevisionId) return null;
	const publishedRevisionId = stored.publishedRevisionId;
	const document = assertPostDocument(stored);
	return await projectPublishedPostDetail(
		ctx,
		document,
		publishedRevisionId,
	);
}

export async function listPublishedPosts(
	ctx: QueryCtx,
	siteUrl: string,
	limit: number,
) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > POST_PUBLIC_LIST_MAX) {
		throw new Error(
			`Published Post lists must request between 1 and ${POST_PUBLIC_LIST_MAX} items`,
		);
	}
	const documents = (await listPostDocuments(ctx, siteUrl)).filter(
		(document) => document.publishedRevisionId !== undefined,
	);
	const revisions = await Promise.all(
		documents.map(async (document) => {
			const revisionId = document.publishedRevisionId;
			if (!revisionId) throw new Error("Published Post revision not found");
			const revision = await ctx.db.get(revisionId);
			if (!revision) throw new Error("Published Post revision not found");
			assertPostRevisionOwnership(revision, document);
			const header = toPublishedPostHeader(asPostRevisionPayload(revision.payload));
			if (document.slug !== header.slug) throw new Error("Published Post slug mismatch");
			return { document, revision, header };
		}),
	);
	revisions.sort(
		(left, right) =>
			right.header.displayPublishedAt - left.header.displayPublishedAt
			|| (right.document.publishedAt ?? right.revision.createdAt)
				- (left.document.publishedAt ?? left.revision.createdAt)
			|| left.document.rank - right.document.rank,
	);
	return await Promise.all(
		revisions
			.slice(0, limit)
			.map(({ document, revision }) =>
				projectPublishedPostSummary(ctx, document, revision),
			),
	);
}
