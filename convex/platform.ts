import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth, requireWebhookCallerOrAuth } from "./authHelpers";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";

export const checkTier = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.first();

		if (!client) {
			return { tier: "basic" as const, subscriptionStatus: "none" as const };
		}

		return {
			tier: client.tier,
			subscriptionStatus: client.subscriptionStatus,
			siteName: client.name,
		};
	},
});

export const listAll = query({
	handler: async (ctx) => {
		await requireAuth(ctx);
		return await ctx.db.query("platformClients").order("desc").take(DEFAULT_LIST_LIMIT);
	},
});

/**
 * Look up a platform client by Stripe subscription ID. Called by the
 * platform Stripe webhook with the shared `webhookSecret`; rejected
 * otherwise. Audit C5.
 */
export const getBySubscriptionId = query({
	args: {
		subscriptionId: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { subscriptionId, webhookSecret }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret);
		return await ctx.db
			.query("platformClients")
			.withIndex("by_stripeSubscriptionId", (q) =>
				q.eq("stripeSubscriptionId", subscriptionId),
			)
			.first();
	},
});

export const createClient = mutation({
	args: {
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		sanityProjectId: v.optional(v.string()),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		adminEmails: v.array(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("platformClients", args);
	},
});

/**
 * Flip a site's subscription tier. Called by the platform Stripe webhook
 * with the shared `webhookSecret`; rejected otherwise. Audit C5.
 */
export const updateSubscription = mutation({
	args: {
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		stripeCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret);
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", args.siteUrl))
			.first();

		if (!client) return;

		const patch: Record<string, unknown> = {
			tier: args.tier,
			subscriptionStatus: args.subscriptionStatus,
		};
		if (args.stripeCustomerId) patch.stripeCustomerId = args.stripeCustomerId;
		if (args.stripeSubscriptionId)
			patch.stripeSubscriptionId = args.stripeSubscriptionId;

		await ctx.db.patch(client._id, patch);
	},
});

export const updateClient = mutation({
	args: {
		clientId: v.id("platformClients"),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		siteUrl: v.optional(v.string()),
		sanityProjectId: v.optional(v.string()),
		tier: v.optional(v.union(v.literal("basic"), v.literal("full"))),
		subscriptionStatus: v.optional(
			v.union(
				v.literal("active"),
				v.literal("canceled"),
				v.literal("past_due"),
				v.literal("none"),
			),
		),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, { clientId, ...updates }) => {
		await requireAuth(ctx);
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(clientId, patch);
		}
	},
});

/**
 * Ensure a `platformClients` row exists in a state that `requireSiteAdmin`
 * will accept: the stored `siteUrl` matches the bare domain the admin
 * dashboard passes, and `adminEmails` includes the given email.
 *
 * Why this isn't a regular `mutation`: it mutates tenant-admin membership,
 * so we don't want it callable from the browser — not even by an authed
 * user, because the check we'd write would be circular ("you're an admin
 * if you say you're an admin"). `internalMutation` means it's only
 * callable via the Convex CLI with the deploy key (`npx convex run` /
 * `npx convex run --prod`), which is the right surface for operational
 * bootstrap. See audit note 2026-04-23 for the root-cause context: the
 * `adminEmails: []` state has silently blocked every `requireSiteAdmin`
 * caller since commit b572081.
 *
 * The function is idempotent — safe to re-run. It also normalizes
 * `https://example.com` and `https://www.example.com` stored forms down
 * to the bare `example.com` that the app actually sends on the wire.
 *
 * Usage:
 *   npx convex run         platform:ensureSiteAdmin '{"siteUrl":"angelsrest.online","adminEmail":"thinkingofview@gmail.com"}'
 *   npx convex run --prod  platform:ensureSiteAdmin '{"siteUrl":"angelsrest.online","adminEmail":"thinkingofview@gmail.com"}'
 */
export const ensureSiteAdmin = internalMutation({
	args: {
		siteUrl: v.string(),
		adminEmail: v.string(),
	},
	handler: async (ctx, { siteUrl, adminEmail }) => {
		// Look up by the bare siteUrl first, then fall back to the legacy
		// scheme-prefixed forms so we can migrate rows created before we
		// standardized the key.
		const candidates = [
			siteUrl,
			`https://${siteUrl}`,
			`https://www.${siteUrl}`,
		];
		let row = null;
		for (const candidate of candidates) {
			row = await ctx.db
				.query("platformClients")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", candidate))
				.first();
			if (row) break;
		}
		if (!row) {
			throw new Error(
				`No platformClients row found for siteUrl="${siteUrl}" (also tried https:// variants). Create it via platform.createClient first.`,
			);
		}

		const patch: Record<string, unknown> = {};
		if (row.siteUrl !== siteUrl) {
			patch.siteUrl = siteUrl;
		}
		const alreadyPresent = row.adminEmails
			.map((e) => e.toLowerCase())
			.includes(adminEmail.toLowerCase());
		if (!alreadyPresent) {
			patch.adminEmails = [...row.adminEmails, adminEmail];
		}

		if (Object.keys(patch).length === 0) {
			return {
				changed: false,
				row: { id: row._id, siteUrl: row.siteUrl, adminEmails: row.adminEmails },
			};
		}

		await ctx.db.patch(row._id, patch);
		return {
			changed: true,
			patch,
			before: { siteUrl: row.siteUrl, adminEmails: row.adminEmails },
			id: row._id,
		};
	},
});

/**
 * Rename the `siteUrl` on a platformClients row — used when a client's
 * domain is decided (or changed) after the row was created with a stub
 * (e.g. reflecting-pool.com → zippymiggy.com).
 *
 * Internal-only: callable via `npx convex run platform:renameClientSiteUrl
 * '{"fromSiteUrl":"old","toSiteUrl":"new"}'`. Idempotent — errors if there's
 * already a row at `toSiteUrl` (avoids silent merges). Callers responsible
 * for running `ensureSiteAdmin` afterwards if they also need to update
 * adminEmails.
 */
export const renameClientSiteUrl = internalMutation({
	args: {
		fromSiteUrl: v.string(),
		toSiteUrl: v.string(),
	},
	handler: async (ctx, { fromSiteUrl, toSiteUrl }) => {
		const row = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", fromSiteUrl))
			.first();
		if (!row) {
			throw new Error(`No platformClients row with siteUrl="${fromSiteUrl}"`);
		}
		const collision = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", toSiteUrl))
			.first();
		if (collision) {
			throw new Error(
				`A platformClients row already exists at siteUrl="${toSiteUrl}" (id=${collision._id}). Delete one before renaming.`,
			);
		}
		await ctx.db.patch(row._id, { siteUrl: toSiteUrl });
		return { id: row._id, from: fromSiteUrl, to: toSiteUrl };
	},
});
