/// <reference types="vite/client" />
// @vitest-environment edge-runtime

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

describe("authoritative invoice numbering", () => {
	test("bootstraps from legacy invoices and ignores a stale caller preview", async () => {
		const { t, admin, clientId } = await setupTenant();
		await t.run(async (ctx) => {
			await ctx.db.insert("invoices", {
				siteUrl: SITE_URL,
				invoiceNumber: "INV-007",
				clientId,
				clientName: "Invoice client",
				invoiceType: "one-time",
				status: "draft",
				items: [{ description: "Legacy session", quantity: 1, unitPrice: 75 }],
			});
		});

		const invoiceId = await admin.mutation(api.invoices.create, {
			siteUrl: SITE_URL,
			invoiceNumber: "INV-001",
			clientId,
			invoiceType: "one-time",
			items: [{ description: "New session", quantity: 1, unitPrice: 100 }],
		});
		const invoice = await t.run((ctx) => ctx.db.get(invoiceId));

		expect(invoice?.invoiceNumber).toBe("INV-008");
		await expect(
			admin.query(api.invoices.getNextNumber, { siteUrl: SITE_URL }),
		).resolves.toBe("INV-009");
	});

	test("allocates distinct numbers to concurrent invoice creators", async () => {
		const { t, admin, clientId } = await setupTenant();
		const createInvoice = () =>
			admin.mutation(api.invoices.create, {
				siteUrl: SITE_URL,
				invoiceNumber: "INV-001",
				clientId,
				invoiceType: "one-time",
				items: [{ description: "Session", quantity: 1, unitPrice: 100 }],
			});

		const invoiceIds = await Promise.all([
			createInvoice(),
			createInvoice(),
			createInvoice(),
		]);
		const numbers = await t.run(async (ctx) => {
			const invoices = await Promise.all(invoiceIds.map((invoiceId) => ctx.db.get(invoiceId)));
			return invoices.map((invoice) => invoice?.invoiceNumber).sort();
		});

		expect(numbers).toEqual(["INV-001", "INV-002", "INV-003"]);
	});

	test("shares one allocator with quote conversion", async () => {
		const { t, admin, clientId } = await setupTenant();
		const quoteId = await admin.mutation(api.quotes.create, {
			siteUrl: SITE_URL,
			quoteNumber: "Q-001",
			clientId,
			packages: [{ name: "Portrait session", price: 250 }],
		});
		const convertedInvoiceId = await admin.mutation(api.quotes.convertToInvoice, {
			quoteId,
			siteUrl: SITE_URL,
			invoiceNumber: "INV-999",
			invoiceType: "one-time",
		});
		const directInvoiceId = await admin.mutation(api.invoices.create, {
			siteUrl: SITE_URL,
			invoiceNumber: "INV-999",
			clientId,
			invoiceType: "one-time",
			items: [{ description: "Extra print", quantity: 1, unitPrice: 50 }],
		});
		const numbers = await t.run(async (ctx) => {
			const converted = await ctx.db.get(convertedInvoiceId);
			const direct = await ctx.db.get(directInvoiceId);
			return [converted?.invoiceNumber, direct?.invoiceNumber];
		});

		expect(numbers).toEqual(["INV-001", "INV-002"]);
	});
});

describe("invoice checkout state", () => {
	test("recordCheckoutStarted rejects invoices that are already paid", async () => {
		const { admin, invoiceId } = await seedInvoice();
		await admin.mutation(api.invoices.markPaid, {
			invoiceId,
			siteUrl: SITE_URL,
		});

		await expect(
			admin.mutation(api.invoices.recordCheckoutStarted, {
				invoiceId,
				siteUrl: SITE_URL,
				stripeCheckoutSessionId: "cs_late",
				stripeCheckoutFingerprint: "fingerprint-late",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).rejects.toThrow("Invoice has already been paid");
	});

	test("markPaid validates supplied session details before paid idempotency", async () => {
		const { admin, invoiceId } = await seedInvoice();
		await admin.mutation(api.invoices.recordCheckoutStarted, {
			invoiceId,
			siteUrl: SITE_URL,
			stripeCheckoutSessionId: "cs_current",
			stripeCheckoutFingerprint: "fingerprint-current",
			webhookSecret: WEBHOOK_SECRET,
		});
		await admin.mutation(api.invoices.markPaid, {
			invoiceId,
			siteUrl: SITE_URL,
			stripeCheckoutSessionId: "cs_current",
			stripeCheckoutFingerprint: "fingerprint-current",
			webhookSecret: WEBHOOK_SECRET,
		});

		await expect(
			admin.mutation(api.invoices.markPaid, {
				invoiceId,
				siteUrl: SITE_URL,
				stripeCheckoutSessionId: "cs_stale",
				stripeCheckoutFingerprint: "fingerprint-current",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).rejects.toThrow("Invoice checkout session mismatch");

		await expect(
			admin.mutation(api.invoices.markPaid, {
				invoiceId,
				siteUrl: SITE_URL,
				stripeCheckoutSessionId: "cs_current",
				stripeCheckoutFingerprint: "fingerprint-stale",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).rejects.toThrow("Invoice checkout fingerprint mismatch");
	});
});
