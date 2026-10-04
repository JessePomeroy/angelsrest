import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { logStructured, withPrivateIntakeLogs } from "$lib/server/logger";
import { createOrderLumaPrintsClient as getLumaPrintsClient } from "$lib/server/lumaprints";
import { processStripeWebhookEvent } from "$lib/server/orderIntake";
import { getResend } from "$lib/server/resendClient";
import { getStripe } from "$lib/server/stripeClient";
import type { CommerceWebhookRole } from "$lib/server/stripeWebhook";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import {
	intakeEnvelopeDigest,
	parseCommerceIntakeEnvelope,
	serializeCommerceIntakeEnvelope,
} from "../../../packages/crm-api/convex/helpers/commerceIntakeEnvelope";

/** Consult the durable receipt even when new acceptance is off or this host cannot decode an event. */
export async function acceptCommerceIntake(
	event: Stripe.Event,
	role: CommerceWebhookRole,
	convex: ConvexHttpClient,
) {
	if (event.type !== "checkout.session.completed") return false;
	let eventJson: string | null = null;
	try {
		eventJson = serializeCommerceIntakeEnvelope(event, role);
	} catch {
		/* Unsupported historical events keep their existing synchronous handling. */
	}
	try {
		const receipt = await convex.mutation(api.commerceIntakeInbox.accept, {
			stripeEventId: event.id,
			eventJson,
			allowNew: env.COMMERCE_INTAKE_ENABLED === "true",
			webhookSecret: getWebhookSecret(),
		});
		return receipt.kind === "accepted";
	} catch {
		// Persistence uncertainty must remain retryable by Stripe; no inline fallback.
		throw error(503, "Commerce intake is temporarily unavailable");
	}
}

/** One leased attempt reuses the established order, receipt and fulfillment fences. */
export async function runCommerceIntakeStep(
	inboxId: Id<"commerceIntakeInbox">,
	leaseToken: string,
) {
	return withPrivateIntakeLogs(async () => {
		const startedAt = performance.now();
		const convex = getConvex();
		const authority = { inboxId, leaseToken, webhookSecret: getWebhookSecret() };
		const saved = await convex.query(api.commerceIntakeInbox.read, authority);
		let parsed: ReturnType<typeof parseCommerceIntakeEnvelope>;
		try {
			parsed = parseCommerceIntakeEnvelope(saved.eventJson);
			if (
				parsed.eventJson !== saved.eventJson ||
				(await intakeEnvelopeDigest(saved.eventJson)) !== saved.digest
			) {
				throw new Error("Invalid retained envelope");
			}
		} catch {
			await convex.mutation(api.commerceIntakeInbox.advance, {
				...authority,
				result: { kind: "blocked", code: "payload_invalid" },
			});
			return;
		}
		const key = env.STRIPE_SECRET_KEY;
		const configuredMode = /^(?:sk|rk)_live_/.test(key ?? "")
			? true
			: /^(?:sk|rk)_test_/.test(key ?? "")
				? false
				: undefined;
		if (
			configuredMode !== undefined &&
			(configuredMode !== saved.livemode || parsed.event.livemode !== saved.livemode)
		) {
			await convex.mutation(api.commerceIntakeInbox.advance, {
				...authority,
				result: { kind: "blocked", code: "scope_conflict" },
			});
			return;
		}
		try {
			if (configuredMode === undefined) throw new Error("Runner is not configured");
			await processStripeWebhookEvent(
				parsed.event,
				{ stripe: getStripe(), resend: getResend(), convex, getLumaPrintsClient },
				parsed.role,
			);
		} catch {
			await convex.mutation(api.commerceIntakeInbox.advance, {
				...authority,
				result: { kind: "retry", code: "processing_failed" },
			});
			logStructured({
				event: "commerce_intake.retry",
				level: "warn",
				stage: "webhook",
				durationMs: performance.now() - startedAt,
			});
			return;
		}
		await convex.mutation(api.commerceIntakeInbox.advance, {
			...authority,
			result: { kind: "processed", version: 1 },
		});
		logStructured({
			event: "commerce_intake.checkpointed",
			stage: "webhook",
			durationMs: performance.now() - startedAt,
		});
	});
}
