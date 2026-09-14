import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublishedSiteSettings, type PublishedSiteSettings } from "./contentValidators";
import { getPublishedContentState } from "./contentStore";

type SiteSettingsCtx = QueryCtx | MutationCtx;
const PUBLIC_MEDIA_ORIGIN = "https://media.angelsrest.online";

/** Owner bylines follow published settings; private settings drafts never become public. */
export async function requirePublishedSiteOwnerAuthor(ctx: SiteSettingsCtx, siteUrl: string) {
	const state = await getPublishedContentState(ctx, siteUrl, "siteSettings", (payload) => {
		if (!("artistName" in payload)) throw new Error("Published Site Settings artist name is missing");
		return toPublishedSiteSettings(payload);
	});
	if (!state) throw new Error("Publish Site Settings before publishing an owner-authored Post");
	return { kind: "author" as const, name: state.payload.artistName, slug: "site-owner" };
}

export async function requireReadySiteSettingsOgImage(
	ctx: SiteSettingsCtx,
	siteUrl: string,
	assetId: Id<"mediaAssets"> | undefined,
) {
	if (!assetId) return null;
	const asset = await ctx.db.get(assetId);
	if (
		!asset
		|| asset.siteUrl !== siteUrl
		|| asset.intent !== "web"
		|| asset.status !== "ready"
		|| !asset.source.sha256
	) throw new Error("Site Settings SEO image requires a ready web asset from the same site");
	return asset;
}

export async function projectPublishedSiteSettings(
	ctx: QueryCtx,
	siteUrl: string,
	state: {
		revisionId: Id<"contentRevisions">;
		publishedAt: number;
		payload: PublishedSiteSettings;
	},
) {
	const asset = await requireReadySiteSettingsOgImage(
		ctx,
		siteUrl,
		state.payload.seoOgImageAssetId,
	);
	const { seoOgImageAssetId: _seoOgImageAssetId, ...payload } = state.payload;
	return {
		...state,
		payload: {
			...payload,
			...(asset
				? {
						seoOgImage: {
							url: `${PUBLIC_MEDIA_ORIGIN}/${asset.derivatives.display2048.key}`,
							assetId: asset.assetId,
							sourceSha256: asset.source.sha256,
						},
					}
				: {}),
		},
	};
}
