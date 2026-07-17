import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	type BlogSupportingDraft,
	type BlogSupportingKind,
	toPublishedBlogSupportingContent,
	validateBlogSupportingDraft,
} from "./blogContentValidators";
import type { ContentRevisionPayload } from "./contentValidators";

type BlogContentCtx = QueryCtx | MutationCtx;

export const BLOG_SUPPORTING_DOCUMENT_MAX = 100;
export const BLOG_DOCUMENT_KEY_MAX = 120;

const DOCUMENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function validateBlogDocumentKey(documentKey: string) {
	if (
		!documentKey
		|| documentKey.length > BLOG_DOCUMENT_KEY_MAX
		|| documentKey !== documentKey.trim()
		|| !DOCUMENT_KEY_PATTERN.test(documentKey)
	) {
		throw new Error(
			`Blog document keys must be ${BLOG_DOCUMENT_KEY_MAX} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
	}
	return documentKey;
}

export function assertBlogDocument(
	document: Doc<"contentDocuments">,
	expectedKind?: BlogSupportingKind,
) {
	if (document.kind !== "author" && document.kind !== "category") {
		throw new Error("Blog supporting document kind mismatch");
	}
	if (expectedKind !== undefined && document.kind !== expectedKind) {
		throw new Error("Blog supporting document kind mismatch");
	}
	if (
		!document.documentKey
		|| !Number.isSafeInteger(document.rank)
		|| (document.rank ?? -1) < 0
	) throw new Error("Blog supporting document identity is invalid");
	validateBlogDocumentKey(document.documentKey);
	return document as Doc<"contentDocuments"> & {
		kind: BlogSupportingKind;
		documentKey: string;
		rank: number;
	};
}

export function asBlogSupportingDraft(
	payload: ContentRevisionPayload,
	expectedKind?: BlogSupportingKind,
) {
	const draft = payload as BlogSupportingDraft;
	if (
		(draft.kind !== "author" && draft.kind !== "category")
		|| (expectedKind !== undefined && draft.kind !== expectedKind)
	) throw new Error("Blog supporting revision payload kind mismatch");
	validateBlogSupportingDraft(draft);
	return draft;
}

export function assertBlogRevisionOwnership(
	revision: Doc<"contentRevisions">,
	document: Doc<"contentDocuments">,
) {
	if (
		revision.documentId !== document._id
		|| revision.siteUrl !== document.siteUrl
		|| revision.kind !== document.kind
	) throw new Error("Blog supporting revision ownership mismatch");
}

export async function getBlogRevision(
	ctx: BlogContentCtx,
	revisionId: Id<"contentRevisions"> | undefined,
) {
	return revisionId ? await ctx.db.get(revisionId) : null;
}

export async function loadBlogRevision(
	ctx: BlogContentCtx,
	document: Doc<"contentDocuments">,
	revisionId: Id<"contentRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const revision = await getBlogRevision(ctx, revisionId);
	if (!revision) throw new Error("Blog supporting revision not found");
	assertBlogRevisionOwnership(revision, document);
	const validatedDocument = assertBlogDocument(document);
	return {
		revision,
		draft: asBlogSupportingDraft(revision.payload, validatedDocument.kind),
	};
}

export async function checksumBlogDraft(serialized: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function assertExpectedBlogDraft(
	document: Doc<"contentDocuments">,
	expectedDraftRevisionId: Id<"contentRevisions"> | undefined,
) {
	if (document.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Blog draft conflict: reload before saving or publishing");
	}
}

export async function listBlogDocuments(
	ctx: BlogContentCtx,
	siteUrl: string,
	kind: BlogSupportingKind,
) {
	const documents = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind),
		)
		.order("asc")
		.take(BLOG_SUPPORTING_DOCUMENT_MAX + 1);
	if (documents.length > BLOG_SUPPORTING_DOCUMENT_MAX) {
		throw new Error(
			`A site cannot exceed ${BLOG_SUPPORTING_DOCUMENT_MAX} ${kind} documents`,
		);
	}
	return documents.map((document) => assertBlogDocument(document, kind));
}

export async function requireReadyAuthorPortrait(
	ctx: BlogContentCtx,
	siteUrl: string,
	draft: BlogSupportingDraft,
) {
	if (draft.kind !== "author" || !draft.portrait) return null;
	const asset = await ctx.db.get(draft.portrait.assetId);
	if (!asset || asset.siteUrl !== siteUrl || asset.status !== "ready") {
		throw new Error(
			"Author portraits require a ready media asset from the same site",
		);
	}
	return asset;
}

export function blogDraftReferencesAsset(
	draft: BlogSupportingDraft,
	assetId: Id<"mediaAssets">,
) {
	return draft.kind === "author" && draft.portrait?.assetId === assetId;
}

/**
 * Keep an Author portrait available while any active draft or published
 * revision references it. Historical revisions deliberately do not pin media.
 */
export async function requireBlogAssetUnused(
	ctx: MutationCtx,
	asset: Doc<"mediaAssets">,
) {
	const documents = await listBlogDocuments(ctx, asset.siteUrl, "author");
	for (const document of documents) {
		const revisionIds = [
			document.draftRevisionId,
			document.publishedRevisionId,
		].filter((id): id is Id<"contentRevisions"> => id !== undefined);
		for (const revisionId of new Set(revisionIds)) {
			const loaded = await loadBlogRevision(ctx, document, revisionId);
			if (loaded && blogDraftReferencesAsset(loaded.draft, asset._id)) {
				throw new Error("Media asset is in use by Author content");
			}
		}
	}
}

export function toEditorBlogRevision(
	loaded: Awaited<ReturnType<typeof loadBlogRevision>>,
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

export async function projectPublishedBlogContent(
	ctx: QueryCtx,
	document: Doc<"contentDocuments">,
	loaded: NonNullable<Awaited<ReturnType<typeof loadBlogRevision>>>,
) {
	const published = toPublishedBlogSupportingContent(loaded.draft);
	if (document.slug !== published.slug) {
		throw new Error("Published Blog supporting slug mismatch");
	}
	if (published.kind === "category") return published;
	const asset = await requireReadyAuthorPortrait(ctx, document.siteUrl, loaded.draft);
	return {
		kind: published.kind,
		name: published.name,
		slug: published.slug,
		...(published.bio ? { bio: published.bio } : {}),
		...(published.portrait && asset
			? {
				portrait: {
					key: published.portrait.key,
					altText: published.portrait.altText,
					...(published.portrait.caption
						? { caption: published.portrait.caption }
						: {}),
					asset: {
						assetId: asset.assetId,
						source: {
							width: asset.source.width,
							height: asset.source.height,
						},
						derivatives: asset.derivatives,
					},
				},
			}
			: {}),
	};
}
