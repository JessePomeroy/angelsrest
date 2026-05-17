import { env } from "$env/dynamic/private";

/**
 * Shared secret between SvelteKit webhooks and Convex. Must be set in both
 * environments: Vercel `WEBHOOK_SECRET` and Convex `WEBHOOK_SECRET`.
 */
export function getWebhookSecret(): string {
	const secret = env.WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			"WEBHOOK_SECRET is not set — cannot call webhook-gated Convex mutations. Set it in Vercel and run `npx convex env set WEBHOOK_SECRET <value>`.",
		);
	}
	return secret;
}
