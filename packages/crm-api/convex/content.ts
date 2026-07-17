import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import {
	projectPublishedAboutPage,
	requireReadyAboutAssets,
} from "./helpers/aboutPageData";
import {
	projectPublishedModelingPage,
	requireReadyModelingAssets,
} from "./helpers/modelingPageData";
import {
	discardContentDraft,
	getContentEditorState,
	getPublishedContentState,
	publishContentDraft,
	saveContentDraft,
} from "./helpers/contentStore";
import {
	type AboutPageDraftPayload,
	aboutPageDraftPayloadValidator,
	type ContactPageDraftPayload,
	contactPageDraftPayloadValidator,
	type ContentRevisionPayload,
	type HomepageQuoteDraftPayload,
	homepageQuoteDraftPayloadValidator,
	type ModelingPageDraftPayload,
	modelingPageDraftPayloadValidator,
	serializeHomepageQuotePayload,
	serializeAboutPagePayload,
	sanitizeAboutPagePayload,
	serializeContactPagePayload,
	serializeSiteSettingsPayload,
	serializeModelingPagePayload,
	sanitizeModelingPagePayload,
	type SiteSettingsDraftPayload,
	siteSettingsDraftPayloadValidator,
	toPublishedHomepageQuote,
	toPublishedAboutPage,
	toPublishedContactPage,
	toPublishedSiteSettings,
	toPublishedModelingPage,
	validateHomepageQuoteDraft,
	validateAboutPageDraft,
	validateContactPageDraft,
	validateSiteSettingsDraft,
	validateModelingPageDraft,
} from "./helpers/contentValidators";

const SITE_SETTINGS_KIND = "siteSettings" as const;
const HOMEPAGE_QUOTE_KIND = "homepageQuote" as const;
const CONTACT_PAGE_KIND = "contactPage" as const;
const ABOUT_PAGE_KIND = "aboutPage" as const;
const MODELING_PAGE_KIND = "modelingPage" as const;

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

function asContactPagePayload(
	payload: ContentRevisionPayload,
): ContactPageDraftPayload {
	const narrowed = payload as ContactPageDraftPayload;
	validateContactPageDraft(narrowed);
	return narrowed;
}

function asAboutPagePayload(
	payload: ContentRevisionPayload,
): AboutPageDraftPayload {
	const narrowed = payload as AboutPageDraftPayload;
	validateAboutPageDraft(narrowed);
	return narrowed;
}

function asModelingPagePayload(
	payload: ContentRevisionPayload,
): ModelingPageDraftPayload {
	const narrowed = payload as ModelingPageDraftPayload;
	validateModelingPageDraft(narrowed);
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

/** Authenticated state for client-managed Contact & Booking content. */
export const getContactPageEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getContentEditorState(
			ctx,
			siteUrl,
			CONTACT_PAGE_KIND,
			asContactPagePayload,
		),
});

/** Public-safe Contact & Booking content with opaque provider metadata. */
export const getPublishedContactPageWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getPublishedContentState(
			ctx,
			siteUrl,
			CONTACT_PAGE_KIND,
			(payload) => toPublishedContactPage(asContactPagePayload(payload)),
		),
});

/** Save client-managed content only; operational form configuration is absent. */
export const saveContactPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: contactPageDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		validateContactPageDraft(args.payload);
		return await saveContentDraft(ctx, {
			...args,
			kind: CONTACT_PAGE_KIND,
			serializedPayload: serializeContactPagePayload(args.payload),
		});
	},
});

export const publishContactPage = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await publishContentDraft(
			ctx,
			{ ...args, kind: CONTACT_PAGE_KIND },
			(payload) => toPublishedContactPage(asContactPagePayload(payload)),
		),
});

export const discardContactPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await discardContentDraft(ctx, { ...args, kind: CONTACT_PAGE_KIND }),
});

/** Authenticated state for a site's designed About-page content. */
export const getAboutPageEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getContentEditorState(
			ctx,
			siteUrl,
			ABOUT_PAGE_KIND,
			asAboutPagePayload,
		),
});

