import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { isSiteAdminIdentity, requireAuth, requireCreator, requirePlatformAdmin, requireWebhookCallerOrAuth } from "./authHelpers";
import {
	catalogProductKindsValidator,
	normalizeCatalogProductKinds,
} from "./helpers/catalogProductPolicy";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";
import { provisionClientAdmin } from "./helpers/provisionClientAdmin";
import { normalizePlatformClientInput, PLATFORM_CLIENT_SITE_IN_USE } from "./helpers/platformClientInput";
import { requireClientPaymentBinding } from "./helpers/clientPaymentReadiness";
import {
	assertLumaPrintsConnection,
	lumaprintsConnectionFields,
	resolveLumaPrintsConnection,
} from "./helpers/lumaprintsConnection";
import { resolveStripeAccountOwner } from "./helpers/stripeAccountOwnership";
import {
	requireCurrentStripeConnectBinding,
	projectStripeConnectStatus,
	STRIPE_STATUS_REFRESH_MAX_AGE_MS,
	stripeConnectStatusResultValidator,
	stripeConnectStatusTargetArgs,
} from "./helpers/stripeConnectStatus";
import {
	ensureTenantAliases,
	ensureTenantIdentity,
	resolveTenantContext,
} from "./helpers/tenantContext";

async function assertSiteUrlAvailable(
	ctx: MutationCtx,
	siteUrl: string,
	clientId?: Id<"platformClients">,
) {
	const owner = await resolveTenantContext(ctx, { siteUrl });
	if (owner && owner.client._id !== clientId) {
		throw new ConvexError(PLATFORM_CLIENT_SITE_IN_USE);
	}
}

export const checkTier = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();

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
	args: {},
	handler: async (ctx) => {
		await requirePlatformAdmin(ctx);
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
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requirePlatformAdmin(ctx);
		}
		return await ctx.db
			.query("platformClients")
			.withIndex("by_stripeSubscriptionId", (q) =>
				q.eq("stripeSubscriptionId", subscriptionId),
			)
			.first();
	},
});

/**
 * Resolve the Stripe Connect account for a tenant checkout. This is safe for
 * customer checkout routes to call without admin auth: the connected-account
 * id is routing metadata, not a secret, and Stripe still requires the server
 * secret key to create sessions.
 */
export const getStripeAccountForSite = query({
	args: {
		siteUrl: v.string(),
	},
	handler: async (ctx, { siteUrl }) => {
		const client = (await resolveTenantContext(ctx, { siteUrl }))?.client;
		if (!client) return null;
		return {
			tenantId: client.tenantId,
			siteUrl: client.siteUrl,
			name: client.name,
			stripeConnectedAccountId: client.stripeConnectedAccountId,
		};
	},
});

/**
 * Resolve a tenant from a Stripe Connect event account id. Called by the
 * platform Stripe webhook after signature verification, with the shared
 * webhook secret passed through to Convex.
 * Historical ownership survives a changed active account. Keep provider reads
 * scoped to the event's account; use getStripeAccountForSite for new checkout.
 */
export const getByStripeConnectedAccountId = query({
	args: {
		stripeConnectedAccountId: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { stripeConnectedAccountId, webhookSecret }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requirePlatformAdmin(ctx);
		}
		return await resolveStripeAccountOwner(ctx, stripeConnectedAccountId);
	},
});

/**
 * Resolve the minimal notification identity for a server-verified commerce
 * event whose tenant is carried in Stripe metadata rather than `event.account`.
 * Admin recipients stay behind the shared webhook/auth boundary.
 */
export const getCommerceProfileForSite = query({
	args: {
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, webhookSecret }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requirePlatformAdmin(ctx);
		}

		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) return null;

		return {
			tenantId: client.tenantId,
			siteName: client.name || client.siteUrl,
			siteUrl: client.siteUrl,
			adminEmail: client.adminEmails[0] || client.email,
		};
	},
});

