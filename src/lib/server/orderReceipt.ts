import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { logStructured } from "$lib/server/logger";
import { sendAdminNotification, sendCustomerConfirmation } from "$lib/server/webhookEmails";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export class OrderReceiptRetryableError extends Error {}

/** Record payment receipt before fulfillment; email outages must not prevent print processing. */
export async function sendOrderReceipt(
	convex: ConvexHttpClient,
	resend: Resend,
	orderId: Id<"orders">,
	input: Parameters<typeof sendCustomerConfirmation>[1],
): Promise<OrderReceiptRetryableError | undefined> {
	if (input.session.payment_status !== "paid") return;
	const args = { orderId, webhookSecret: getWebhookSecret() };
	// Reserve the legacy confirmation fence before fulfillment can claim it.
	const receipt = await convex.mutation(api.orders.prepareOrderReceipt, args).catch((cause) => {
		throw new OrderReceiptRetryableError("Order receipt preparation failed", { cause });
	});
	if (receipt.kind === "uncertain") {
		logStructured({
			event: "email.receipt.delivery_uncertain",
			level: "error",
			stage: "email_customer",
			orderId: input.orderNumber,
			sessionId: input.session.id,
			error: new Error("Receipt retry window expired; inspect email delivery before resending"),
		});
	}
	if (receipt.kind !== "send") return;
	const results = await Promise.allSettled(
		(["customer", "admin"] as const).map(async (audience) => {
			if (!receipt[audience]) return;
			if (Date.now() >= receipt.expiresAt) throw new Error("Receipt retry window expired");
			const send = audience === "customer" ? sendCustomerConfirmation : sendAdminNotification;
			await send(resend, input, `order-receipt-${audience}:${input.session.id}`);
			if (!(await convex.mutation(api.orders.completeOrderReceipt, { ...args, audience }))) {
				throw new Error("Receipt delivery acknowledgement failed");
			}
			logStructured({
				event: "email.receipt.accepted",
				stage: audience === "customer" ? "email_customer" : "email_admin",
				orderId: input.orderNumber,
				sessionId: input.session.id,
			});
		}),
	);
	const failure = results.find((result) => result.status === "rejected");
	if (failure?.status === "rejected") {
		const error = new OrderReceiptRetryableError("Order receipt delivery needs retry", {
			cause: failure.reason,
		});
		logStructured({
			event: "email.receipt.retry_pending",
			level: "error",
			stage: "email_customer",
			orderId: input.orderNumber,
			sessionId: input.session.id,
			error,
		});
		return error;
	}
}
