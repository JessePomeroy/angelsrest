import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireSiteAdmin } from "../authHelpers";
import type {
	ContentRevisionPayload,
	SingletonContentKind,
} from "./contentValidators";

type ContentContext = QueryCtx | MutationCtx;

export async function getContentDocument(
	ctx: ContentContext,
	siteUrl: string,
	kind: SingletonContentKind,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind),
		)
		.unique();
}

async function getRevision(
	ctx: ContentContext,
	revisionId: Id<"contentRevisions"> | undefined,
) {
	return revisionId ? await ctx.db.get(revisionId) : null;
}

function assertRevisionBelongsToDocument(
	revision: Doc<"contentRevisions">,
	document: Doc<"contentDocuments">,
) {
	if (
		revision.documentId !== document._id ||
		revision.siteUrl !== document.siteUrl ||
		revision.kind !== document.kind
	) {
		throw new Error("Content revision ownership mismatch");
	}
}

function assertExpectedDraft(
	document: Doc<"contentDocuments">,
	expectedDraftRevisionId: Id<"contentRevisions"> | undefined,
) {
	if (document.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Draft conflict: reload before saving or publishing");
	}
}

async function checksumPayload(serialized: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function projectAdminRevision<T>(
	revision: Doc<"contentRevisions"> | null,
	projectPayload: (payload: ContentRevisionPayload) => T,
) {
	if (!revision) return null;
	return {
		revisionId: revision._id,
		schemaVersion: revision.schemaVersion,
		payload: projectPayload(revision.payload),
		source: revision.source,
		createdAt: revision.createdAt,
	};
}

export async function getContentEditorState<T>(
	ctx: QueryCtx,
	siteUrl: string,
	kind: SingletonContentKind,
	projectPayload: (payload: ContentRevisionPayload) => T,
) {
	await requireSiteAdmin(ctx, siteUrl);
	const document = await getContentDocument(ctx, siteUrl, kind);
	if (!document) return null;

	const [draft, published] = await Promise.all([
		getRevision(ctx, document.draftRevisionId),
		getRevision(ctx, document.publishedRevisionId),
	]);
	if (draft) assertRevisionBelongsToDocument(draft, document);
	if (published) assertRevisionBelongsToDocument(published, document);

	return {
		documentId: document._id,
		draft: projectAdminRevision(draft, projectPayload),
		published: projectAdminRevision(published, projectPayload),
		updatedAt: document.updatedAt,
		publishedAt: document.publishedAt ?? null,
	};
}

export async function getPublishedContentState<T>(
	ctx: QueryCtx,
	siteUrl: string,
	kind: SingletonContentKind,
	projectPayload: (payload: ContentRevisionPayload) => T,
) {
	const document = await getContentDocument(ctx, siteUrl, kind);
	if (!document?.publishedRevisionId) return null;
	const revision = await getRevision(ctx, document.publishedRevisionId);
	if (!revision) throw new Error("Published content revision not found");
	assertRevisionBelongsToDocument(revision, document);
	return {
		revisionId: revision._id,
		publishedAt: document.publishedAt ?? revision.createdAt,
		payload: projectPayload(revision.payload),
	};
}

export async function saveContentDraft(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		kind: SingletonContentKind;
		expectedDraftRevisionId?: Id<"contentRevisions">;
		payload: ContentRevisionPayload;
		serializedPayload: string;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	const now = Date.now();
	const actor = identity.tokenIdentifier;
	const checksum = await checksumPayload(args.serializedPayload);
	let document = await getContentDocument(ctx, client.siteUrl, args.kind);

	if (document) {
		assertExpectedDraft(document, args.expectedDraftRevisionId);
		const currentDraft = await getRevision(ctx, document.draftRevisionId);
		if (currentDraft) {
			assertRevisionBelongsToDocument(currentDraft, document);
			if (currentDraft.checksum === checksum) {
				return { documentId: document._id, revisionId: currentDraft._id };
			}
		}
	} else {
		if (args.expectedDraftRevisionId !== undefined) {
			throw new Error("Draft conflict: the content document does not exist");
		}
		const documentId = await ctx.db.insert("contentDocuments", {
			siteUrl: client.siteUrl,
			kind: args.kind,
			createdAt: now,
			createdBy: actor,
			updatedAt: now,
			updatedBy: actor,
		});
		document = await ctx.db.get(documentId);
		if (!document) throw new Error("Content document creation failed");
	}

	const revisionId = await ctx.db.insert("contentRevisions", {
		siteUrl: client.siteUrl,
		documentId: document._id,
		kind: args.kind,
		schemaVersion: 1,
		payload: args.payload,
		source: "admin",
		checksum,
		createdAt: now,
		createdBy: actor,
	});
	await ctx.db.patch(document._id, {
		draftRevisionId: revisionId,
		updatedAt: now,
		updatedBy: actor,
	});
	return { documentId: document._id, revisionId };
}

export async function publishContentDraft<T>(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		kind: SingletonContentKind;
		draftRevisionId: Id<"contentRevisions">;
	},
	projectPayload: (payload: ContentRevisionPayload) => T,
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	const document = await getContentDocument(ctx, client.siteUrl, args.kind);
	if (!document) throw new Error("Content draft not found");
	assertExpectedDraft(document, args.draftRevisionId);
	const revision = await getRevision(ctx, args.draftRevisionId);
	if (!revision) throw new Error("Content draft revision not found");
	assertRevisionBelongsToDocument(revision, document);
	projectPayload(revision.payload);

	const now = Date.now();
	await ctx.db.patch(document._id, {
		publishedRevisionId: revision._id,
		draftRevisionId: undefined,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
		publishedAt: now,
		publishedBy: identity.tokenIdentifier,
	});
	return { publishedRevisionId: revision._id };
}

export async function discardContentDraft(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		kind: SingletonContentKind;
		draftRevisionId: Id<"contentRevisions">;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	const document = await getContentDocument(ctx, client.siteUrl, args.kind);
	if (!document) throw new Error("Content draft not found");
	assertExpectedDraft(document, args.draftRevisionId);

	await ctx.db.patch(document._id, {
		draftRevisionId: undefined,
		updatedAt: Date.now(),
		updatedBy: identity.tokenIdentifier,
	});
	return null;
}