/** Server-authorized routing lookup. Tenant identity is not an auth credential. */
export const getTenantRoutingContext = query({
	args: {
		tenantId: v.optional(v.string()),
		siteUrl: v.optional(v.string()),
		origin: v.optional(v.string()),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { tenantId, siteUrl, origin, webhookSecret }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") await requirePlatformAdmin(ctx);
		const references = [tenantId, siteUrl, origin].filter(
			(value) => value !== undefined,
		);
		if (references.length !== 1) {
			throw new Error("Provide exactly one tenantId, siteUrl, or origin");
		}
		const context = await resolveTenantContext(
			ctx,
			tenantId !== undefined
				? { tenantId }
				: siteUrl !== undefined
					? { siteUrl }
					: { origin: origin as string },
		);
		if (!context) return null;
		return {
			tenantId: context.tenantId,
			siteUrl: context.siteUrl,
			siteName: context.client.name,
			resolvedBy: context.resolvedBy,
		};
	},
});

export const createClient = mutation({
	args: {
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		adminEmails: v.array(v.string()),
		role: v.optional(v.union(v.literal("creator"), v.literal("client"))),
		stripeConnectedAccountId: v.optional(v.string()),
		catalogProductKinds: v.optional(catalogProductKindsValidator),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requirePlatformAdmin(ctx);
		if (args.stripeConnectedAccountId !== undefined) {
			throw new Error("Stripe accounts must be bound through verified onboarding");
		}
		const identity = normalizePlatformClientInput(args);
		await assertSiteUrlAvailable(ctx, identity.siteUrl);
		const { catalogProductKinds, ...client } = args;
		const id = await ctx.db.insert("platformClients", {
			...client,
			...identity,
			role: args.role ?? "client",
			catalogProductKinds: normalizeCatalogProductKinds(
				catalogProductKinds ?? [],
			),
		});
		const stored = await ctx.db.get(id);
		if (!stored) throw new Error("Created tenant could not be read back");
		await ensureTenantIdentity(ctx, stored, "platform_client_site_url");
		return id;
	},
});

