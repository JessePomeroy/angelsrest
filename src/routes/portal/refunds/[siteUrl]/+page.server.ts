import { randomUUID } from "node:crypto";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	type ClientPrintRefundPageData,
	clientPrintRefundPath,
	refundCents,
} from "$lib/clientPrintRefunds";
import { requireAuth } from "$lib/server/adminAuth";
import {
	assertClientPrintRefundsEnabled,
	getClientPrintRefundStripe,
	isClientPrintRefundsEnabled,
	runClientPrintRefund,
} from "$lib/server/clientPrintRefunds.server";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { assertStripeConnectRequestOrigin } from "$lib/server/stripeConnectGate";
import { normalizeStripeConnectSiteUrl } from "$lib/server/stripeConnectOnboarding";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";
import type { Actions, PageServerLoad } from "./$types";

export const config = { maxDuration: 120 };
function site(value: string) {
	const normalized = normalizeStripeConnectSiteUrl(value);
	if (!normalized) throw error(400, "A valid client website is required.");
	return normalized;
}
function recordId<Table extends "orders" | "clientPrintRefundOperations">(
	value: string | null,
): Id<Table> {
	if (!value || !/^[a-zA-Z0-9;_-]{1,128}$/.test(value))
		throw error(400, "Choose a valid order or refund.");
	return value as Id<Table>;
}
async function body(request: Request) {
	if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded")
		throw error(400, "Invalid refund form.");
	const reader = request.body?.getReader();
	if (!reader) throw error(400, "Missing refund form.");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 16_384) {
				await reader.cancel();
				throw error(413, "Refund form is too large.");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
	for (const key of fields.keys())
		if (fields.getAll(key).length !== 1) throw error(400, "Repeated refund field.");
	return fields;
}
export const load: PageServerLoad = async ({
	params,
	cookies,
	url,
	setHeaders,
}): Promise<ClientPrintRefundPageData> => {
	setHeaders({ "cache-control": "private, no-store" });
	const siteUrl = site(params.siteUrl);
	let token: string;
	try {
		token = await requireAuth(cookies);
	} catch (cause) {
		if (isHttpError(cause, 401)) throw redirect(303, stripeConnectSetupPath(siteUrl));
		throw cause;
	}
	const enabled = isClientPrintRefundsEnabled();
	if (!enabled) return { siteUrl, enabled, requestToken: randomUUID(), page: null };
	try {
		const page = await createAuthenticatedConvexClient(token).query(
			api.orders.getClientPrintRefundPage,
			{
				siteUrl,
				...(url.searchParams.has("order")
					? { orderId: recordId<"orders">(url.searchParams.get("order")) }
					: {}),
			},
		);
		return { siteUrl: page.siteUrl, enabled, requestToken: randomUUID(), page };
	} catch {
		throw error(
			403,
			"We could not open these refunds. Use this website’s admin login and a valid order, or contact Angels Rest.",
		);
	}
};
export const actions: Actions = {
	default: async ({ params, cookies, request }) => {
		const siteUrl = site(params.siteUrl);
		let orderId: Id<"orders">;
		try {
			const token = await requireAuth(cookies);
			assertStripeConnectRequestOrigin(request);
			assertClientPrintRefundsEnabled();
			const fields = await body(request);
			const convex = createAuthenticatedConvexClient(token);
			const webhookSecret = getWebhookSecret();
			let operationId: Id<"clientPrintRefundOperations">;
			if (fields.get("intent") === "request") {
				orderId = recordId<"orders">(fields.get("orderId"));
				const page = await convex.query(api.orders.getClientPrintRefundPage, { siteUrl, orderId });
				if (!page.selected || fields.get("confirmed") !== "yes")
					throw error(400, "Confirm the refund amounts and supplier notice.");
				const lineAmountsCents = page.selected.lines.map((line) =>
					refundCents(fields.get(`line_${line.index}`) ?? ""),
				);
				const otherAmountCents = refundCents(fields.get("other") ?? "");
				if (otherAmountCents === null || lineAmountsCents.some((amount) => amount === null))
					throw error(400, "Enter dollar amounts with no more than two decimal places.");
				operationId = await convex.mutation(api.orders.requestClientPrintRefund, {
					orderId,
					requestToken: fields.get("requestToken") ?? "",
					webhookSecret,
					allocation: {
						lineAmountsCents: lineAmountsCents.filter((amount) => amount !== null),
						otherAmountCents,
					},
				});
			} else if (fields.get("intent") === "retry" || fields.get("intent") === "cancel") {
				operationId = recordId<"clientPrintRefundOperations">(fields.get("operationId"));
				({ orderId } = await convex.query(api.orders.authorizeClientPrintRefund, {
					siteUrl,
					operationId,
				}));
				if (fields.get("intent") === "cancel") {
					await convex.mutation(api.orders.cancelClientPrintRefund, { operationId, webhookSecret });
					throw redirect(
						303,
						`${clientPrintRefundPath(siteUrl)}?order=${encodeURIComponent(orderId)}`,
					);
				}
			} else throw error(400, "Choose a refund action.");
			// The durable request exists before any provider POST. A failed response always
			// returns to that request so the client checks it instead of starting another.
			await runClientPrintRefund({
				convex,
				stripe: getClientPrintRefundStripe(),
				operationId,
			}).catch(() => undefined);
		} catch (cause) {
			if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 303)
				throw cause;
			return fail(isHttpError(cause) ? cause.status : 503, {
				message:
					isHttpError(cause) && cause.status === 400
						? cause.body.message
						: "We could not continue. Refresh the order to check any existing refund before trying again, or contact Angels Rest.",
			});
		}
		throw redirect(303, `${clientPrintRefundPath(siteUrl)}?order=${encodeURIComponent(orderId)}`);
	},
};
