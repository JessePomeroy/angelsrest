import { v } from "convex/values";
import type { GmailConnectionStage } from "../src/gmailConnection";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { safeConnectionError } from "./helpers/gmail/connection";
import { gmailScopes, mailboxAddress } from "./helpers/gmail/policy";

/** Tokens stay between Better Auth and the mailbox adapter; none enter the shared UI. */
export const complete = action({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }): Promise<{ connected: boolean }> => {
		await ctx.runQuery(api.gmailConversations.connection, { siteUrl });
		const user = await authComponent.getAuthUser(ctx);
		if (!user.emailVerified) throw new Error("Verify your admin email first");
		let stage: GmailConnectionStage = "refresh";
		try {
			const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
			const tokens = await auth.api.refreshToken({ body: { providerId: "google" }, headers });
			const scopes = (tokens.scope ?? "").split(/[ ,]+/);
			if (
				!gmailScopes.every((scope) => scopes.includes(scope)) ||
				!tokens.refreshToken ||
				!tokens.accessToken
			)
				return { connected: false };
			stage = "install";
			await ctx.runAction(internal.gmailNode.installLinked, {
				siteUrl,
				expectedAddress: mailboxAddress(user.email),
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
			});
			return { connected: true };
		} catch (failure) {
			throw safeConnectionError(failure, stage);
		}
	},
});
