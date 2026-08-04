import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminConfig } from "$lib/config/admin";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import {
	HISTORICAL_RESERVATION_CLOSEOUT_ID,
	historicalReservationCloseoutManifest,
} from "$lib/server/historicalReservationCloseoutManifest";
import { logStructured } from "$lib/server/logger";
import { authorizeSiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { RequestHandler } from "./$types";

const MAX_REQUEST_BODY_BYTES = 1024;

function response(status: string, statusCode: number) {
	return json({ status }, { status: statusCode, headers: { "cache-control": "no-store" } });
}

function isExpectedOrigin(request: Request) {
	const origin = request.headers.get("origin");
	return (
		origin !== null &&
		origin === new URL(request.url).origin &&
		origin === historicalReservationCloseoutManifest.expectedOrigin
	);
}

async function readBoundedBody(request: Request) {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let byteLength = 0;
	let body = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		if (byteLength > MAX_REQUEST_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		body += decoder.decode(value, { stream: true });
	}
	return body + decoder.decode();
}

async function readCloseoutId(request: Request) {
	const contentType = request.headers.get("content-type")?.trim() ?? "";
	if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return null;
	const contentLength = request.headers.get("content-length");
	if (
		contentLength &&
		(!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BODY_BYTES)
	)
		return null;
	try {
		const body = await readBoundedBody(request);
		if (body === null) return null;
		const value: unknown = JSON.parse(body);
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const keys = Object.keys(value);
		if (keys.length !== 1 || keys[0] !== "closeoutId") return null;
		const closeoutId = Reflect.get(value, "closeoutId");
		return typeof closeoutId === "string" ? closeoutId : null;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	if (!isExpectedOrigin(request)) return response("forbidden", 403);
	if (
		env.CHECKOUT_RESERVATION_CLOSEOUT_ID !== HISTORICAL_RESERVATION_CLOSEOUT_ID ||
		adminConfig.siteUrl !== historicalReservationCloseoutManifest.siteUrl ||
		publicEnv.PUBLIC_CONVEX_URL !== historicalReservationCloseoutManifest.expectedConvexUrl
	)
		return response("disabled", 404);
	const authorization = await authorizeSiteAdminRequest(request);
	if (!authorization) return response("unauthorized", 401);

	const closeoutId = await readCloseoutId(request);
	if (closeoutId !== HISTORICAL_RESERVATION_CLOSEOUT_ID) {
		return response("invalid_request", 400);
	}

	try {
		const convex = createAuthenticatedConvexClient(authorization.convexToken);
		const result = await convex.mutation(api.orders.closeHistoricalCheckoutSnapshotReservation, {
			webhookSecret: getWebhookSecret(),
			closeoutId,
		});
		logStructured({
			event: "checkout_snapshot_reservation.admin_closeout_completed",
			stage: "stripe_refund",
			meta: { closeoutId, result: result.kind },
		});
		return response(result.kind, 200);
	} catch (cause) {
		logStructured({
			event: "checkout_snapshot_reservation.admin_closeout_indeterminate",
			level: "error",
			stage: "stripe_refund",
			error: cause,
			meta: { closeoutId },
		});
		return response("indeterminate", 503);
	}
};
