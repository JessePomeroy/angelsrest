/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../../packages/crm-api/convex/_generated/api";
import schema from "../../../../packages/crm-api/convex/schema";
import { invoiceBalance } from "../../../../packages/crm-api/src/invoiceAmounts";
import { POST as checkout } from "../../../routes/api/invoice/checkout/+server";
import { POST as webhook } from "../../../routes/api/webhooks/stripe/+server";
import { STRIPE_API_VERSION } from "../stripeApiVersion";

const boundary = vi.hoisted(() => ({
	getStripe: vi.fn(),
	getResend: vi.fn(),
	env: {
		WEBHOOK_SECRET: "invoice-journey-backend-fixture",
		STRIPE_WEBHOOK_SECRET: "whsec_invoice_journey_fixture",
	},
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: boundary.getStripe }));
vi.mock("$lib/server/resendClient", () => ({ getResend: boundary.getResend }));
vi.mock("$env/dynamic/private", () => ({ env: boundary.env }));
vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://test.convex.cloud", PUBLIC_SITE_URL: "http://localhost:5173" },
}));

const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const siteUrl = "angelsrest.online";
const adminEmail = "invoice-verification@example.invalid";

beforeEach(() => {
	vi.stubEnv("WEBHOOK_SECRET", boundary.env.WEBHOOK_SECRET);
	vi.stubGlobal("fetch", () => {
		throw new Error("Unexpected external request in the offline invoice journey");
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function setup() {
	const backend = convexTest(schema, modules);
	// Only the network boundary is replaced: routes retain real API references,
	// authorization checks, schema validators, and invoice/portal functions.
	vi.spyOn(ConvexHttpClient.prototype, "query").mockImplementation((ref, args = {}) =>
		backend.query(ref, args),
	);
	vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation((...args) =>
		backend.mutation(args[0], args[1] ?? {}),
	);
	await backend.mutation(internal.platform.seedClient, {
		name: "Invoice verification",
		email: adminEmail,
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [adminEmail],
		role: "creator",
	});
	const admin = backend.withIdentity({
		subject: adminEmail,
		email: adminEmail,
		emailVerified: true,
	});
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl,
		name: "Synthetic invoice client",
		email: "invoice-client@example.invalid",
		category: "photography",
		type: "portrait",
	});
	const invoiceId = await admin.mutation(api.invoices.create, {
		siteUrl,
		invoiceNumber: "VERIFY-REVISIONS",
		clientId,
		invoiceType: "one-time",
		items: [{ description: "Verification session", quantity: 1, unitPrice: 10_000 }],
	});
	await admin.mutation(api.invoices.update, { siteUrl, invoiceId, status: "sent" });
	const token = await admin.mutation(api.portal.createToken, {
		siteUrl,
		type: "invoice",
		documentId: invoiceId,
		clientId,
	});

	const requests: URLSearchParams[] = [];
	const sessions = new Map<string, ReturnType<typeof createSession>>();
	function createSession(form: URLSearchParams, index: number) {
		const metadata: Record<string, string> = {};
		let amount = 0;
		for (const [key, value] of form) {
			const metadataKey = /^metadata\[(.+)\]$/.exec(key)?.[1];
			if (metadataKey) metadata[metadataKey] = value;
			const line = /^(line_items\[\d+\])\[price_data\]\[unit_amount\]$/.exec(key)?.[1];
			if (line) amount += Number(value) * Number(form.get(`${line}[quantity]`) ?? 1);
		}
		return {
			id: `cs_test_invoice_journey_${index}`,
			object: "checkout.session",
			url: `https://checkout.example.invalid/invoice/${index}`,
			livemode: false,
			mode: form.get("mode"),
			currency: "usd",
			amount_total: amount,
			metadata,
		};
	}
	const stripe = new Stripe("sk_test_invoice_journey_fixture", {
		apiVersion: STRIPE_API_VERSION,
		maxNetworkRetries: 0,
		httpClient: Stripe.createFetchHttpClient(async (url: string, init?: RequestInit) => {
			expect(new URL(url).pathname).toBe("/v1/checkout/sessions");
			expect(init?.method).toBe("POST");
			const key = new Headers(init?.headers).get("Idempotency-Key");
			expect(key).toMatch(/^invoice-checkout:/);
			if (!key) throw new Error("Checkout idempotency key missing");
			const form = new URLSearchParams(String(init?.body));
			requests.push(form);
			const session = sessions.get(key) ?? createSession(form, sessions.size + 1);
			sessions.set(key, session);
			return new Response(JSON.stringify(session), {
				headers: { "Content-Type": "application/json", "Request-Id": "req_fixture" },
			});
		}),
	});
	boundary.getStripe.mockReturnValue(stripe);
	const send = vi.fn(() => {
		throw new Error("Invoice journey must not send email");
	});
	boundary.getResend.mockReturnValue({ emails: { send } });

	async function startCheckout() {
		const response = await checkout({
			request: new Request("http://localhost:5173/api/invoice/checkout", {
				method: "POST",
				body: JSON.stringify({ token }),
			}),
		} as Parameters<typeof checkout>[0]);
		expect(response.status).toBe(200);
		const body: unknown = await response.json();
		if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") {
			throw new Error("Checkout response URL missing");
		}
		const session = [...sessions.values()].find((candidate) => candidate.url === body.url);
		if (!session) throw new Error("Route did not return its created checkout URL");
		expect(body).toEqual({ url: session.url });
		return session;
	}

	function signedRequest(
		session: ReturnType<typeof createSession>,
		secret = boundary.env.STRIPE_WEBHOOK_SECRET,
	) {
		const payload = JSON.stringify({
			id: `evt_${session.id}`,
			object: "event",
			api_version: STRIPE_API_VERSION,
			type: "checkout.session.completed",
			livemode: false,
			data: {
				object: {
					...session,
					status: "complete",
					payment_status: "paid",
					payment_intent: `pi_${session.id}`,
				},
			},
		});
		return new Request("http://localhost:5173/api/webhooks/stripe", {
			method: "POST",
			body: payload,
			headers: {
				"stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret }),
			},
		});
	}
	async function settle(session: ReturnType<typeof createSession>) {
		const response = await webhook({ request: signedRequest(session) } as Parameters<
			typeof webhook
		>[0]);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true });
		expect(send).not.toHaveBeenCalled();
	}
	async function revise(unitPrice: number) {
		await admin.mutation(api.invoices.update, {
			siteUrl,
			invoiceId,
			items: [{ description: "Revised verification session", quantity: 1, unitPrice }],
		});
	}
	async function read() {
		const invoice = await admin.query(api.invoices.get, { invoiceId });
		const portal = await backend.query(api.portal.getPublicByToken, { token });
		if (
			!invoice ||
			!portal ||
			!("document" in portal) ||
			!portal.document ||
			!("invoiceNumber" in portal.document)
		)
			throw new Error("Invoice view missing");
		expect(portal.document).toMatchObject({
			status: invoice.status,
			items: invoice.items,
			paidAmount: invoice.paidAmount,
		});
		return { invoice, portal };
	}
	return { backend, invoiceId, startCheckout, signedRequest, settle, revise, read, requests };
}