/** Operator-only provisioning. Tenant, credential and membership commit together. */
export const createClientWithAdmin = mutation({
	args: {
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		tier: v.union(v.literal("basic"), v.literal("full")),
		passwordHash: v.string(),
	},
	returns: v.object({ clientId: v.id("platformClients"), passwordCreated: v.boolean() }),
	handler: async (ctx, args): Promise<{ clientId: Id<"platformClients">; passwordCreated: boolean }> => {
		await requirePlatformAdmin(ctx);
		const identity = normalizePlatformClientInput({ ...args, adminEmails: [args.email] });
		const clientId: Id<"platformClients"> = await ctx.runMutation(api.platform.createClient, {
			...identity,
			tier: args.tier,
			subscriptionStatus: "none",
			role: "client",
		});
		const tokenIdentifier = await provisionClientAdmin(ctx, { ...identity, passwordHash: args.passwordHash });
		if (tokenIdentifier) await ctx.db.patch(clientId, { adminIdentityIds: [tokenIdentifier] });
		return { clientId, passwordCreated: tokenIdentifier !== null };
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
		const auth = await requireWebhookCallerOrAuth(ctx, args.webhookSecret);
		if (auth.via === "auth") {
			await requirePlatformAdmin(ctx);
		}
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", args.siteUrl))
			.unique();

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
		tier: v.optional(v.union(v.literal("basic"), v.literal("full"))),
		role: v.optional(v.union(v.literal("creator"), v.literal("client"))),
		subscriptionStatus: v.optional(
			v.union(
				v.literal("active"),
				v.literal("canceled"),
				v.literal("past_due"),
				v.literal("none"),
			),
		),
		stripeConnectedAccountId: v.optional(v.string()),
		catalogProductKinds: v.optional(catalogProductKindsValidator),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, { clientId, catalogProductKinds, ...updates }) => {
		await requirePlatformAdmin(ctx);
		const client = await ctx.db.get(clientId);
		if (!client) throw new Error("Platform client not found");
		if (
			updates.stripeConnectedAccountId !== undefined &&
			updates.stripeConnectedAccountId !== client.stripeConnectedAccountId
		) {
			throw new Error("Stripe accounts must be bound through verified onboarding");
		}
		if (updates.siteUrl !== undefined) {
			await assertSiteUrlAvailable(ctx, updates.siteUrl, clientId);
			const { tenantId } = await ensureTenantIdentity(
				ctx,
				client,
				"platform_client_site_url",
			);
			await ensureTenantAliases(
				ctx,
				tenantId,
				clientId,
				updates.siteUrl,
				"platform_client_site_url",
			);
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (catalogProductKinds !== undefined) {
			patch.catalogProductKinds = normalizeCatalogProductKinds(catalogProductKinds);
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(clientId, patch);
		}
	},
});

/** Retired raw assignment endpoint. Old hosts must fail closed during adoption. */
export const updateStripeConnectedAccount = mutation({
	args: {
		siteUrl: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
	},
	handler: async (ctx) => {
		await requirePlatformAdmin(ctx);
		throw new Error("Stripe accounts must be bound through verified onboarding");
	},
});

/** Creator-only target resolution before the host reads supplier credentials or calls the provider. */
export const getLumaPrintsSetupTarget = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		try {
			await requireCreator(ctx);
		} catch (cause) {
			if (cause instanceof Error && ["Not authenticated", "Not authorized (not a creator)"].includes(cause.message)) {
				throw new ConvexError("LUMAPRINTS_SETUP_FORBIDDEN");
			}
			throw cause;
		}
		const target = await resolveTenantContext(ctx, { siteUrl });
		if (!target || target.client.role === "creator" || target.client.siteUrl === "angelsrest.online") {
			throw new ConvexError("LUMAPRINTS_SETUP_NOT_CLIENT");
		}
		const { client, tenantId } = target;
		if (!tenantId) throw new ConvexError("LUMAPRINTS_SETUP_IDENTITY_UNAVAILABLE");
		const current = client.lumaprintsConnectionRef
			? await resolveLumaPrintsConnection(ctx, client.lumaprintsConnectionRef) : null;
		if (client.lumaprintsConnectionRef && (!current || current.owner._id !== client._id || current.context.tenantId !== tenantId)) {
			throw new Error("Current LumaPrints connection is inconsistent");
		}
		const history = await ctx.db.query("lumaprintsConnections")
			.withIndex("by_clientId", q => q.eq("clientId", client._id)).take(1);
		return {
			clientId: client._id, tenantId, siteUrl: client.siteUrl, name: client.name,
			connection: current?.context ?? null, hasHistory: history.length > 0,
		};
	},
});

