import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { getConvex } from "$lib/server/convexClient";
import {
	parseLumaPrintsShippingPayload,
	processLumaPrintsShipment,
	verifyLumaPrintsBasicAuthorization,
} from "$lib/server/lumaprintsWebhook";
import { getResend } from "$lib/server/resendClient";
import { sendCustomerShipmentNotification } from "$lib/server/webhookEmails";

export async function POST({ request }: { request: Request }) {
	const username = env.LUMAPRINTS_WEBHOOK_USERNAME;
	const password = env.LUMAPRINTS_WEBHOOK_PASSWORD;
	const previousPassword = env.LUMAPRINTS_WEBHOOK_PASSWORD_PREVIOUS;
	const webhookSecret = env.WEBHOOK_SECRET;
	if (!username || !password || !webhookSecret) {
		console.error("[lumaprints webhook] server authentication is not configured");
		return json({ error: "Webhook unavailable" }, { status: 503 });
	}
	if (
		!verifyLumaPrintsBasicAuthorization(
			request.headers.get("authorization"),
			username,
			password,
			previousPassword,
		)
	) {
		return json(
			{ error: "Unauthorized" },
			{ status: 401, headers: { "WWW-Authenticate": 'Basic realm="LumaPrints webhook"' } },
		);
	}

	let shipment;
	try {
		shipment = parseLumaPrintsShippingPayload(await request.text());
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid webhook payload";
		return json({ error: message }, { status: message.includes("too large") ? 413 : 400 });
	}

	const convex = getConvex();
	const result = await processLumaPrintsShipment(shipment, {
		claim: (input) =>
			convex.mutation(api.orders.claimShipmentEmailNotificationByOrderNumber, {
				webhookSecret,
				lumaprintsOrderNumber: input.orderNumber,
				trackingNumber: input.trackingNumber,
			}),
		record: (input) =>
			convex.mutation(api.orders.recordShipmentEmailDeliveryByOrderNumber, {
				webhookSecret,
				...input,
			}),
		send: async (input) => {
			const notificationProfile = await resolveNotificationProfile(input.siteUrl, webhookSecret);
			await sendCustomerShipmentNotification(getResend(), {
				customerEmail: input.customerEmail,
				orderNumber: input.orderNumber,
				trackingNumber: input.trackingNumber,
				carrier: input.carrier,
				notificationProfile,
			});
		},
	});

	return json({ received: true, status: result.status });
}

async function resolveNotificationProfile(
	siteUrl: string,
	webhookSecret: string,
): Promise<CommerceNotificationProfile> {
	if (siteUrl === SITE_DOMAIN) return ANGELS_REST_COMMERCE_PROFILE;
	const profile = await getConvex().query(api.platform.getCommerceProfileForSite, {
		siteUrl,
		webhookSecret,
	});
	if (!profile) throw new Error(`No commerce profile found for ${siteUrl}`);
	return profile;
}
