import type { MutationCtx, QueryCtx } from "./_generated/server";

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
 * NOTE: If `WEBHOOK_SECRET` is unset on the Convex deployment, this helper
 * refuses ALL callers (fail-closed) to avoid a deploy-time regression
 * opening the same hole this fix closes.
 */
export async function requireWebhookCallerOrAuth(
	ctx: MutationCtx | QueryCtx,
	providedSecret: string | undefined,
	{ allowAuth = true }: { allowAuth?: boolean } = {},
) {
	const expected = process.env.WEBHOOK_SECRET;
	if (!expected) {
		throw new Error(
			"Webhook authorization is not configured on this deployment (WEBHOOK_SECRET env var missing). Run `npx convex env set WEBHOOK_SECRET <value>`.",
		);
	}
	if (providedSecret && constantTimeEquals(providedSecret, expected)) {
		return { via: "webhook" as const };
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
