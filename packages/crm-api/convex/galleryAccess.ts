import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

export async function hasValidGalleryAccessGrant(
	ctx: DatabaseCtx,
	token: Doc<"portalTokens">,
	gallery: Doc<"galleries">,
	accessGrant?: string,
) {
	const verifier = await ctx.db
		.query("galleryPasswordVerifiers")
		.withIndex("by_gallery", (q) => q.eq("galleryId", gallery._id))
		.unique();
	if (!verifier) return { passwordProtected: false, valid: true } as const;
	if (!accessGrant) return { passwordProtected: true, valid: false } as const;

	const grant = await ctx.db
		.query("galleryAccessGrants")
		.withIndex("by_grant", (q) => q.eq("grant", accessGrant))
		.unique();
	const valid =
		grant !== null &&
		grant.galleryId === gallery._id &&
		grant.portalTokenId === token._id &&
		grant.siteUrl === gallery.siteUrl &&
		grant.verifierVersion === verifier.version &&
		grant.expiresAt > Date.now();
	return { passwordProtected: true, valid } as const;
}

export async function requireGalleryAccessGrant(
	ctx: DatabaseCtx,
	token: Doc<"portalTokens">,
	gallery: Doc<"galleries">,
	accessGrant?: string,
) {
	const access = await hasValidGalleryAccessGrant(ctx, token, gallery, accessGrant);
	if (!access.valid) throw new Error("Gallery password required");
}
