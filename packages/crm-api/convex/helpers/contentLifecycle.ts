import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { POST_CONTENT_LIMITS } from "./postContentValidators";

type ContentDocument = Doc<"contentDocuments">;

export function isContentDocumentArchived(document: ContentDocument) {
	return document.archivedAt !== undefined;
}

export function requireActiveContentDocument(
	document: ContentDocument,
	label: string,
) {
	if (isContentDocumentArchived(document)) {
		throw new Error(`${label} is archived`);
	}
}

async function getActor(ctx: MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity.tokenIdentifier;
}

export async function requireNoActivePostReferences(
	ctx: MutationCtx,
	target: ContentDocument,
	args: { publishedOnly: boolean; label: string },
) {
	const postDocuments = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
			q.eq("siteUrl", target.siteUrl).eq("kind", "post"),
		)
		.take(POST_CONTENT_LIMITS.documents + 1);
	if (postDocuments.length > POST_CONTENT_LIMITS.documents) {
		throw new Error(`${args.label} references cannot be verified safely`);
	}
	for (const source of postDocuments) {
		const activeRevisionIds = args.publishedOnly
			? [source.publishedRevisionId]
			: [source.draftRevisionId, source.publishedRevisionId];
		const uniqueRevisionIds = [...new Set(activeRevisionIds)].filter(
			(revisionId): revisionId is NonNullable<typeof revisionId> =>
				revisionId !== undefined,
		);
		const activeReferences = await Promise.all(
			uniqueRevisionIds.map(async (revisionId) =>
				await ctx.db
					.query("contentReferences")
					.withIndex("by_siteUrl_and_toDocumentId_and_fromRevisionId", (q) =>
						q
							.eq("siteUrl", target.siteUrl)
							.eq("toDocumentId", target._id)
							.eq("fromRevisionId", revisionId),
					)
					.first(),
			),
		);
		if (activeReferences.some((reference) => reference !== null)) {
			throw new Error(`${args.label} is referenced by active Post content`);
		}
	}
}

export async function archiveContentDocument(
	ctx: MutationCtx,
	document: ContentDocument,
) {
	if (isContentDocumentArchived(document)) {
		return { documentId: document._id, archivedAt: document.archivedAt };
	}
	const actor = await getActor(ctx);
	const now = Date.now();
	await ctx.db.patch(document._id, {
		archivedAt: now,
		archivedBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	return { documentId: document._id, archivedAt: now };
}

export async function restoreContentDocument(
	ctx: MutationCtx,
	document: ContentDocument,
) {
	if (!isContentDocumentArchived(document)) {
		return { documentId: document._id, archivedAt: null };
	}
	const actor = await getActor(ctx);
	const now = Date.now();
	await ctx.db.patch(document._id, {
		archivedAt: undefined,
		archivedBy: undefined,
		updatedAt: now,
		updatedBy: actor,
	});
	return { documentId: document._id, archivedAt: null };
}

export async function unpublishContentDocument(
	ctx: MutationCtx,
	document: ContentDocument,
	label: string,
) {
	requireActiveContentDocument(document, label);
	if (!document.publishedRevisionId) {
		return { documentId: document._id, publishedRevisionId: null };
	}
	const actor = await getActor(ctx);
	const now = Date.now();
	await ctx.db.patch(document._id, {
		publishedRevisionId: undefined,
		publishedAt: undefined,
		publishedBy: undefined,
		updatedAt: now,
		updatedBy: actor,
	});
	return { documentId: document._id, publishedRevisionId: null };
}
