import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import {
	serializeSiteSettingsPayload,
	siteSettingsDraftPayloadValidator,
	toPublishedSiteSettings,
	validateSiteSettingsDraft,
} from "./helpers/contentValidators";

const SITE_SETTINGS_KIND = "siteSettings" as const;

async function getSiteSettingsDocument(
	ctx: QueryCtx | MutationCtx,
	siteUrl: string,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", SITE_SETTINGS_KIND),
		)
		.unique();
}

async function getRevision(
	ctx: QueryCtx | MutationCtx,
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

function projectAdminRevision(revision: Doc<"contentRevisions"> | null) {
	if (!revision) return null;
	return {
		revisionId: revision._id,
		schemaVersion: revision.schemaVersion,
		payload: revision.payload,
		source: revision.source,
		createdAt: revision.createdAt,
	};
}

async function getPublishedSiteSettingsState(
	ctx: QueryCtx,
	siteUrl: string,
) {
	const document = await getSiteSettingsDocument(ctx, siteUrl);
	if (!document?.publishedRevisionId) return null;
	const revision = await getRevision(ctx, document.publishedRevisionId);
	if (!revision) {
		throw new Error("Published content revision not found");
	}
	assertRevisionBelongsToDocument(revision, document);
	return {
		revisionId: revision._id,
		publishedAt: document.publishedAt ?? revision.createdAt,
		payload: toPublishedSiteSettings(revision.payload),
	};
}

/** Authenticated editor state; never callable across tenant membership. */
export const getSiteSettingsEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const document = await getSiteSettingsDocument(ctx, siteUrl);
		if (!document) return null;

		const [draft, published] = await Promise.all([
			getRevision(ctx, document.draftRevisionId),
			getRevision(ctx, document.publishedRevisionId),
		]);
		if (draft) assertRevisionBelongsToDocument(draft, document);
		if (published) assertRevisionBelongsToDocument(published, document);

		return {
			documentId: document._id,
			draft: projectAdminRevision(draft),
			published: projectAdminRevision(published),
			updatedAt: document.updatedAt,
			publishedAt: document.publishedAt ?? null,
		};
	},
});

/** Public-safe read: only the complete published payload is projected. */
export const getPublishedSiteSettings = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const state = await getPublishedSiteSettingsState(ctx, siteUrl);
		return state?.payload ?? null;
	},
});

/** Public-safe read with opaque revision metadata for provider observability. */
export const getPublishedSiteSettingsWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await getPublishedSiteSettingsState(ctx, siteUrl);
	},
});

/** Save an immutable revision while allowing incomplete draft content. */
export const saveSiteSettingsDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: siteSettingsDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
		validateSiteSettingsDraft(args.payload);
		const now = Date.now();
		const actor = identity.tokenIdentifier;
		const checksum = await checksumPayload(
			serializeSiteSettingsPayload(args.payload),
		);
		let document = await getSiteSettingsDocument(ctx, client.siteUrl);

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
				kind: SITE_SETTINGS_KIND,
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
			kind: SITE_SETTINGS_KIND,
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
	},
});

/** Publish exactly the currently loaded draft, never a stale revision. */
export const publishSiteSettings = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => {
		const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
		const document = await getSiteSettingsDocument(ctx, client.siteUrl);
		if (!document) throw new Error("Site settings draft not found");
		assertExpectedDraft(document, args.draftRevisionId);
		const revision = await ctx.db.get(args.draftRevisionId);
		if (!revision) throw new Error("Site settings draft revision not found");
		assertRevisionBelongsToDocument(revision, document);
		toPublishedSiteSettings(revision.payload);

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
	},
});

/** Discard only the currently loaded unpublished pointer. History is immutable. */
export const discardSiteSettingsDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => {
		const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
		const document = await getSiteSettingsDocument(ctx, client.siteUrl);
		if (!document) throw new Error("Site settings draft not found");
		assertExpectedDraft(document, args.draftRevisionId);

		await ctx.db.patch(document._id, {
			draftRevisionId: undefined,
			updatedAt: Date.now(),
			updatedBy: identity.tokenIdentifier,
		});
		return null;
	},
});
