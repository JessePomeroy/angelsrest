import {
	createDraftPreviewHandler,
	DRAFT_PREVIEW_QUERY,
	type DraftPreviewInput,
	type DraftPreviewKind,
	readDraftPreview,
} from "@jessepomeroy/admin/server/draft-preview";
import { type Cookies, error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import type { Id, TableNames } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { requireAuthWithIdentity } from "./adminAuth";
import { adaptConvexPrintSet, adaptConvexProduct } from "./convexShopAdapter";
import { adaptConvexAboutContact } from "./current/aboutContactContent.server";
import { adaptConvexPortfolioDetail } from "./current/portfolioContent.server";
import { adaptConvexSiteSettings } from "./current/siteSettingsContent.server";
import { getConvexUrl } from "./runtimeConfig";
import { getSiteAdminAccess } from "./siteAdminAuthorization";

async function requirePreviewAdmin(cookies: Cookies) {
	const { token, identity } = await requireAuthWithIdentity(cookies);
	const access = identity.email ? await getSiteAdminAccess(token, identity.email) : null;
	if (!access?.authorized) error(403, "Site access is required.");
	return token;
}

function previewClient(token: string) {
	const signal = AbortSignal.timeout(6_000);
	const client = new ConvexHttpClient(getConvexUrl(), {
		logger: false,
		fetch: (input, init) => fetch(input, { ...init, signal }),
	});
	client.setAuth(token);
	return client;
}

// Convex validates that each branded ID belongs to its declared table.
function previewId<T extends TableNames>(value: string | undefined): Id<T> {
	if (!value || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error("Missing preview identity");
	return value as Id<T>;
}

async function readDraft(
	client: ConvexHttpClient,
	kind: DraftPreviewKind,
	input: DraftPreviewInput,
) {
	const siteUrl = SITE_DOMAIN;
	switch (kind) {
		case "settings":
			return {
				kind,
				value: await client.query(api.content.getSiteSettingsDraftPreview, {
					siteUrl,
					draftRevisionId: previewId<"contentRevisions">(input.draftRevisionId),
				}),
				path: "/",
				editorHref: "/admin/editor",
			};
		case "about":
			return {
				kind,
				value: await client.query(api.content.getAboutPageDraftPreview, {
					siteUrl,
					draftRevisionId: previewId<"contentRevisions">(input.draftRevisionId),
				}),
				path: "/about",
				editorHref: "/admin/editor/pages/about",
			};
		case "contact":
			return {
				kind,
				value: await client.query(api.content.getContactPageDraftPreview, {
					siteUrl,
					draftRevisionId: previewId<"contentRevisions">(input.draftRevisionId),
				}),
				path: "/about",
				editorHref: "/admin/editor/pages/contact",
			};
		case "portfolio": {
			const galleryId = previewId<"portfolioGalleries">(input.galleryId);
			const value = await client.query(api.portfolioGalleries.getDraftPreview, {
				siteUrl,
				galleryId,
				draftRevisionId: previewId<"portfolioGalleryRevisions">(input.draftRevisionId),
			});
			return {
				kind,
				value,
				resourceId: galleryId,
				path: `/gallery/${value.slug}`,
				editorHref: `/admin/editor/portfolio/${galleryId}`,
			};
		}
		case "product": {
			const productId = previewId<"catalogProducts">(input.productId);
			const value = await client.query(api.catalogProductGraphs.getDraftPreview, {
				siteUrl,
				productId,
				draftRevisionId: previewId<"catalogProductRevisions">(input.draftRevisionId),
			});
			const prefix = value.productKind === "print_set" ? "/shop/sets/" : "/shop/";
			return {
				kind,
				value,
				resourceId: productId,
				path: `${prefix}${value.slug}`,
				editorHref: `/admin/editor/products/${productId}`,
			};
		}
	}
}

export const createPreview = createDraftPreviewHandler({
	siteUrl: SITE_DOMAIN,
	requireSiteAdmin: requirePreviewAdmin,
	resolve: async (kind, input, token) => {
		const draft = await readDraft(previewClient(token), kind, input);
		return {
			kind,
			revisionId: input.draftRevisionId,
			path: draft.path,
			resourceId: "resourceId" in draft ? draft.resourceId : undefined,
		};
	},
});

export async function loadDraftPreview(url: URL, cookies: Cookies) {
	if (!url.searchParams.has(DRAFT_PREVIEW_QUERY)) return null;
	const token = await requirePreviewAdmin(cookies);
	try {
		const target = await readDraftPreview(url, SITE_DOMAIN, token);
		const client = previewClient(token);
		const draft = await readDraft(client, target.kind, {
			draftRevisionId: target.revisionId,
			...(target.kind === "portfolio" ? { galleryId: target.resourceId } : {}),
			...(target.kind === "product" ? { productId: target.resourceId } : {}),
		});
		if (draft.path !== target.path) throw new Error("Draft path changed");
		const context = { editorHref: draft.editorHref };
		switch (draft.kind) {
			case "settings":
				return {
					...context,
					kind: draft.kind,
					siteSettings: adaptConvexSiteSettings({
						revisionId: target.revisionId,
						publishedAt: 0,
						payload: draft.value,
					}),
				};
			case "about":
			case "contact": {
				const published = await client.query(api.content.getPublishedAboutContactWithRevisions, {
					siteUrl: SITE_DOMAIN,
				});
				return {
					...context,
					kind: draft.kind,
					content: adaptConvexAboutContact({
						...published,
						[draft.kind]: draft.value,
					}),
				};
			}
			case "portfolio":
				// Visibility remains unchanged in storage; hidden drafts must still render privately.
				return {
					...context,
					kind: draft.kind,
					gallery: adaptConvexPortfolioDetail({ ...draft.value, isVisible: true }),
				};
			case "product": {
				const product =
					draft.value.productKind === "print_set"
						? adaptConvexPrintSet(draft.value)
						: adaptConvexProduct(draft.value);
				if (!product) throw new Error("Unsupported preview product");
				return { ...context, kind: draft.kind, product };
			}
		}
	} catch {
		error(409, "This draft preview expired or changed. Open a new preview from the editor.");
	}
}
