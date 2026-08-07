import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { getConvex } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import {
	LumaPrintsWebhookPayloadError,
	processLumaPrintsShipment,
	readLumaPrintsShippingPayload,
	ShipmentEmailDeliveryError,
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
		shipment = await readLumaPrintsShippingPayload(request);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid webhook payload";
		return json(
			{ error: message },
			{ status: error instanceof LumaPrintsWebhookPayloadError ? error.status : 400 },
		);
	}

	const convex = getConvex();
	let notificationProfile: CommerceNotificationProfile | undefined;
	const result = await processLumaPrintsShipment(shipment, {
		claim: async (input) => {
			const claim = await convex.mutation(api.orders.claimShipmentEmailNotificationV2, {
				webhookSecret,
				lumaprintsOrderNumber: input.orderNumber,
				claimToken: input.claimToken,
				trackingNumber: input.trackingNumber,
			});
			if (claim?.kind !== "completed") return claim;
			const deliveryUncertain = await convex.mutation(
				api.orders.isShipmentEmailNotificationDeliveryUncertain,
				{ webhookSecret, lumaprintsOrderNumber: input.orderNumber },
			);
			return deliveryUncertain ? { kind: "delivery_uncertain" as const } : claim;
		},
		complete: (input) =>
			convex.mutation(api.orders.completeShipmentEmailNotificationV2, {
				webhookSecret,
				...input,
			}),
		release: (input) =>
			convex.mutation(api.orders.releaseShipmentEmailNotificationV2, {
				webhookSecret,
				...input,
			}),
		prepare: async (input) => {
			try {
				notificationProfile = await resolveNotificationProfile(input.siteUrl, webhookSecret);
			} catch {
				throw new ShipmentEmailDeliveryError("notification_profile_unavailable");
			}
		},
		authorize: async (input) => {
			const authorized = await convex.mutation(
				api.orders.authorizeShipmentEmailNotificationSendV2,
				{ webhookSecret, ...input },
			);
			if (authorized) return "authorized" as const;
			const deliveryUncertain = await convex.mutation(
				api.orders.isShipmentEmailNotificationDeliveryUncertain,
				{ webhookSecret, lumaprintsOrderNumber: input.lumaprintsOrderNumber },
			);
			return deliveryUncertain ? ("delivery_uncertain" as const) : ("retry" as const);
		},
		send: async (input) => {
			if (!notificationProfile) {
				throw new ShipmentEmailDeliveryError("notification_profile_unavailable");
			}
			try {
				await sendCustomerShipmentNotification(getResend(), {
					customerEmail: input.customerEmail,
					orderNumber: input.orderNumber,
					lumaprintsOrderNumber: input.lumaprintsOrderNumber,
					trackingNumber: input.trackingNumber,
					carrier: input.carrier,
					notificationProfile,
				});
			} catch {
				throw new ShipmentEmailDeliveryError("email_delivery_failed");
			}
		},
	});

	if (result.status === "delivery_uncertain") {
		logStructured({
			event: "shipment.notification_delivery_uncertain",
			level: "error",
			stage: "email_customer",
			orderId: shipment.orderNumber,
			error: new Error("Shipment notification delivery is uncertain"),
		});
	}
	if (result.status === "busy") {
		return json(
			{ received: false, status: result.status },
			{
				status: 503,
				headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
			},
		);
	}
	if (result.status === "retryable_failure") {
		return json({ received: false, status: result.status }, { status: 502 });
	}
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
