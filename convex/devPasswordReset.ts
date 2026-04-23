/**
 * Dev-only utility: directly patch the scrypt password hash on a
 * Better Auth `credential` account row, bypassing the normal
 * current-password / reset-email flow.
 *
 * Use case: a developer forgot their dev password and wants to sign
 * in without setting up Resend / email delivery on the dev Convex
 * deployment. NOT intended for production — it's `internalMutation`
 * so it's not publicly callable; the caller provides a pre-computed
 * scrypt hash (see scripts/hash-password.mjs) which the fn just
 * stamps onto the account row.
 *
 * Invoke from CLI:
 *   npx convex run devPasswordReset:setCredentialPasswordHash \
 *     '{"userId":"<betterAuth user _id>","newHash":"<salt>:<hash>"}'
 *
 * After publishing a patched hash, sign in with the plaintext password
 * that was used to generate the hash.
 */

import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Dev-only: delete all JWKS rows in the betterAuth component. Forces the
 * Convex Better Auth plugin to regenerate fresh keys on the next sign-in
 * (or direct /api/auth/convex/token call). Useful when the stored keys
 * were generated under a different algorithm config and the plugin's
 * silent-catch in the sign-in after-hook is swallowing
 * `ERR_JOSE_NOT_SUPPORTED` — the symptom of that is "session cookie sets
 * fine but no `better-auth.convex_jwt` cookie, admin dashboard rejects
 * valid session".
 *
 * Invoke:
 *   npx convex run devPasswordReset:rotateJwks
 */
export const rotateJwks = internalMutation({
	args: {},
	handler: async (ctx) => {
		// biome-ignore lint/suspicious/noExplicitAny: component adapter's deleteMany union is wide; shape passed below is validated server-side by the component.
		const result = await ctx.runMutation(
			components.betterAuth.adapter.deleteMany as any,
			{
				input: { model: "jwks", where: [] },
				paginationOpts: { cursor: null, numItems: 100 },
			},
		);
		return { ok: true, result };
	},
});

export const setCredentialPasswordHash = internalMutation({
	args: {
		userId: v.string(),
		newHash: v.string(),
	},
	handler: async (ctx, { userId, newHash }) => {
		// biome-ignore lint/suspicious/noExplicitAny: the Better Auth adapter's updateOne accepts a union over every model's fields; typing that precisely from here is noisy, and the shape we pass (model="account", update={password,updatedAt}, where=[{field,value,operator,connector}]) is validated server-side by the component.
		await ctx.runMutation(components.betterAuth.adapter.updateOne as any, {
			input: {
				model: "account",
				update: { password: newHash, updatedAt: Date.now() },
				where: [
					{ field: "userId", value: userId, operator: "eq" },
					{
						field: "providerId",
						value: "credential",
						operator: "eq",
						connector: "AND",
					},
				],
			},
		});
		return { ok: true, userId };
	},
});
