/// <reference types="vite/client" />

import type { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { serverSecretFingerprint } from "../../../../packages/crm-api/convex/helpers/serverSecrets";
import schema from "../../../../packages/crm-api/convex/schema";
import { processStripeWebhookEvent } from "../orderIntake";

const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const WEBHOOK_SECRET = "confirmation-webhook-authority-0123456789abcdef";
const RESERVATION_SECRET = "confirmation-reservation-authority-0123456789abcdef";
const BRIDGE_SECRET = "confirmation-bridge-authority-0123456789abcdef";
const SITE_URL = "angelsrest.online";
const SESSION_ID = "cs_test_confirmation1234567890abcdef";
const BUYER = "buyer@example.com";
const DOWNLOAD_URL = `https://${SITE_URL}/checkout/success?session_id=${SESSION_ID}`;

const privateEnv = vi.hoisted(() => ({
	WEBHOOK_SECRET: "confirmation-webhook-authority-0123456789abcdef",
	CHECKOUT_SNAPSHOT_MODE: "handle-v2",
	NOTIFICATION_EMAIL: "operator@example.com",
}));

vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
vi.mock("$lib/server/logger", () => ({
	logStructured: vi.fn(),
	timed: async (_metadata: unknown, operation: () => Promise<unknown>) => operation(),
}));

const convexEnv = {
	WEBHOOK_SECRET,
	ORDER_PRODUCERS_STATE: "open",
	CHECKOUT_SNAPSHOT_RESERVATION_SECRETS: JSON.stringify({ [SITE_URL]: [RESERVATION_SECRET] }),
	// Loading the Convex HTTP router also constructs the auth routes.
	BETTER_AUTH_SECRET: "confirmation-auth-authority-0123456789abcdef",
	SITE_URL: "https://www.angelsrest.online",
} as const;

type SnapshotKind = "print" | "digital_download";

function snapshotItem(ordinal: number, productKind: SnapshotKind) {
	return {
		productKey: `catalog.${productKind}-${ordinal}`,
		revisionId: `revision-${productKind}-${ordinal}`,
		productKind,
		variantKey: productKind === "print" ? "8x10" : null,
		materialOptionKey: null,
		sizeOptionKey: null,
		borderOptionKey: null,
		frameOptionKey: null,
	};
}

async function post(t: ReturnType<typeof convexTest>, path: string, body: unknown) {
	const response = await t.fetch(path, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${RESERVATION_SECRET}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as { handle?: string; error?: string };
	if (!response.ok) throw new Error(`${path} failed: ${json.error ?? response.status}`);
	return json;
}

/** Reserve and bind a durable snapshot exactly as first-party Checkout creation does. */
async function reserveCheckout(t: ReturnType<typeof convexTest>, kinds: readonly SnapshotKind[]) {
	const { handle } = await post(t, "/commerce/checkout-snapshots/reserve", {
		version: 1,
		site: SITE_URL,
		attempt: "123e4567-e89b-42d3-a456-426614174000",
		account: null,
		snapshot: {
			schemaVersion: 1,
			catalogProvider: "convex",
			items: kinds.map((kind, ordinal) => snapshotItem(ordinal, kind)),
		},
	});
	if (!handle) throw new Error("Expected reservation handle");
	await post(t, "/commerce/checkout-snapshots/bind", {
		version: 1,
		site: SITE_URL,
		handle,
		account: null,
		session: SESSION_ID,
		stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
	});
	return handle;
}

function paidSession(handle: string, extraMetadata: Record<string, string>) {
	return {
		id: SESSION_ID,
		object: "checkout.session",
		mode: "payment",
		status: "complete",
		payment_status: "paid",
		payment_intent: "pi_confirmation1234567890",
		amount_total: 2500,
		amount_subtotal: 2500,
		currency: "usd",
		livemode: false,
		customer_details: { email: BUYER, name: "Buyer" },
		collected_information: null,
		// Server-stamped Checkout metadata carries only the snapshot handle and tenant marker.
		metadata: {
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: handle,
			commerceTenantSiteUrl: SITE_URL,
			...extraMetadata,
		},
	} as unknown as Stripe.Checkout.Session;
}

async function deliverPaidCheckout(
	kinds: readonly SnapshotKind[],
	extraMetadata: Record<string, string> = {},
) {
	const t = convexTest(schema, modules);
	const handle = await reserveCheckout(t, kinds);
	const session = paidSession(handle, extraMetadata);
	const convex = {
		mutation: (reference: Parameters<typeof t.mutation>[0], args: unknown) =>
			t.mutation(reference, args as never),
		query: (reference: Parameters<typeof t.query>[0], args: unknown) =>
			t.query(reference, args as never),
	} as unknown as ConvexHttpClient;
	const stripe = {
		checkout: {
			sessions: {
				retrieve: vi.fn().mockResolvedValue(session),
				listLineItems: vi.fn().mockResolvedValue({
					data: kinds.map((kind, ordinal) => ({
						id: `li_${ordinal}`,
						description: kind === "print" ? "Archival print" : "Digital download",
						quantity: 1,
						amount_total: 2500 / kinds.length,
						amount_subtotal: 2500 / kinds.length,
						price: { unit_amount: 2500 / kinds.length },
					})),
					has_more: false,
				}),
			},
		},
		refunds: { create: vi.fn() },
	} as unknown as Stripe;
	const send = vi.fn(async (_payload: { to: string[]; text: string; html: string }) => ({
		data: { id: "email_fixture" },
		error: null,
	}));
	const lumaprints = vi.fn(() => {
		throw new Error("Unexpected LumaPrints client");
	});
	await processStripeWebhookEvent(
		{
			id: "evt_confirmation1234567890",
			type: "checkout.session.completed",
			livemode: false,
			data: { object: session },
		} as Stripe.Event,
		{
			stripe,
			convex,
			resend: { emails: { send } } as unknown as Resend,
			getLumaPrintsClient: lumaprints as never,
		},
	);
	const customer = send.mock.calls.filter(([payload]) => payload.to.includes(BUYER));
	expect(customer).toHaveLength(1);
	const order = await t.run((ctx) => ctx.db.query("orders").unique());
	return { email: customer[0][0], order };
}

describe("customer confirmation uses the recorded order fulfillment", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Binding schedules a 35-day reservation reconcile; keep it from firing mid-test.
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		for (const [name, value] of Object.entries(convexEnv)) vi.stubEnv(name, value);
		vi.stubEnv(
			"CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS",
			JSON.stringify({
				checkoutBridge: [await serverSecretFingerprint(BRIDGE_SECRET)],
				checkoutSnapshotReservation: [await serverSecretFingerprint(RESERVATION_SECRET)],
			}),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	test("a digital-only order receives the download confirmation without isDigital metadata", async () => {
		const { email, order } = await deliverPaidCheckout(["digital_download"]);

		expect(order?.fulfillmentType).toBe("digital");
		expect(email.text).toContain(`DOWNLOAD YOUR PURCHASE\n${DOWNLOAD_URL}`);
		expect(email.text).not.toContain("SHIPPING ADDRESS");
		expect(email.text).not.toContain("No shipping address");
		expect(email.html).toContain(DOWNLOAD_URL);
	});

	test("a physical order receives the shipping confirmation", async () => {
		const { email, order } = await deliverPaidCheckout(["print"]);

		expect(order?.fulfillmentType).toBe("self");
		expect(email.text).toContain("SHIPPING ADDRESS");
		expect(email.text).not.toContain("DOWNLOAD YOUR PURCHASE");
		expect(email.html).not.toContain(DOWNLOAD_URL);
	});

	test("a mixed order keeps the shipping confirmation", async () => {
		const { email, order } = await deliverPaidCheckout(["print", "digital_download"]);

		expect(order?.fulfillmentType).toBe("self");
		expect(email.text).toContain("SHIPPING ADDRESS");
		expect(email.text).not.toContain("DOWNLOAD YOUR PURCHASE");
	});

	test("spoofed isDigital metadata cannot turn a physical order into a download confirmation", async () => {
		const { email, order } = await deliverPaidCheckout(["print"], { isDigital: "true" });

		expect(order?.fulfillmentType).toBe("self");
		expect(email.text).toContain("SHIPPING ADDRESS");
		expect(email.text).not.toContain("DOWNLOAD YOUR PURCHASE");
		expect(email.html).not.toContain(DOWNLOAD_URL);
	});

	test("spoofed isDigital=false metadata cannot hide a digital download", async () => {
		const { email, order } = await deliverPaidCheckout(["digital_download"], {
			isDigital: "false",
		});

		expect(order?.fulfillmentType).toBe("digital");
		expect(email.text).toContain(`DOWNLOAD YOUR PURCHASE\n${DOWNLOAD_URL}`);
	});
});
