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
		name: "Quote client",
		email: "client@example.com",
		category: "photography",
		type: "portrait",
	});
	return { t, admin, clientId };
}

describe("authoritative quote numbering", () => {
	test("bootstraps from legacy quotes and ignores a stale caller preview", async () => {
		const { t, admin, clientId } = await setupTenant();
		await t.run(async (ctx) => {
			await ctx.db.insert("quotes", {
				siteUrl: SITE_URL,
				quoteNumber: "QT-007",
				clientId,
				clientName: "Quote client",
				status: "draft",
				packages: [{ name: "Legacy portrait", price: 175 }],
			});
		});

		const quoteId = await admin.mutation(api.quotes.create, {
			siteUrl: SITE_URL,
			quoteNumber: "QT-001",
			clientId,
			packages: [{ name: "New portrait", price: 250 }],
		});
		const quote = await t.run((ctx) => ctx.db.get(quoteId));

		expect(quote?.quoteNumber).toBe("QT-008");
		await expect(
			admin.query(api.quotes.getNextNumber, { siteUrl: SITE_URL }),
		).resolves.toBe("QT-009");
	});

	test("allocates distinct numbers to concurrent quote creators", async () => {
		const { t, admin, clientId } = await setupTenant();
		const createQuote = () =>
			admin.mutation(api.quotes.create, {
				siteUrl: SITE_URL,
				quoteNumber: "QT-001",
				clientId,
				packages: [{ name: "Portrait", price: 250 }],
			});

		const quoteIds = await Promise.all([createQuote(), createQuote(), createQuote()]);
		const numbers = await t.run(async (ctx) => {
			const quotes = await Promise.all(quoteIds.map((quoteId) => ctx.db.get(quoteId)));
			return quotes.map((quote) => quote?.quoteNumber).sort();
		});

		expect(numbers).toEqual(["QT-001", "QT-002", "QT-003"]);
	});
});