/** Host verifies the store and obtains operator account/billing confirmation before calling. */
export const registerVerifiedLumaPrintsConnection = mutation({
	args: {
		clientId: v.id("platformClients"),
		tenantId: v.optional(v.string()),
		connectionRef: v.string(),
		storeId: v.number(),
		environment: lumaprintsConnectionFields.environment,
		accountOwnershipConfirmed: v.literal(true),
		billingConfirmed: v.literal(true),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		await requireCreator(ctx);
		const client = await ctx.db.get(args.clientId);
		if (!client) throw new Error("Platform client not found");
		const { tenantId } = await ensureTenantIdentity(ctx, client, "platform_client_site_url");
		if (args.tenantId !== undefined && args.tenantId !== tenantId) {
			throw new Error("LumaPrints setup tenant changed during verification");
		}
		if ((await resolveTenantContext(ctx, { tenantId }))?.client._id !== client._id) {
			throw new Error("LumaPrints tenant ownership is inconsistent");
		}
		const context = {
			version: 1 as const, connectionRef: args.connectionRef, tenantId,
			storeId: args.storeId, environment: args.environment,
		};
		assertLumaPrintsConnection(context);
		const existing = await resolveLumaPrintsConnection(ctx, args.connectionRef);
		if (existing) {
			if (existing.owner._id !== client._id || existing.context.tenantId !== tenantId
				|| existing.context.storeId !== context.storeId || existing.context.environment !== context.environment) {
				throw new Error("LumaPrints connection is already bound to another identity");
			}
			if (client.lumaprintsConnectionRef !== args.connectionRef) {
				throw new Error("Historical LumaPrints connections cannot be reactivated by setup");
			}
			return existing.context;
		}
		const history = await ctx.db.query("lumaprintsConnections")
			.withIndex("by_clientId", q => q.eq("clientId", client._id)).take(1);
		if (client.lumaprintsConnectionRef !== undefined || history.length > 0) {
			throw new Error("LumaPrints connection replacement requires operator review");
		}
		const now = Date.now();
		await ctx.db.insert("lumaprintsConnections", {
			...context, clientId: client._id, storeVerifiedAt: now,
			accountOwnershipConfirmedAt: now, billingConfirmedAt: now,
		});
		await ctx.db.patch(client._id, { lumaprintsConnectionRef: context.connectionRef });
		return context;
	},
});

/** Current supplier selection, for a hub-authenticated tenant workflow. No central fallback. */
export const getLumaPrintsConnectionForSite = query({
	args: { siteUrl: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const tenant = await resolveTenantContext(ctx, { siteUrl: args.siteUrl });
		const reference = tenant?.client.lumaprintsConnectionRef;
		if (!reference) return null;
		const resolved = await resolveLumaPrintsConnection(ctx, reference);
		if (!resolved || resolved.owner._id !== tenant?.client._id || resolved.context.tenantId !== tenant.tenantId) {
			throw new Error("Current LumaPrints connection is inconsistent");
		}
		return resolved.context;
	},
});

/** Historical connection identity for pinned work and authenticated provider intake. */
export const getLumaPrintsConnectionByRef = query({
	args: { connectionRef: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		return (await resolveLumaPrintsConnection(ctx, args.connectionRef))?.context ?? null;
	},
});

function assertStripeConnectClient(client: Doc<"platformClients"> | null) {
	if (!client) throw new Error("Platform client not found");
	if (client.role === "creator" || client.siteUrl === "angelsrest.online") {
		throw new Error("The platform's own account does not use client onboarding");
	}
	return client;
}

async function requireStripeConnectClient(
	ctx: QueryCtx,
	reference: { siteUrl: string } | { clientId: Id<"platformClients"> },
) {
	const identity = await requireAuth(ctx);
	const client = assertStripeConnectClient("clientId" in reference
		? await ctx.db.get(reference.clientId)
		: (await resolveTenantContext(ctx, { siteUrl: reference.siteUrl }))?.client ?? null);
	if (!isSiteAdminIdentity(identity, client)) {
		try {
			await requirePlatformAdmin(ctx);
		} catch (cause) {
			if (cause instanceof Error && cause.message === "Not authorized (not a creator)") {
				throw new ConvexError("STRIPE_CONNECT_FORBIDDEN");
			}
			throw cause;
		}
	}
	return client;
}

/** Authorize the exact client before the host contacts Stripe. */
export const getStripeConnectTarget = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await requireStripeConnectClient(ctx, { siteUrl });
		return {
			clientId: client._id,
			siteUrl: client.siteUrl,
			tenantId: client.tenantId,
			stripeConnectedAccountId: client.stripeConnectedAccountId ?? null,
			attempt: client.stripeConnectAttempt ?? null,
		};
	},
});

