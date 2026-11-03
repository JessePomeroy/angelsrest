import { env } from "$env/dynamic/private";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
export function gmailConfiguration() {
	const secret = env.GMAIL_CONNECTOR_SECRET,
		cookieKey = env.GMAIL_OAUTH_STATE_KEY,
		clientId = env.GMAIL_OAUTH_CLIENT_ID;
	const callback = env.GMAIL_OAUTH_REDIRECT_URI,
		audience = env.GMAIL_PUBSUB_AUDIENCE,
		serviceAccount = env.GMAIL_PUBSUB_SERVICE_ACCOUNT,
		subscription = env.GMAIL_PUBSUB_SUBSCRIPTION;
	const origin = getPublicSiteOrigin();
	if (
		!secret ||
		secret.length < 32 ||
		!cookieKey ||
		!/^[A-Za-z0-9_-]{43}$/.test(cookieKey) ||
		!clientId ||
		callback !== `${origin}/api/admin/gmail/callback` ||
		audience !== `${origin}/api/webhooks/gmail` ||
		!serviceAccount?.endsWith(".iam.gserviceaccount.com") ||
		!subscription ||
		!/^projects\/[a-z0-9-]+\/subscriptions\/[A-Za-z0-9._~-]+$/.test(subscription) ||
		[env.WEBHOOK_SECRET, env.ORDER_LOOKUP_SECRET, env.INQUIRY_NOTIFICATION_RUNNER_SECRET].includes(
			secret,
		)
	)
		throw new Error("Gmail connection setup is incomplete");
	return { secret, cookieKey, clientId, callback, audience, serviceAccount, subscription, origin };
}
export function gmailConfigured() {
	try {
		gmailConfiguration();
		return true;
	} catch {
		return false;
	}
}
