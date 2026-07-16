import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	discardContentDraft,
	getContentEditorState,
	getPublishedContentState,
	publishContentDraft,
	saveContentDraft,
} from "./helpers/contentStore";
import {
	type ContentRevisionPayload,
	type HomepageQuoteDraftPayload,
	homepageQuoteDraftPayloadValidator,
	serializeHomepageQuotePayload,
	serializeSiteSettingsPayload,
	type SiteSettingsDraftPayload,
	siteSettingsDraftPayloadValidator,
	toPublishedHomepageQuote,
	toPublishedSiteSettings,
	validateHomepageQuoteDraft,
	validateSiteSettingsDraft,
} from "./helpers/contentValidators";

const SITE_SETTINGS_KIND = "siteSettings" as const;
const HOMEPAGE_QUOTE_KIND = "homepageQuote" as const;

function asSiteSettingsPayload(
	payload: ContentRevisionPayload,
): SiteSettingsDraftPayload {
	const narrowed = payload as SiteSettingsDraftPayload;
	validateSiteSettingsDraft(narrowed);
	return narrowed;
}

function asHomepageQuotePayload(
	payload: ContentRevisionPayload,
): HomepageQuoteDraftPayload {
	const narrowed = payload as HomepageQuoteDraftPayload;
	validateHomepageQuoteDraft(narrowed);
	return narrowed;
}

/** Authenticated editor state; never callable across tenant membership. */
export const getSiteSettingsEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getContentEditorState(
			ctx,
			siteUrl,
			SITE_SETTINGS_KIND,
			asSiteSettingsPayload,
		),
});

/** Public-safe read: only the complete published payload is projected. */
export const getPublishedSiteSettings = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		(
			await getPublishedContentState(
				ctx,
				siteUrl,
				SITE_SETTINGS_KIND,
				(payload) => toPublishedSiteSettings(asSiteSettingsPayload(payload)),
			)
		)?.payload ?? null,
});

/** Public-safe read with opaque revision metadata for provider observability. */
export const getPublishedSiteSettingsWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getPublishedContentState(
			ctx,
			siteUrl,
			SITE_SETTINGS_KIND,
			(payload) => toPublishedSiteSettings(asSiteSettingsPayload(payload)),
		),
});

/** Save an immutable revision while allowing incomplete draft content. */
export const saveSiteSettingsDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: siteSettingsDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		validateSiteSettingsDraft(args.payload);
		return await saveContentDraft(ctx, {
			...args,
			kind: SITE_SETTINGS_KIND,
			serializedPayload: serializeSiteSettingsPayload(args.payload),
		});
	},
});

/** Publish exactly the currently loaded draft, never a stale revision. */
export const publishSiteSettings = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await publishContentDraft(
			ctx,
			{ ...args, kind: SITE_SETTINGS_KIND },
			(payload) => toPublishedSiteSettings(asSiteSettingsPayload(payload)),
		),
});

/** Discard only the currently loaded unpublished pointer. History is immutable. */
export const discardSiteSettingsDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await discardContentDraft(ctx, { ...args, kind: SITE_SETTINGS_KIND }),
});

/** Authenticated state for Reflecting Pool's named Homepage Quote slot. */
export const getHomepageQuoteEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getContentEditorState(
			ctx,
			siteUrl,
			HOMEPAGE_QUOTE_KIND,
			asHomepageQuotePayload,
		),
});

/** Public-safe Homepage Quote with opaque revision metadata for providers. */
export const getPublishedHomepageQuoteWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getPublishedContentState(
			ctx,
			siteUrl,
			HOMEPAGE_QUOTE_KIND,
			(payload) => toPublishedHomepageQuote(asHomepageQuotePayload(payload)),
		),
});

/** Save incomplete Quote text safely without exposing the Homepage itself. */
export const saveHomepageQuoteDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: homepageQuoteDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		validateHomepageQuoteDraft(args.payload);
		return await saveContentDraft(ctx, {
			...args,
			kind: HOMEPAGE_QUOTE_KIND,
			serializedPayload: serializeHomepageQuotePayload(args.payload),
		});
	},
});

export const publishHomepageQuote = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await publishContentDraft(
			ctx,
			{ ...args, kind: HOMEPAGE_QUOTE_KIND },
			(payload) => toPublishedHomepageQuote(asHomepageQuotePayload(payload)),
		),
});

export const discardHomepageQuoteDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await discardContentDraft(ctx, { ...args, kind: HOMEPAGE_QUOTE_KIND }),
});