/** Customer requests never impersonate an admin; the hub attests their resolved payment scope. */
export const getClientPaymentTarget = query({
	args: { siteUrl: v.string(), tenantId: v.string(), accountId: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const { client, attempt } = await requireClientPaymentBinding(ctx, args);
		return {
			target: {
				clientId: client._id, siteUrl: args.siteUrl, tenantId: args.tenantId,
				stripeConnectedAccountId: args.accountId, attempt,
			},
			status: projectStripeConnectStatus(client.stripeConnectStatus),
		};
	},
});

/** Freeze the provider request once, including its Stripe account/environment. */
export const beginStripeConnectAccount = mutation({
	args: {
		clientId: v.id("platformClients"),
		platformAccountId: v.string(),
		livemode: v.boolean(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!/^acct_[A-Za-z0-9]{16,64}$/.test(args.platformAccountId)) {
			throw new Error("Invalid Stripe platform account");
		}
		const client = await requireStripeConnectClient(ctx, { clientId: args.clientId });
		if (client.stripeConnectStatus?.state.kind === "disconnected") {
			throw new Error("Disconnected Stripe accounts require an explicit reconnection review");
		}
		if (client.stripeConnectedAccountId && !client.stripeConnectAttempt) {
			throw new Error("Stripe connection has no verified creation attempt");
		}
		const { tenantId } = await ensureTenantIdentity(ctx, client, "platform_client_site_url");
		const attempt = client.stripeConnectAttempt ?? {
			id: crypto.randomUUID(),
			model: "full-v1" as const,
			startedAt: Date.now(),
			email: client.email,
			siteUrl: client.siteUrl,
			platformAccountId: args.platformAccountId,
			livemode: args.livemode,
		};
		if (
			attempt.platformAccountId !== args.platformAccountId ||
			attempt.livemode !== args.livemode
		) {
			throw new Error("Stripe connection environment does not match its creation attempt");
		}
		if (!client.stripeConnectAttempt) {
			await ctx.db.patch(client._id, { stripeConnectAttempt: attempt });
		}
		return {
			clientId: client._id,
			tenantId,
			attempt,
			stripeConnectedAccountId: client.stripeConnectedAccountId ?? null,
		};
	},
});

/** Only the authenticated hub can bind the Stripe-verified result of an attempt. */
export const bindStripeConnectAccount = mutation({
	args: {
		clientId: v.id("platformClients"),
		attemptId: v.string(),
		platformAccountId: v.string(),
		livemode: v.boolean(),
		stripeConnectedAccountId: v.string(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const client = await requireStripeConnectClient(ctx, { clientId: args.clientId });
		if (client.stripeConnectStatus?.state.kind === "disconnected") {
			throw new Error("Disconnected Stripe accounts require an explicit reconnection review");
		}
		const attempt = client.stripeConnectAttempt;
		if (
			!attempt ||
			attempt.id !== args.attemptId ||
			attempt.platformAccountId !== args.platformAccountId ||
			attempt.livemode !== args.livemode ||
			!/^acct_[A-Za-z0-9]{16,64}$/.test(args.stripeConnectedAccountId) ||
			args.stripeConnectedAccountId === args.platformAccountId ||
			(client.stripeConnectedAccountId &&
				client.stripeConnectedAccountId !== args.stripeConnectedAccountId)
		)
			throw new Error("Stripe account binding conflicts with its creation attempt");
		const owners = await ctx.db
			.query("platformClients")
			.withIndex("by_stripeConnectedAccountId", (q) =>
				q.eq("stripeConnectedAccountId", args.stripeConnectedAccountId),
			)
			.take(2);
		if (owners.some((owner) => owner._id !== client._id)) {
			throw new Error("Stripe account is already bound to another client");
		}
		const binding = await ctx.db.query("stripeAccountBindings")
			.withIndex("by_stripeConnectedAccountId", (q) =>
				q.eq("stripeConnectedAccountId", args.stripeConnectedAccountId))
			.unique();
		if (!client.tenantId) throw new Error("Stripe account binding requires tenant identity");
		if (binding && (
			binding.clientId !== client._id || binding.tenantId !== client.tenantId
			|| binding.attemptId !== attempt.id
			|| binding.platformAccountId !== attempt.platformAccountId
			|| binding.livemode !== attempt.livemode
		)) throw new Error("Stripe account is already bound to a different connection");
		if (!binding) {
			await ctx.db.insert("stripeAccountBindings", {
				stripeConnectedAccountId: args.stripeConnectedAccountId,
				clientId: client._id,
				tenantId: client.tenantId,
				attemptId: attempt.id,
				platformAccountId: attempt.platformAccountId,
				livemode: attempt.livemode,
				boundAt: Date.now(),
			});
		}
		await ctx.db.patch(client._id, { stripeConnectedAccountId: args.stripeConnectedAccountId });
		return { stripeConnectedAccountId: args.stripeConnectedAccountId };
	},
});

/** Tenant access is independent of the hub authority needed to write provider facts. */
export const getStripeConnectStatus = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await requireStripeConnectClient(ctx, { siteUrl });
		const status = client.stripeConnectStatus;
		if (status && status.accountId !== client.stripeConnectedAccountId) {
			throw new Error("Stripe status does not match the selected account");
		}
		if (status) {
			const attempt = client.stripeConnectAttempt;
			if (!attempt) throw new Error("Stripe status requires a verified creation attempt");
			await requireCurrentStripeConnectBinding(ctx, {
				clientId: client._id, accountId: status.accountId,
				platformAccountId: attempt.platformAccountId, livemode: attempt.livemode,
			});
		}
		return projectStripeConnectStatus(status);
	},
});

