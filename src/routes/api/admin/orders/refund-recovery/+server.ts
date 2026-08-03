import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminConfig } from "$lib/config/admin";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import {
	ManualRefundRecoveryEvidenceError,
	type ManualRefundRecoveryFailureObservations,
	recoverManualRefundFromProvider,
} from "$lib/server/manualRefundRecovery";
import {
	MANUAL_REFUND_RECOVERY_ID,
	manualRefundRecoveryManifest,
} from "$lib/server/manualRefundRecoveryManifest";
import { authorizeSiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { getStripe } from "$lib/server/stripeClient";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { RequestHandler } from "./$types";

const MAX_REQUEST_BODY_BYTES = 1024;

function response(status: string, statusCode: number, reason?: string) {
	return json(
		{ status, ...(reason ? { reason } : {}) },
		{ status: statusCode, headers: { "cache-control": "no-store" } },
	);
}

function isExpectedOrigin(request: Request) {
	const origin = request.headers.get("origin");
	return (
		origin !== null &&
		origin === new URL(request.url).origin &&
		origin === manualRefundRecoveryManifest.expectedOrigin
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

async function readRecoveryId(request: Request) {
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
		if (keys.length !== 1 || keys[0] !== "recoveryId") return null;
		const recoveryId = Reflect.get(value, "recoveryId");
		return typeof recoveryId === "string" ? recoveryId : null;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	if (!isExpectedOrigin(request)) return response("forbidden", 403);
	if (
		env.STRIPE_REFUND_RECOVERY_ID !== MANUAL_REFUND_RECOVERY_ID ||
		adminConfig.siteUrl !== manualRefundRecoveryManifest.siteUrl ||
		publicEnv.PUBLIC_CONVEX_URL !== manualRefundRecoveryManifest.expectedConvexUrl
	)
		return response("disabled", 404);
	const authorization = await authorizeSiteAdminRequest(request);
	if (!authorization) return response("unauthorized", 401);

	const recoveryId = await readRecoveryId(request);
	if (recoveryId !== MANUAL_REFUND_RECOVERY_ID) return response("invalid_request", 400);

	const indeterminate = (cause: unknown) => {
		logStructured({
			event: "manual_refund.admin_recovery_indeterminate",
			level: "error",
			stage: "stripe_refund",
			error: cause,
			meta: { recoveryId },
		});
		return response("indeterminate", 503);
	};
	const convex = createAuthenticatedConvexClient(authorization.convexToken);
	const webhookSecret = getWebhookSecret();
	let claim: { claimed: boolean };
	try {
		claim = await convex.mutation(api.orders.claimManualRefundRecovery, {
			webhookSecret,
			recoveryId,
			manifestVersion: manualRefundRecoveryManifest.manifestVersion,
			siteUrl: manualRefundRecoveryManifest.siteUrl,
			stripeContext: manualRefundRecoveryManifest.stripeContext,
			stripeEventId: manualRefundRecoveryManifest.stripeEventId,
			stripeEventType: manualRefundRecoveryManifest.stripeEventType,
			stripeEventApiVersion: manualRefundRecoveryManifest.stripeEventApiVersion,
			stripeRefundId: manualRefundRecoveryManifest.stripeRefundId,
			stripeChargeId: manualRefundRecoveryManifest.stripeChargeId,
			stripePaymentIntentId: manualRefundRecoveryManifest.stripePaymentIntentId,
			stripeSessionId: manualRefundRecoveryManifest.stripeSessionId,
			stripeTenantMetadataSiteUrl: manualRefundRecoveryManifest.stripeTenantMetadataSiteUrl,
			amount: manualRefundRecoveryManifest.amount,
			currency: manualRefundRecoveryManifest.currency,
			livemode: manualRefundRecoveryManifest.livemode,
		});
	} catch (cause) {
		return indeterminate(cause);
	}
	if (!claim.claimed) return response("already_claimed", 409);
	const recordFailure = async (
		resultReason: string,
		failureStage: "provider_evidence" | "execution",
		providerFailureObservations?: ManualRefundRecoveryFailureObservations,
	) => {
		const result = await convex.mutation(api.orders.failManualRefundRecovery, {
			webhookSecret,
			recoveryId,
			siteUrl: manualRefundRecoveryManifest.siteUrl,
			resultReason,
			failureStage,
			...(providerFailureObservations ? { providerFailureObservations } : {}),
		});
		if (!result.completed) throw new Error("Manual refund recovery outcome was not recorded");
	};

	try {
		const result = await recoverManualRefundFromProvider({ stripe: getStripe(), convex });
		if (result.kind === "ignored") {
			try {
				await recordFailure(
					`ignored_${result.reason}`,
					"provider_evidence",
					result.providerFailureObservations,
				);
			} catch (cause) {
				return indeterminate(cause);
			}
			return response("ignored", 409, result.reason);
		}
		logStructured({
			event: "manual_refund.admin_recovery_completed",
			stage: "stripe_refund",
			meta: { recoveryId, result: result.kind },
		});
		return response(
			result.kind,
			result.kind === "reconciled" || result.kind === "replayed" ? 200 : 409,
		);
	} catch (cause) {
		const resultReason =
			cause instanceof ManualRefundRecoveryEvidenceError
				? "provider_evidence_rejected"
				: "execution_failed";
		try {
			await recordFailure(
				resultReason,
				cause instanceof ManualRefundRecoveryEvidenceError ? "provider_evidence" : "execution",
				cause instanceof ManualRefundRecoveryEvidenceError ? cause.observations : undefined,
			);
		} catch (auditCause) {
			return indeterminate(auditCause);
		}
		logStructured({
			event: "manual_refund.admin_recovery_failed",
			level: "error",
			stage: "stripe_refund",
			error: cause,
			meta: { recoveryId, resultReason },
		});
		return response("failed", 500);
	}
};
