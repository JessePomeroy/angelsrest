/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";
const SITE_URL = "tenant-a.example";
const ADMIN_EMAIL = "admin@example.com";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

async function setupTenant() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Tenant A",
		email: ADMIN_EMAIL,
		siteUrl: SITE_URL,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN_EMAIL],
		role: "client",
	});
	const admin = t.withIdentity({
		subject: ADMIN_EMAIL,
		email: ADMIN_EMAIL,
		emailVerified: true,
	});
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl: SITE_URL,
		name: "Invoice client",
		email: "client@example.com",
		category: "photography",
		type: "portrait",
	});
	return { t, admin, clientId };
}

async function seedInvoice() {
	const { t, admin, clientId } = await setupTenant();
	const invoiceId = await admin.mutation(api.invoices.create, {
		siteUrl: SITE_URL,
		invoiceNumber: "INV-001",
		clientId,
		invoiceType: "one-time",
		items: [{ description: "Session", quantity: 1, unitPrice: 100 }],
	});
	await admin.mutation(api.invoices.update, {
		invoiceId,
		siteUrl: SITE_URL,
		status: "sent",
	});
	return { t, admin, invoiceId };
}

describe("invoice payment revisions", () => {
	const auth = { siteUrl: SITE_URL, webhookSecret: WEBHOOK_SECRET };
	async function started() {
		const fixture = await seedInvoice();
		const args = { ...auth, invoiceId: fixture.invoiceId };
		const checkout = await fixture.t.mutation(api.invoices.prepareCheckout, {
			...args,
			origin: "https://tenant.example",
		});
		return { ...fixture, args, checkout };
	}
	function evidence(
		s: Awaited<ReturnType<typeof started>>,
		overrides: Record<string, unknown> = {},
	) {
		return {
			...s.args,
			checkoutId: s.checkout._id,
			stripeCheckoutSessionId: "cs_original",
			stripeCheckoutFingerprint: s.checkout.fingerprint,
			paidCents: 100,
			currency: "usd",
			paymentIntentId: "pi_original",
			...overrides,
		};
	}
	test("an old payment reduces a revised balance and cannot mark it fully paid", async () => {
		const s = await started();
		await s.admin.mutation(api.invoices.update, {
			invoiceId: s.invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Revised", quantity: 1, unitPrice: 20000 }],
		});
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		const invoice = await s.t.run((ctx) => ctx.db.get(s.invoiceId));
		expect(invoice).toMatchObject({ status: "partial", paidAmount: 100, paymentRevision: 1 });
		const next = await s.t.mutation(api.invoices.prepareCheckout, {
			...s.args,
			origin: "https://tenant.example",
		});
		expect(next).toMatchObject({
			amountCents: 19900,
			paidBeforeCents: 100,
			totalCents: 20000,
			revision: 1,
		});
		expect((await s.t.run((ctx) => ctx.db.get(s.checkout._id)))?.items?.[0].unitPrice).toBe(100);
	});
	test("out-of-order payments remain recorded and an overpayment remains visible", async () => {
		const s = await started();
		await s.admin.mutation(api.invoices.update, {
			invoiceId: s.invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Revised", quantity: 1, unitPrice: 200 }],
		});
		const later = await s.t.mutation(api.invoices.prepareCheckout, {
			...s.args,
			origin: "https://tenant.example",
		});
		await s.t.mutation(
			api.invoices.markPaid,
			evidence(s, {
				checkoutId: later._id,
				stripeCheckoutSessionId: "cs_later",
				stripeCheckoutFingerprint: later.fingerprint,
				paidCents: 200,
				paymentIntentId: "pi_later",
			}),
		);
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
			status: "paid",
			paidAmount: 300,
		});
		expect(
			(await s.t.run((ctx) => ctx.db.query("invoiceCheckouts").collect())).filter(
				(row) => row.paidAt !== undefined,
			),
		).toHaveLength(2);
	});
	test("an early webhook followed by checkout registration never reopens the invoice", async () => {
		const s = await started();
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		await s.t.mutation(api.invoices.recordCheckoutStarted, {
			...s.args,
			checkoutId: s.checkout._id,
			stripeCheckoutSessionId: "cs_original",
			stripeCheckoutFingerprint: s.checkout.fingerprint,
		});
		expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
			status: "paid",
			paidAmount: 100,
		});
	});
	test("legacy issued sessions survive replacement and need actual paid amount", async () => {
		const { t, admin, invoiceId } = await seedInvoice();
		const args = { ...auth, invoiceId };
		await t.mutation(api.invoices.recordCheckoutStarted, {
			...args,
			stripeCheckoutSessionId: "cs_legacy",
			stripeCheckoutFingerprint: "legacy",
		});
		await admin.mutation(api.invoices.update, {
			invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Revised", quantity: 1, unitPrice: 300 }],
		});
		await t.mutation(api.invoices.recordCheckoutStarted, {
			...args,
			stripeCheckoutSessionId: "cs_replacement",
			stripeCheckoutFingerprint: "replacement",
		});
		const payment = {
			...args,
			stripeCheckoutSessionId: "cs_legacy",
			stripeCheckoutFingerprint: "legacy",
		};
		await expect(t.mutation(api.invoices.markPaid, payment)).rejects.toThrow("amount and currency");
		await t.mutation(api.invoices.markPaid, { ...payment, paidCents: 100, currency: "usd" });
		expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({
			status: "partial",
			paidAmount: 100,
		});
	});
	test("retries share a snapshot; a changed provider scope gets its own snapshot", async () => {
		const s = await started();
		expect(
			(
				await s.t.mutation(api.invoices.prepareCheckout, {
					...s.args,
					origin: "https://tenant.example",
				})
			)._id,
		).toBe(s.checkout._id);
		const other = await s.t.mutation(api.invoices.prepareCheckout, {
			...s.args,
			origin: "https://tenant.example",
			stripeAccountId: "acct_other",
		});
		expect(other._id).not.toBe(s.checkout._id);
		await expect(
			s.t.mutation(api.invoices.markPaid, evidence(s, { checkoutId: other._id })),
		).rejects.toThrow("account mismatch");
	});
	test.each([
		{ paidCents: 99 },
		{ currency: "eur" },
		{ paidCents: -1 },
	])("rejects inconsistent payment evidence %j", async (extra) => {
		const s = await started();
		await expect(s.t.mutation(api.invoices.markPaid, evidence(s, extra))).rejects.toThrow();
		expect((await s.t.run((ctx) => ctx.db.get(s.invoiceId)))?.paidAmount).toBeUndefined();
	});
	test("session binding cannot be reused by a second snapshot", async () => {
		const s = await started();
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		await s.admin.mutation(api.invoices.update, {
			invoiceId: s.invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Revised", quantity: 1, unitPrice: 300 }],
		});
		const later = await s.t.mutation(api.invoices.prepareCheckout, {
			...s.args,
			origin: "https://tenant.example",
		});
		await expect(
			s.t.mutation(
				api.invoices.markPaid,
				evidence(s, {
					checkoutId: later._id,
					stripeCheckoutFingerprint: later.fingerprint,
					paidCents: 200,
				}),
			),
		).rejects.toThrow("already bound");
	});
	test("canceling keeps a late payment visible and forbids erasing its history", async () => {
		const s = await started();
		await s.admin.mutation(api.invoices.update, {
			invoiceId: s.invoiceId,
			siteUrl: SITE_URL,
			status: "canceled",
		});
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
			status: "canceled",
			paidAmount: 100,
		});
		await expect(
			s.admin.mutation(api.invoices.remove, { invoiceId: s.invoiceId, siteUrl: SITE_URL }),
		).rejects.toThrow("retained");
	});
	test("manual settlement after partial payment records only the current total", async () => {
		const s = await started();
		await s.admin.mutation(api.invoices.update, {
			invoiceId: s.invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Revised", quantity: 1, unitPrice: 300 }],
		});
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		await s.admin.mutation(api.invoices.markPaid, { invoiceId: s.invoiceId, siteUrl: SITE_URL });
		expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
			status: "paid",
			paidAmount: 300,
		});
	});
	test("an admin identity cannot substitute for signed provider evidence", async () => {
		const s = await started();
		const { webhookSecret, ...payment } = evidence(s);
		await expect(s.admin.mutation(api.invoices.markPaid, payment)).rejects.toThrow(
			"webhook authorization",
		);
	});
	test("rejects a foreign tenant before reserving or crediting a checkout", async () => {
		const s = await started();
		await expect(
			s.t.mutation(api.invoices.prepareCheckout, {
				...s.args,
				siteUrl: "other.example",
				origin: "https://other.example",
			}),
		).rejects.toThrow("Not found");
		await expect(
			s.t.mutation(api.invoices.markPaid, { ...evidence(s), siteUrl: "other.example" }),
		).rejects.toThrow("Not found");
	});
	test("ambiguous creation cannot be replayed outside its bounded lifetime", async () => {
		const s = await started();
		await s.t.run((ctx) =>
			ctx.db.patch(s.checkout._id, { expiresAt: Math.floor(Date.now() / 1000) - 1 }),
		);
		await expect(
			s.t.mutation(api.invoices.prepareCheckout, { ...s.args, origin: "https://tenant.example" }),
		).rejects.toThrow("reconciliation");
	});
	test("known expired sessions allow a new attempt without losing earlier payment identity", async () => {
		const s = await started();
		await s.t.mutation(api.invoices.recordCheckoutStarted, {
			...s.args,
			checkoutId: s.checkout._id,
			stripeCheckoutSessionId: "cs_original",
			stripeCheckoutFingerprint: s.checkout.fingerprint,
		});
		await s.t.run((ctx) =>
			ctx.db.patch(s.checkout._id, { expiresAt: Math.floor(Date.now() / 1000) - 1 }),
		);
		const next = await s.t.mutation(api.invoices.prepareCheckout, {
			...s.args,
			origin: "https://tenant.example",
		});
		expect(next._id).not.toBe(s.checkout._id);
		await s.t.mutation(api.invoices.markPaid, evidence(s));
		expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
			paidAmount: 100,
			status: "paid",
		});
	});
	test("does not guess the unpaid balance on legacy partial invoices", async () => {
		const s = await started();
		await s.t.run((ctx) => ctx.db.patch(s.invoiceId, { status: "partial" }));
		await expect(
			s.t.mutation(api.invoices.prepareCheckout, { ...s.args, origin: "https://tenant.example" }),
		).rejects.toThrow("recorded payment amount");
	});

	test("backend-first rollout credits a fingerprint-proven legacy checkout after an edit", async () => {
		const { t, admin, invoiceId } = await seedInvoice();
		const fingerprint = createHash("sha256")
			.update(
				JSON.stringify({
					lineItemsCents: [{ description: "Session", quantity: 1, unitPriceCents: 100 }],
					taxPercent: 0,
					taxCents: 0,
				}),
			)
			.digest("hex")
			.slice(0, 24);
		const args = { ...auth, invoiceId };
		await t.mutation(api.invoices.recordCheckoutStarted, {
			...args,
			stripeCheckoutSessionId: "cs_old_host",
			stripeCheckoutFingerprint: fingerprint,
		});
		await admin.mutation(api.invoices.update, {
			invoiceId,
			siteUrl: SITE_URL,
			items: [{ description: "Updated", quantity: 1, unitPrice: 300 }],
		});
		const payment = {
			...args,
			stripeCheckoutSessionId: "cs_old_host",
			stripeCheckoutFingerprint: fingerprint,
		};
		await t.mutation(api.invoices.markPaid, payment);
		await t.mutation(api.invoices.markPaid, {
			...payment,
			paidCents: 100,
			currency: "usd",
			paymentIntentId: "pi_late_evidence",
		});
		expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({
			status: "partial",
			paidAmount: 100,
		});
	});
});
