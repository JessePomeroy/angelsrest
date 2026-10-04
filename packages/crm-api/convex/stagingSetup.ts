import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { checksumContentPayload } from "./helpers/contentStore";
import { provisionClientAdmin } from "./helpers/provisionClientAdmin";
import { ensureTenantIdentity } from "./helpers/tenantContext";

const siteUrl = "angelsrest.online";
const email = "staging-admin@example.invalid";

function requireStaging() {
	if (process.env.CONVEX_SITE_URL !== "https://rosy-firefly-366.convex.site"
		|| process.env.SITE_URL !== "https://staging.angelsrest.online") {
		throw new Error("Staging setup requires its isolated deployment");
	}
}

/** Operator-only, one-time setup; a repeat never changes an existing credential. */
export const bootstrap = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ created: boolean; clientId: Id<"platformClients">; email: string }> => {
		requireStaging();
		const existing = await ctx.db.query("platformClients").take(2);
		if (existing.length) {
			if (existing.length !== 1 || existing[0].siteUrl !== siteUrl
				|| existing[0].email !== email || existing[0].role !== "creator"
				|| existing[0].adminIdentityIds?.length !== 1) {
				throw new Error("Staging is already populated; preserve its records");
			}
			return { created: false, clientId: existing[0]._id, email };
		}
		const passwordHash = process.env.STAGING_BOOTSTRAP_PASSWORD_HASH;
		if (!passwordHash) throw new Error("Staging bootstrap credential is unavailable");
		const { tokenIdentifier } = await provisionClientAdmin(ctx, {
			name: "Staging Administrator", email, passwordHash,
		});
		const clientId = await ctx.db.insert("platformClients", {
			siteUrl, name: "Angel's Rest staging", email, tier: "full", role: "creator",
			subscriptionStatus: "active", adminEmails: [email], adminIdentityIds: [tokenIdentifier],
			catalogProductKinds: ["merchandise"], notes: "Synthetic staging tenant. No production customer data.",
		});
		const client = await ctx.db.get(clientId);
		if (!client) throw new Error("Staging creator was not stored");
		await ensureTenantIdentity(ctx, client, "operator");
		return { created: true, clientId, email };
	},
});

/** Minimal synthetic content for the root layout; leaves operator edits intact. */
export const seedSiteSettings = internalMutation({
	args: {},
	handler: async (ctx) => {
		requireStaging();
		const existing = await ctx.db.query("contentDocuments")
			.withIndex("by_siteUrl_and_kind", q => q.eq("siteUrl", siteUrl).eq("kind", "siteSettings")).unique();
		if (existing) return { created: false };
		const now = Date.now();
		const author = "isolated-staging-setup";
		const audit = { createdAt: now, updatedAt: now, createdBy: author, updatedBy: author };
		const assetId = "00000000-0000-4000-8000-000000000001";
		const image = (filename: string) => ({
			key: `sites/${siteUrl}/web/${assetId}/${filename}`,
			contentType: "image/webp" as const, width: 1, height: 1,
		});
		// Placeholder metadata only. No object is uploaded to the shared media
		// Worker; this seed does not establish media-pipeline or SEO-image readiness.
		const seoOgImageAssetId = await ctx.db.insert("mediaAssets", {
			siteUrl, assetId, intent: "web", status: "ready", originalFilename: "synthetic-placeholder.webp",
			source: { contentType: "image/webp", sizeBytes: 1, width: 1, height: 1, sha256: "0".repeat(64) },
			master: { ...image("master.webp"), sizeBytes: 1 },
			derivatives: { thumb: image("thumb.webp"), card: image("card.webp"),
				display1280: image("display-1280.webp"), display2048: image("display-2048.webp"), display2560: image("display-2560.webp") },
			...audit,
		});
		const payload = { artistName: "Staging Administrator", siteTitle: "Angel's Rest staging",
			tagline: "Synthetic test data only", socialLinks: [],
			seoDescription: "Isolated staging environment for Angels Rest", seoOgImageAssetId };
		const documentId = await ctx.db.insert("contentDocuments", { siteUrl, kind: "siteSettings", ...audit });
		const revisionId = await ctx.db.insert("contentRevisions", {
			siteUrl, documentId, kind: "siteSettings", schemaVersion: 1, payload, source: "admin",
			checksum: await checksumContentPayload(JSON.stringify(payload)), createdAt: now, createdBy: author,
		});
		await ctx.db.patch(documentId, { publishedRevisionId: revisionId, publishedAt: now, publishedBy: author });
		return { created: true };
	},
});