/** Claim before reading Stripe, so a slow response cannot overwrite later work. */
export const beginStripeConnectStatusRefresh = mutation({
	args: stripeConnectStatusTargetArgs,
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const client = await requireCurrentStripeConnectBinding(ctx, args);
		if (client.stripeConnectStatus?.state.kind === "disconnected") {
			return { kind: "disconnected" as const };
		}
		const refreshToken = crypto.randomUUID();
		await ctx.db.patch(client._id, { stripeConnectStatus: {
			accountId: args.accountId,
			state: { kind: "checking", refreshToken, startedAt: Date.now() },
		} });
		return { kind: "checking" as const, refreshToken };
	},
});

/** A failed or pending read never leaves an apparently usable ready snapshot. */
export const finishStripeConnectStatusRefresh = mutation({
	args: {
		...stripeConnectStatusTargetArgs,
		refreshToken: v.string(),
		result: stripeConnectStatusResultValidator,
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const client = await requireCurrentStripeConnectBinding(ctx, args);
		const state = client.stripeConnectStatus?.state;
		const now = Date.now();
		if (state?.kind !== "checking" || state.refreshToken !== args.refreshToken
			|| now - state.startedAt >= STRIPE_STATUS_REFRESH_MAX_AGE_MS || now < state.startedAt) {
			return { applied: false };
		}
		if (args.result.kind === "observed") {
			const facts = args.result.readiness;
			if ((facts.status === "ready") !== (facts.chargesEnabled && facts.payoutsEnabled)) {
				throw new Error("Stripe readiness contradicts its payment and payout capabilities");
			}
		}
		await ctx.db.patch(client._id, { stripeConnectStatus: {
			accountId: args.accountId,
			state: { ...args.result, checkedAt: now },
		} });
		return { applied: true };
	},
});

/** Terminal for this protocol: retries cannot recreate access or clear this marker. */
export const markStripeConnectDisconnected = mutation({
	args: { ...stripeConnectStatusTargetArgs, eventId: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const client = await requireCurrentStripeConnectBinding(ctx, args);
		if (!/^evt_[A-Za-z0-9]{1,240}$/.test(args.eventId)) throw new Error("Invalid Stripe event ID");
		if (client.stripeConnectStatus?.state.kind === "disconnected") return { applied: false };
		await ctx.db.patch(client._id, { stripeConnectStatus: {
			accountId: args.accountId,
			state: { kind: "disconnected", eventId: args.eventId, disconnectedAt: Date.now() },
		} });
		return { applied: true };
	},
});

