import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import type { BlogSupportingKind } from "./blogContentValidators";
import {
	assertBlogDocument,
	listBlogDocuments,
	loadBlogRevision,
	toEditorBlogRevision,
} from "./blogContentData";
import { isContentDocumentArchived } from "./contentLifecycle";

export async function getBlogEditorState(
	ctx: QueryCtx,
	documentId: Id<"contentDocuments">,
) {
	const stored = await requireDocumentSiteAdmin(
		ctx,
		"contentDocuments",
		documentId, "editor",
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
	const { client } = await requireSiteAdmin(ctx, siteUrl, "editor");
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
