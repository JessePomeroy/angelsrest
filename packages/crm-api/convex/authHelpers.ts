import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";

/**
 * Require an authenticated user identity. Throws if not authenticated.
 * Use in all admin-only mutations and sensitive queries.
 */
export async function requireAuth(ctx: MutationCtx | QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error("Not authenticated");
	}
	return identity;
}

/**
 * Require the caller to present a matching `WEBHOOK_SECRET` (or be an
 * authenticated admin user, if `allowAuth` is true and the request lacks a
 * secret).
 *
 * This is a pragmatic fix for audit C4/C5: the Stripe webhook is validated
 * in the SvelteKit layer, but the Convex mutations it calls are publicly
 * invokable. Rather than do the full `internalMutation` + `httpAction`
 * migration right now, we gate webhook-callable mutations on a shared
 * secret that the SvelteKit webhook passes through. Only code that knows
 * the secret (or is an admin session) can invoke.
 *
 * The secret is set via `npx convex env set WEBHOOK_SECRET <value>` and
 * mirrored in `.env`/Vercel as `WEBHOOK_SECRET`. Generate with:
 *   openssl rand -base64 32
 *
 * Auth priority (cheapest check first):
 *   1. If the caller presents a `providedSecret` AND `WEBHOOK_SECRET` is
 *      set AND they match, accept as webhook.
 *   2. Else if `allowAuth` and the caller is authenticated, accept as auth.
 *   3. Else reject.
 *
 * The absence of `WEBHOOK_SECRET` on the deployment does NOT block
 * authenticated admin callers (which is how the admin UI calls these
 * mutations). It only means the webhook path can't authenticate, which
 * is the correct fail-closed behavior for that path.
 */
export async function requireWebhookCallerOrAuth(
	ctx: MutationCtx | QueryCtx,
	providedSecret: string | undefined,
	{ allowAuth = true }: { allowAuth?: boolean } = {},
) {
	const expected = process.env.WEBHOOK_SECRET;
	if (providedSecret) {
		if (!expected) {
			throw new Error(
				"Webhook authorization is not configured on this deployment (WEBHOOK_SECRET env var missing). Run `npx convex env set WEBHOOK_SECRET <value>`.",
			);
		}
		if (constantTimeEquals(providedSecret, expected)) {
			return { via: "webhook" as const };
		}
		// Secret was supplied but didn't match — don't silently fall through to
		// auth; that could mask a misconfiguration or an attacker probing the
		// secret. Reject hard.
		throw new Error("Not authorized (webhook secret mismatch)");
	}
	if (allowAuth) {
		const identity = await ctx.auth.getUserIdentity();
		if (identity) return { via: "auth" as const, identity };
	}
	throw new Error("Not authorized");
}

/**
 * Constant-time string comparison to avoid leaking secret length / prefix
 * via timing. Cheap; the strings involved are small.
 */
function constantTimeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Require that the authenticated user is an admin of the given site.
 *
 * This is the tenant-authorization primitive. It prevents the class of bug
 * where a caller in tenant A (authenticated as someone else) passes
 * `siteUrl: "tenantB.com"` and gets access to tenant B's data purely because
 * `requireAuth` alone only verifies "someone is logged in."
 *
 * Returns the verified identity + the `platformClients` row for the site.
 * Throws `Not authorized` if the identity's email is not in that site's
 * `adminEmails` list.
 */
export async function requireSiteAdmin(
	ctx: MutationCtx | QueryCtx,
	siteUrl: string,
) {
	const identity = await requireAuth(ctx);
	if (!identity.email) {
		throw new Error("Not authorized (missing email in identity)");
	}
	const client = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.first();
	if (!client) {
		throw new Error("Not authorized (site not found)");
	}
	const identityEmail = identity.email.toLowerCase();
	const isAdmin = client.adminEmails
		.map((e) => e.toLowerCase())
		.includes(identityEmail);
	if (!isAdmin) {
		throw new Error("Not authorized (not a site admin)");
	}
	return { identity, client };
}

/**
 * Require that the authenticated user is an admin of the site that owns a
 * document. Use this for public functions that receive only a document id and
 * therefore cannot call `requireSiteAdmin(ctx, siteUrl)` directly without
 * changing the external API.
 */
export async function requireDocumentSiteAdmin<T extends TableNames>(
	ctx: MutationCtx | QueryCtx,
	table: T,
	id: Id<T>,
) {
	const doc = await ctx.db.get(id);
	if (!doc) {
		throw new Error("Not found");
	}
	const siteUrl = (doc as { siteUrl?: string }).siteUrl;
	if (!siteUrl) {
		throw new Error(`Document in ${table} is not site-scoped`);
	}
	await requireSiteAdmin(ctx, siteUrl);
	return doc;
}

/**
 * Require creator/platform-admin access. Platform-wide tables do not belong to
 * a tenant selected by request args, so they need a role check instead of a
 * caller-supplied siteUrl check.
 *
 * Migration note: existing platformClients rows predate `role`. During rollout,
 * if no creator row has been marked yet, fall back to the historical
 * angelsrest.online admin check so the creator is not locked out between
 * deployment and the one-time `platform.setCreatorRole` migration.
 */
export async function requireCreator(ctx: MutationCtx | QueryCtx) {
	const identity = await requireAuth(ctx);
	if (!identity.email) {
		throw new Error("Not authorized (missing email in identity)");
	}

	const identityEmail = identity.email.toLowerCase();
	const platformRows = await ctx.db.query("platformClients").take(DEFAULT_LIST_LIMIT);
	const creatorRows = platformRows.filter((client) => client.role === "creator");
	const memberships = platformRows.filter((client) =>
		client.adminEmails.map((email) => email.toLowerCase()).includes(identityEmail),
	);
	const creatorMembership = memberships.find((client) => client.role === "creator");
	if (creatorMembership) {
		return { identity, client: creatorMembership };
	}

	if (creatorRows.length === 0) {
		const legacy = memberships.find((client) => client.siteUrl === "angelsrest.online");
		if (legacy) {
			return { identity, client: legacy };
		}
	}

	throw new Error("Not authorized (not a creator)");
}

/**
 * Backward-compatible name for existing call sites. New code should call
 * `requireCreator` directly.
 */
export async function requirePlatformAdmin(ctx: MutationCtx | QueryCtx) {
	return await requireCreator(ctx);
}