/** Public-safe About content with ready web derivatives only. */
export const getPublishedAboutPageWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const state = await getPublishedContentState(
			ctx,
			siteUrl,
			ABOUT_PAGE_KIND,
			(payload) => toPublishedAboutPage(asAboutPagePayload(payload)),
		);
		return state ? await projectPublishedAboutPage(ctx, siteUrl, state) : null;
	},
});

/** Save incomplete copy while requiring every portrait reference to be tenant-owned. */
export const saveAboutPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: aboutPageDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		const payload = sanitizeAboutPagePayload(args.payload);
		validateAboutPageDraft(payload);
		const { client } = await requireSiteAdmin(ctx, args.siteUrl);
		await requireReadyAboutAssets(
			ctx,
			client.siteUrl,
			payload.portraits ?? [],
		);
		return await saveContentDraft(ctx, {
			...args,
			payload,
			kind: ABOUT_PAGE_KIND,
			serializedPayload: serializeAboutPagePayload(payload),
		});
	},
});

export const publishAboutPage = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => {
		const { client } = await requireSiteAdmin(ctx, args.siteUrl);
		const revision = await ctx.db.get(args.draftRevisionId);
		if (!revision) throw new Error("About draft revision not found");
		const payload = asAboutPagePayload(revision.payload);
		const published = toPublishedAboutPage(payload);
		await requireReadyAboutAssets(
			ctx,
			client.siteUrl,
			published.portraits,
		);
		return await publishContentDraft(
			ctx,
			{ ...args, kind: ABOUT_PAGE_KIND },
			(candidate) => toPublishedAboutPage(asAboutPagePayload(candidate)),
		);
	},
});

export const discardAboutPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await discardContentDraft(ctx, { ...args, kind: ABOUT_PAGE_KIND }),
});

/** Authenticated state for the site's ordered Modeling categories. */
export const getModelingPageEditorState = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await getContentEditorState(
			ctx,
			siteUrl,
			MODELING_PAGE_KIND,
			asModelingPagePayload,
		),
});

/** Public-safe Modeling content with ready responsive derivatives only. */
export const getPublishedModelingPageWithRevision = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const state = await getPublishedContentState(
			ctx,
			siteUrl,
			MODELING_PAGE_KIND,
			(payload) => toPublishedModelingPage(asModelingPagePayload(payload)),
		);
		return state
			? await projectPublishedModelingPage(ctx, siteUrl, state)
			: null;
	},
});

/** Save bounded, incomplete Modeling drafts with tenant-owned media only. */
export const saveModelingPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		payload: modelingPageDraftPayloadValidator,
	},
	handler: async (ctx, args) => {
		const payload = sanitizeModelingPagePayload(args.payload);
		validateModelingPageDraft(payload);
		const { client } = await requireSiteAdmin(ctx, args.siteUrl);
		await requireReadyModelingAssets(
			ctx,
			client.siteUrl,
			payload.galleries ?? [],
		);
		return await saveContentDraft(ctx, {
			...args,
			payload,
			kind: MODELING_PAGE_KIND,
			serializedPayload: serializeModelingPagePayload(payload),
		});
	},
});

export const publishModelingPage = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => {
		const { client } = await requireSiteAdmin(ctx, args.siteUrl);
		const revision = await ctx.db.get(args.draftRevisionId);
		if (!revision) throw new Error("Modeling draft revision not found");
		const payload = asModelingPagePayload(revision.payload);
		const published = toPublishedModelingPage(payload);
		await requireReadyModelingAssets(
			ctx,
			client.siteUrl,
			published.galleries,
		);
		return await publishContentDraft(
			ctx,
			{ ...args, kind: MODELING_PAGE_KIND },
			(candidate) =>
				toPublishedModelingPage(asModelingPagePayload(candidate)),
		);
	},
});

export const discardModelingPageDraft = mutation({
	args: {
		siteUrl: v.string(),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) =>
		await discardContentDraft(ctx, { ...args, kind: MODELING_PAGE_KIND }),
});