/**
 * Seed a `platformClients` row from the CLI. Used to bootstrap a tenant in
 * the shared Convex deployment — the public `createClient` mutation gates on
 * `requireAuth`, which no `npx convex run` caller can satisfy, so CLI-driven
 * onboarding needs an internal path.
 *
 * Idempotent by `siteUrl`: re-running on an existing row returns
 * `{ created: false, id }` without touching fields. To add an admin email
 * to an existing row, use `ensureSiteAdmin`. To rewrite other fields, use
 * the authed `updateClient` mutation via the admin UI, or patch the row
 * directly via the Convex dashboard for one-off corrections.
 *
 * `subscriptionStatus` is optional and defaults to `"none"` — pass the
 * explicit value at seed time for full-tier clients whose subscription is
 * active from day one (e.g. reflecting-pool/Maggie).
 *
 * Usage (from the Convex codebase at `~/Documents/work/angelsrest`):
 *   npx convex run platform:seedClient \
 *     '{"name":"Reflecting Pool","email":"thinkingofview@gmail.com","siteUrl":"zippymiggy.com","tier":"full","subscriptionStatus":"active","adminEmails":["thinkingofview@gmail.com"]}'
 */
export const seedClient = internalMutation({
	args: {
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.optional(
			v.union(
				v.literal("active"),
				v.literal("canceled"),
				v.literal("past_due"),
				v.literal("none"),
			),
		),
		adminEmails: v.array(v.string()),
		role: v.optional(v.union(v.literal("creator"), v.literal("client"))),
		stripeConnectedAccountId: v.optional(v.string()),
		catalogProductKinds: v.optional(catalogProductKindsValidator),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		if (args.stripeConnectedAccountId !== undefined) {
			throw new Error("Stripe accounts must be bound through verified onboarding");
		}
		const existing = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", args.siteUrl))
			.unique();
		if (existing) {
			return { created: false, id: existing._id };
		}
		const { subscriptionStatus, catalogProductKinds, ...rest } = args;
		const id = await ctx.db.insert("platformClients", {
			...rest,
			subscriptionStatus: subscriptionStatus ?? "none",
			role: rest.role ?? "client",
			catalogProductKinds: normalizeCatalogProductKinds(
				catalogProductKinds ?? [],
			),
		});
		const stored = await ctx.db.get(id);
		if (!stored) throw new Error("Seeded tenant could not be read back");
		await ensureTenantIdentity(ctx, stored, "platform_client_site_url");
		return { created: true, id };
	},
});

/** Idempotently widen one legacy platform client before tenant-ID adoption. */
export const backfillTenantIdentity = internalMutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) {
			throw new Error(`No platformClients row with siteUrl="${siteUrl}"`);
		}
		return await ensureTenantIdentity(ctx, client, "operator");
	},
});

/**
 * Store one tenant's server-owned catalog capability policy. Internal-only so
 * site administrators cannot grant themselves additional product kinds.
 *
 * Usage:
 *   npx convex run --prod platform:setCatalogProductKinds \
 *     '{"siteUrl":"zippymiggy.com","catalogProductKinds":["print","print_set","postcard"]}'
 */
export const setCatalogProductKinds = internalMutation({
	args: {
		siteUrl: v.string(),
		catalogProductKinds: catalogProductKindsValidator,
	},
	handler: async (ctx, { siteUrl, catalogProductKinds }) => {
		const row = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!row) {
			throw new Error(`No platformClients row with siteUrl="${siteUrl}"`);
		}
		const normalized = normalizeCatalogProductKinds(catalogProductKinds);
		if (
			row.catalogProductKinds !== undefined
			&& row.catalogProductKinds.length === normalized.length
			&& row.catalogProductKinds.every(
				(productKind, index) => productKind === normalized[index],
			)
		) {
			return {
				changed: false,
				id: row._id,
				siteUrl: row.siteUrl,
				catalogProductKinds: row.catalogProductKinds,
			};
		}
		await ctx.db.patch(row._id, { catalogProductKinds: normalized });
		return {
			changed: true,
			id: row._id,
			siteUrl: row.siteUrl,
			before: row.catalogProductKinds ?? null,
			catalogProductKinds: normalized,
		};
	},
});

