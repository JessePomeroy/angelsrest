import { ConvexHttpClient } from "convex/browser";
import Stripe from "stripe";
import { api } from "../../packages/crm-api/convex/_generated/api.js";
import {
	type InventoryRoute,
	type InventorySession,
	inventoryCheckoutSessions,
	inventoryCheckoutSessionsAtFixedPoint,
} from "./r4-checkout-session-inventory-core.js";

const targetSite = "angelsrest.online";

async function main() {
	const stripeSecretKey = required("STRIPE_SECRET_KEY");
	const convexUrl = required("PUBLIC_CONVEX_URL");
	const webhookSecret = required("WEBHOOK_SECRET");
	const stripe = new Stripe(stripeSecretKey);
	const convex = new ConvexHttpClient(convexUrl);
	const cutoff = await convex.query(api.commerceClosure.getProtocolCutoffForInventory, {
		siteUrl: targetSite,
		webhookSecret,
	});
	if (!cutoff || cutoff.accountScopeClass !== "platform") {
		throw new Error("Inventory configuration is incomplete");
	}

	const inventory =
		process.env.R4_INVENTORY_MODE === "accelerated-fixed-point"
			? inventoryCheckoutSessionsAtFixedPoint
			: inventoryCheckoutSessions;
	const result = await inventory({
		stripe: { list: (input) => stripe.checkout.sessions.list(input) },
		routing: {
			async resolve(session): Promise<InventoryRoute> {
				const marker = session.metadata?.commerceTenantSiteUrl;
				const args = {
					stripeSessionId: session.id,
					...(marker ? { stripeTenantMetadataSiteUrl: marker } : {}),
					webhookSecret,
				};
				const routed = await convex.query(api.orders.resolveCheckoutRouting, args);
				if (routed) return routed.source;
				const admission = await convex.query(api.orders.resolveCheckoutAdmissionRouting, args);
				return admission ? "admission" : null;
			},
		},
		cutoffCreatedSeconds: cutoff.cutoffCreatedSeconds,
		acceptUntilMs: cutoff.acceptUntilMs,
		nowMs: Date.now(),
		targetSite,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (result.outcome !== "clear") process.exitCode = 2;
}

function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error("Inventory configuration is incomplete");
	return value;
}

main().catch(() => {
	const result = {
		version: 1,
		outcome: "incomplete",
		scanClass: "provider_error",
		evidenceClasses: [],
		blockerClasses: ["inventory_execution_error"],
	};
	process.stdout.write(`${JSON.stringify(result)}\n`);
	process.exitCode = 2;
});

export type { InventorySession };
