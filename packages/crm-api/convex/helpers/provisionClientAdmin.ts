import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { createAuth } from "../auth";
import { DEFAULT_LIST_LIMIT } from "./limits";
import { PLATFORM_CLIENT_LOGIN_UNVERIFIED } from "./platformClientInput";

/** Runs in the tenant-creation transaction; existing credentials are never reset. */
export async function provisionClientAdmin(
	ctx: MutationCtx,
	input: { name: string; email: string; passwordHash: string },
) {
	if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(input.passwordHash)) {
		throw new Error("Invalid credential hash");
	}
	const { internalAdapter } = await createAuth(ctx).$context;
	const existing = await internalAdapter.findUserByEmail(input.email);
	const issuer = process.env.CONVEX_SITE_URL;
	if (!issuer || !issuer.startsWith("https://")) throw new Error("Authentication issuer is unavailable");
	if (existing) {
		const tokenIdentifier = `${issuer}|${existing.user.id}`;
		if (!existing.user.emailVerified) {
			// Reuse a previously granted identity, not an arbitrary unverified email claim.
			const previousClients = await ctx.db.query("platformClients")
				.withIndex("by_email", q => q.eq("email", input.email)).take(DEFAULT_LIST_LIMIT);
			if (!previousClients.some(client => client.adminIdentityIds?.includes(tokenIdentifier))) {
				throw new ConvexError(PLATFORM_CLIENT_LOGIN_UNVERIFIED);
			}
		}
		return { tokenIdentifier, passwordCreated: false };
	}
	const user = await internalAdapter.createUser({
		name: input.name,
		email: input.email,
		emailVerified: false,
	});
	await internalAdapter.createAccount({
		userId: user.id,
		accountId: user.id,
		providerId: "credential",
		password: input.passwordHash,
	});
	// Convex's Better Auth plugin fixes JWT issuer to CONVEX_SITE_URL and subject
	// to user.id. Grant this operator-created identity without claiming that its
	// email address has been verified or relaxing other users' invitation checks.
	return { tokenIdentifier: `${issuer}|${user.id}`, passwordCreated: true };
}