export const listTrustedOrigins = internalQuery({
	args: {},
	handler: async (ctx) => {
		const clients = await ctx.db.query("platformClients").take(DEFAULT_LIST_LIMIT);
		const origins = new Set<string>();
		for (const client of clients) {
			for (const origin of trustedOriginVariants(client.siteUrl)) {
				origins.add(origin);
			}
		}
		return Array.from(origins);
	},
});

/** Retired CLI assignment; provider account binding requires verified onboarding. */
export const setStripeConnectedAccount = internalMutation({
	args: {
		siteUrl: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
	},
	handler: async () => {
		throw new Error("Stripe accounts must be bound through verified onboarding");
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
				.unique();
			if (row) break;
		}
		if (!row) {
			throw new Error(
				`No platformClients row found for siteUrl="${siteUrl}" (also tried https:// variants). Create it via platform.seedClient (CLI-safe) or platform.createClient (browser/authed) first.`,
			);
		}

		const patch: Record<string, unknown> = {};
		if (row.siteUrl !== siteUrl) {
			await assertSiteUrlAvailable(ctx, siteUrl, row._id);
			const { tenantId } = await ensureTenantIdentity(ctx, row, "operator");
			await ensureTenantAliases(ctx, tenantId, row._id, siteUrl, "operator");
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
 * One-time migration helper for the shared Convex model. Marks the creator's
 * platformClients row so platform-wide operations can require creator role
 * instead of relying on the historical "admin of angelsrest.online" shortcut.
 *
 * Usage:
 *   npx convex run         platform:setCreatorRole '{"siteUrl":"angelsrest.online"}'
 *   npx convex run --prod  platform:setCreatorRole '{"siteUrl":"angelsrest.online"}'
 */
export const setCreatorRole = internalMutation({
	args: {
		siteUrl: v.string(),
	},
	handler: async (ctx, { siteUrl }) => {
		const row = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!row) {
			throw new Error(`No platformClients row with siteUrl="${siteUrl}"`);
		}
		if (row.role === "creator") {
			return { changed: false, id: row._id, role: row.role };
		}
		await ctx.db.patch(row._id, { role: "creator" });
		return { changed: true, id: row._id, before: row.role ?? "client" };
	},
});

/**
 * Rename the `siteUrl` on a platformClients row — used when a client's
 * domain is decided (or changed) after the row was created with a stub
 * (e.g. placeholder.example → zippymiggy.com).
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
			.unique();
		if (!row) {
			throw new Error(`No platformClients row with siteUrl="${fromSiteUrl}"`);
		}
		const collision = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", toSiteUrl))
			.unique();
		if (collision) {
			throw new Error(
				`A platformClients row already exists at siteUrl="${toSiteUrl}" (id=${collision._id}). Delete one before renaming.`,
			);
		}
		const { tenantId } = await ensureTenantIdentity(ctx, row, "operator");
		await ensureTenantAliases(ctx, tenantId, row._id, toSiteUrl, "operator");
		await ctx.db.patch(row._id, { siteUrl: toSiteUrl });
		return { id: row._id, from: fromSiteUrl, to: toSiteUrl };
	},
});

function trustedOriginVariants(siteUrl: string) {
	const normalized = siteUrl.trim().replace(/\/+$/, "");
	if (!normalized) return [];
	if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
		const apex = normalized.replace("https://www.", "https://");
		return Array.from(new Set([normalized, apex]));
	}
	return [`https://${normalized}`, `https://www.${normalized}`];
}