describe("invoice checkout → signed webhook → real ledger (offline boundaries)", () => {
	it("credits an old checkout, ignores its replay, and collects only the revised remainder", async () => {
		const s = await setup();
		const original = await s.startCheckout();
		expect(original.amount_total).toBe(10_000);
		await s.revise(20_000);
		await s.settle(original);
		await s.settle(original);
		expect((await s.read()).invoice).toMatchObject({ status: "partial", paidAmount: 10_000 });
		const remaining = await s.startCheckout();
		expect(remaining.amount_total).toBe(10_000);
		expect(remaining.id).not.toBe(original.id);
		expect(s.requests.at(-1)?.get("line_items[0][price_data][product_data][name]")).toBe(
			"Invoice remaining balance",
		);
		await s.settle(remaining);
		await s.settle(remaining);
		expect((await s.read()).invoice).toMatchObject({ status: "paid", paidAmount: 20_000 });
		const ledger = await s.backend.run((ctx) => ctx.db.query("invoiceCheckouts").collect());
		expect(ledger).toHaveLength(2);
		expect(ledger.every((row) => row.paidAt !== undefined)).toBe(true);
		expect(ledger.find((row) => row.stripeSessionId === original.id)?.items?.[0].unitPrice).toBe(
			10_000,
		);
	});

	it("preserves both real receipts when an older checkout is paid after the revised total", async () => {
		const s = await setup();
		const original = await s.startCheckout();
		await s.revise(20_000);
		const revised = await s.startCheckout();
		expect(revised.amount_total).toBe(20_000);
		await s.settle(revised);
		await s.settle(original);
		await s.settle(original);
		const { invoice } = await s.read();
		expect(invoice).toMatchObject({ status: "paid", paidAmount: 30_000 });
		expect(invoiceBalance(20_000, invoice.paidAmount)).toMatchObject({
			remainingCents: 0,
			overpaidCents: 10_000,
		});
	});

	it("rejects an incorrectly signed receipt without crediting the invoice", async () => {
		const s = await setup();
		const session = await s.startCheckout();
		await expect(
			webhook({ request: s.signedRequest(session, "whsec_wrong_fixture") } as Parameters<
				typeof webhook
			>[0]),
		).rejects.toMatchObject({ status: 400 });
		const invoice = await s.backend.run((ctx) => ctx.db.get(s.invoiceId));
		expect(invoice?.paidAmount ?? 0).toBe(0);
		expect(invoice?.status).toBe("sent");
	});
});
