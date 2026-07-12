import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireDocumentSiteAdmin } from "./authHelpers";

const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const ACCESS_GRANT_MS = 12 * 60 * 60 * 1000;

export const getChallenge = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (
			!tokenDoc ||
			tokenDoc.type !== "gallery" ||
			tokenDoc.used ||
			(tokenDoc.expiresAt !== undefined && tokenDoc.expiresAt <= Date.now())
		) return null;

		const galleryId = ctx.db.normalizeId("galleries", tokenDoc.documentId);
		if (!galleryId) return null;
		const gallery = await ctx.db.get(galleryId);
		if (!gallery || gallery.siteUrl !== tokenDoc.siteUrl || gallery.status !== "published") {
			return null;
		}
		const verifier = await ctx.db
			.query("galleryPasswordVerifiers")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.unique();
		const attempts = await ctx.db
			.query("galleryPasswordAttempts")
			.withIndex("by_portalToken", (q) => q.eq("portalTokenId", tokenDoc._id))
			.unique();
		return { token: tokenDoc, gallery, verifier, attempts };
	},
});

export const setVerifier = internalMutation({
	args: {
		galleryId: v.id("galleries"),
		siteUrl: v.string(),
		verifier: v.union(
			v.null(),
			v.object({
				algorithm: v.literal("scrypt"),
				salt: v.string(),
				hash: v.string(),
				cost: v.number(),
				blockSize: v.number(),
				parallelization: v.number(),
				keyLength: v.number(),
				version: v.string(),
			}),
		),
	},
	handler: async (ctx, { galleryId, siteUrl, verifier }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "galleries", galleryId);
		if (gallery.siteUrl !== siteUrl) throw new Error("Gallery not found");
		const existing = await ctx.db
			.query("galleryPasswordVerifiers")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.unique();
		if (!verifier) {
			if (existing) await ctx.db.delete(existing._id);
			return { passwordProtected: false };
		}
		const value = { ...verifier, galleryId, siteUrl, updatedAt: Date.now() };
		if (existing) await ctx.db.replace(existing._id, value);
		else await ctx.db.insert("galleryPasswordVerifiers", value);
		return { passwordProtected: true };
	},
});

export const recordFailure = internalMutation({
	args: { portalTokenId: v.id("portalTokens") },
	handler: async (ctx, { portalTokenId }) => {
		const now = Date.now();
		const existing = await ctx.db
			.query("galleryPasswordAttempts")
			.withIndex("by_portalToken", (q) => q.eq("portalTokenId", portalTokenId))
			.unique();
		const withinWindow = existing && now - existing.windowStartedAt < FAILURE_WINDOW_MS;
		const failures = withinWindow ? existing.failures + 1 : 1;
		const value = {
			portalTokenId,
			failures,
			windowStartedAt: withinWindow ? existing.windowStartedAt : now,
			lockedUntil: failures >= MAX_FAILURES ? now + LOCKOUT_MS : undefined,
		};
		if (existing) await ctx.db.replace(existing._id, value);
		else await ctx.db.insert("galleryPasswordAttempts", value);
		return { lockedUntil: value.lockedUntil };
	},
});

export const createGrant = internalMutation({
	args: {
		token: v.string(),
		grant: v.string(),
		verifierVersion: v.string(),
	},
	handler: async (ctx, { token, grant, verifierVersion }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (
			!tokenDoc ||
			tokenDoc.type !== "gallery" ||
			tokenDoc.used ||
			(tokenDoc.expiresAt !== undefined && tokenDoc.expiresAt <= Date.now())
		) {
			throw new Error("Invalid gallery link");
		}
		const galleryId = ctx.db.normalizeId("galleries", tokenDoc.documentId);
		if (!galleryId) throw new Error("Invalid gallery link");
		const gallery = await ctx.db.get(galleryId);
		const verifier = await ctx.db
			.query("galleryPasswordVerifiers")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.unique();
		if (
			!gallery ||
			gallery.siteUrl !== tokenDoc.siteUrl ||
			gallery.status !== "published" ||
			!verifier ||
			verifier.version !== verifierVersion
		) throw new Error("Gallery password changed; try again");

		const expiresAt = Math.min(
			Date.now() + ACCESS_GRANT_MS,
			tokenDoc.expiresAt ?? Number.MAX_SAFE_INTEGER,
		);
		await ctx.db.insert("galleryAccessGrants", {
			grant,
			galleryId,
			portalTokenId: tokenDoc._id,
			siteUrl: gallery.siteUrl,
			verifierVersion,
			expiresAt,
		});
		const attempts = await ctx.db
			.query("galleryPasswordAttempts")
			.withIndex("by_portalToken", (q) => q.eq("portalTokenId", tokenDoc._id))
			.unique();
		if (attempts) await ctx.db.delete(attempts._id);
		return { accessGrant: grant, expiresAt };
	},
});
